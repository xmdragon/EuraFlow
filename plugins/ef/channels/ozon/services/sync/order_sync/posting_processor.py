"""
Posting 处理器

负责处理 Posting（发货单）和包裹信息的同步。
优化版本：支持批量处理，减少数据库查询次数。
"""

from typing import Dict, Any, Optional, List, Set
import logging

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ....models import OzonPosting, OzonShipmentPackage, OzonProduct, OzonShop
from ....api.client import OzonAPIClient
from ....utils.datetime_utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)


class PostingProcessor:
    """Posting 处理器"""

    async def sync_postings_batch(
        self,
        db: AsyncSession,
        items: List[Dict[str, Any]],
        shop: OzonShop,
    ) -> int:
        """
        批量同步 postings（优化版）

        优化点：
        1. 批量查询已存在的 postings（1次查询）
        2. 批量查询已存在的 packages（1次查询）
        3. 批量收集所有 SKU，一次查询采购信息
        4. shop 对象直接传入，不再重复查询

        Args:
            db: 数据库会话
            items: OZON API 返回的 posting 数据列表
            shop: 店铺对象

        Returns:
            成功同步的数量
        """
        if not items:
            return 0

        shop_id = shop.id

        # 1. 提取所有 posting_number
        posting_numbers = [
            item.get("posting_number") for item in items
            if item.get("posting_number")
        ]

        if not posting_numbers:
            return 0

        # 2. 批量查询已存在的 postings（1次查询代替 N 次）
        existing_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number.in_(posting_numbers))
        )
        existing_postings = {p.posting_number: p for p in existing_result.scalars().all()}

        logger.info(f"Batch query: {len(existing_postings)}/{len(posting_numbers)} postings already exist")

        # 3. 收集所有 SKU 用于批量查询采购信息
        all_skus: Set[int] = set()
        for item in items:
            products = item.get("products", [])
            for p in products:
                sku = p.get("sku")
                if sku is not None:
                    try:
                        all_skus.add(int(sku))
                    except (ValueError, TypeError):
                        pass

        # 4. 批量查询有采购信息的 SKU（1次查询）
        skus_with_purchase: Set[int] = set()
        if all_skus:
            purchase_result = await db.execute(
                select(OzonProduct.ozon_sku).where(
                    OzonProduct.shop_id == shop_id,
                    OzonProduct.ozon_sku.in_(list(all_skus)),
                    OzonProduct.purchase_url.isnot(None),
                    OzonProduct.purchase_url != ''
                )
            )
            skus_with_purchase = {row[0] for row in purchase_result.all()}

        # 5. 处理每个 posting
        synced_count = 0
        new_postings: List[OzonPosting] = []
        postings_to_process: List[tuple[OzonPosting, Dict, bool, bool]] = []

        for item in items:
            posting_number = item.get("posting_number")
            if not posting_number:
                continue

            posting = existing_postings.get(posting_number)
            is_new_posting = posting is None
            old_is_cancelled = posting.is_cancelled if posting else False

            if not posting:
                posting = OzonPosting(
                    shop_id=shop_id,
                    posting_number=posting_number,
                    ozon_posting_number=posting_number,
                    status=item.get("status") or "awaiting_packaging",
                )
                new_postings.append(posting)
                logger.debug(f"Created new posting {posting_number}")
            else:
                old_status = posting.status
                new_status = item.get("status") or posting.status
                posting.status = new_status
                logger.debug(f"Updating posting {posting_number}: {old_status} → {new_status}")

            # 更新 posting 详细信息
            self._update_posting_details(posting, item)

            # 更新反范式化字段（使用预查询的采购信息）
            self._update_denormalized_fields_fast(posting, item, skus_with_purchase)

            postings_to_process.append((posting, item, is_new_posting, old_is_cancelled))
            synced_count += 1

        # 6. 批量添加新 postings
        if new_postings:
            db.add_all(new_postings)
            logger.info(f"Batch added {len(new_postings)} new postings")

        # 7. Flush 以获取 posting IDs
        await db.flush()

        # 8. 批量查询已存在的 packages
        posting_ids = [p.id for p, _, _, _ in postings_to_process if p.id]
        existing_packages_map: Dict[int, Dict[str, OzonShipmentPackage]] = {}

        if posting_ids:
            packages_result = await db.execute(
                select(OzonShipmentPackage).where(
                    OzonShipmentPackage.posting_id.in_(posting_ids)
                )
            )
            for pkg in packages_result.scalars().all():
                if pkg.posting_id not in existing_packages_map:
                    existing_packages_map[pkg.posting_id] = {}
                existing_packages_map[pkg.posting_id][pkg.package_number] = pkg

        logger.info(f"Batch query: found packages for {len(existing_packages_map)} postings")

        # 9. 处理 packages 和更新 operation_status、销量
        new_packages: List[OzonShipmentPackage] = []

        for posting, item, is_new_posting, old_is_cancelled in postings_to_process:
            # 同步包裹信息（批量版）
            new_pkgs = await self._sync_packages_fast(
                db, posting, item, shop,
                existing_packages_map.get(posting.id, {})
            )
            new_packages.extend(new_pkgs)

            # 更新 operation_status
            await self._update_operation_status(db, posting, item)

            # 更新商品销量
            await self._update_product_sales(
                db, shop_id, item.get("products", []),
                is_new_posting, old_is_cancelled, posting.is_cancelled,
                posting
            )

        # 10. 批量添加新 packages
        if new_packages:
            db.add_all(new_packages)
            logger.info(f"Batch added {len(new_packages)} new packages")

        return synced_count

    async def sync_posting(
        self,
        db: AsyncSession,
        posting_data: Dict[str, Any],
        shop_id: int,
        ozon_order_id: str = "",
        shop: Optional[OzonShop] = None
    ) -> Optional[OzonPosting]:
        """
        同步单个 posting（保留向后兼容）

        注意：推荐使用 sync_postings_batch 进行批量处理

        Args:
            db: 数据库会话
            posting_data: OZON API 返回的 posting 数据
            shop_id: 店铺ID
            ozon_order_id: OZON 订单 ID（仅用于日志）
            shop: 店铺对象（可选，如果不传则查询）

        Returns:
            OzonPosting 对象
        """
        posting_number = posting_data.get("posting_number")
        if not posting_number:
            logger.warning(f"Posting without posting_number for order {ozon_order_id}")
            return None

        # 如果没有传入 shop，则查询
        if not shop:
            shop_result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = shop_result.scalar_one_or_none()
            if not shop:
                logger.error(f"Shop {shop_id} not found")
                return None

        # 查找或创建 Posting
        existing_posting_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = existing_posting_result.scalar_one_or_none()

        # 记录是否为新 posting 和旧的取消状态
        is_new_posting = posting is None
        old_is_cancelled = posting.is_cancelled if posting else False

        if not posting:
            posting = OzonPosting(
                shop_id=shop_id,
                posting_number=posting_number,
                ozon_posting_number=posting_data.get("posting_number"),
                status=posting_data.get("status") or "awaiting_packaging",
            )
            db.add(posting)
            logger.info(f"[DEBUG] Created new posting {posting_number}, status={posting.status}")
        else:
            old_status = posting.status
            new_status = posting_data.get("status") or posting.status
            posting.status = new_status
            logger.info(f"[DEBUG] Updating posting {posting_number}: old_status='{old_status}' → new_status='{new_status}'")

        # 更新 posting 详细信息
        self._update_posting_details(posting, posting_data)

        # 更新反范式化字段
        await self._update_denormalized_fields(db, posting, posting_data, shop_id)

        # Flush posting
        await db.flush()

        # 同步包裹信息（使用传入的 shop）
        await self.sync_packages(db, posting, posting_data, shop)

        # 更新 operation_status
        await self._update_operation_status(db, posting, posting_data)

        # 更新商品销量
        await self._update_product_sales(
            db, shop_id, posting_data.get("products", []),
            is_new_posting, old_is_cancelled, posting.is_cancelled,
            posting
        )

        logger.info(
            f"Synced posting {posting_number} for order {ozon_order_id}",
            extra={
                "posting_number": posting_number,
                "ozon_order_id": ozon_order_id,
                "status": posting.status,
                "operation_status": posting.operation_status
            }
        )

        return posting

    def _update_posting_details(self, posting: OzonPosting, posting_data: Dict[str, Any]) -> None:
        """更新 posting 详细信息"""
        posting.substatus = posting_data.get("substatus")
        posting.shipment_date = parse_datetime(posting_data.get("shipment_date"))
        posting.in_process_at = parse_datetime(posting_data.get("in_process_at"))

        # shipped_at: 状态变为运输中的时间（由 webhook 或状态同步设置）
        # 仅当当前状态为 delivering 且 shipped_at 为空时才设置
        if posting_data.get("status") in ("sent_by_seller", "delivering") and not posting.shipped_at:
            posting.shipped_at = utcnow()

        posting.delivered_at = parse_datetime(posting_data.get("delivering_date"))

        # 配送方式信息
        delivery_method = posting_data.get("delivery_method", {})
        if delivery_method:
            posting.delivery_method_id = delivery_method.get("id")
            posting.delivery_method_name = delivery_method.get("name")
            posting.warehouse_id = delivery_method.get("warehouse_id")
            posting.warehouse_name = delivery_method.get("warehouse")

        # 取消信息
        cancellation = posting_data.get("cancellation")
        if cancellation:
            posting.is_cancelled = True
            posting.cancel_reason_id = cancellation.get("cancel_reason_id")
            posting.cancel_reason = cancellation.get("cancel_reason")
            posting.cancelled_at = parse_datetime(cancellation.get("cancelled_at"))
        else:
            posting.is_cancelled = False

        # 保存原始数据
        posting.raw_payload = posting_data

        # 更新 has_tracking_number
        tracking_number = posting_data.get("tracking_number")
        has_tracking = bool(tracking_number and tracking_number.strip())
        posting.has_tracking_number = has_tracking

        # 首次同步到追踪号时记录时间
        if has_tracking and not posting.tracking_synced_at:
            posting.tracking_synced_at = utcnow()

    def _update_denormalized_fields_fast(
        self,
        posting: OzonPosting,
        posting_data: Dict[str, Any],
        skus_with_purchase: Set[int]
    ) -> None:
        """更新反范式化字段（快速版本，使用预查询的采购信息）"""
        from decimal import Decimal

        products = posting_data.get("products", [])
        if not products:
            return

        # 提取 SKU 列表
        skus = list(set(
            str(p.get("sku")) for p in products
            if p.get("sku") is not None
        ))
        posting.product_skus = skus if skus else None

        # 计算 order_total_price（从 products 数组计算）
        total_price = Decimal('0')
        for p in products:
            try:
                price = Decimal(str(p.get("price", 0)))
                quantity = int(p.get("quantity", 1))
                total_price += price * quantity
            except (ValueError, TypeError, KeyError):
                pass
        posting.order_total_price = total_price

        # 计算 has_purchase_info
        if skus:
            sku_ints = [int(s) for s in skus if s.isdigit()]
            if sku_ints:
                # 检查所有 SKU 是否都有采购信息
                posting.has_purchase_info = all(sku in skus_with_purchase for sku in sku_ints)
            else:
                posting.has_purchase_info = False
        else:
            posting.has_purchase_info = False

    async def _update_denormalized_fields(
        self,
        db: AsyncSession,
        posting: OzonPosting,
        posting_data: Dict[str, Any],
        shop_id: int
    ) -> None:
        """更新反范式化字段（单条处理版本）"""
        from decimal import Decimal

        products = posting_data.get("products", [])
        if not products:
            return

        # 提取 SKU 列表
        skus = list(set(
            str(p.get("sku")) for p in products
            if p.get("sku") is not None
        ))
        posting.product_skus = skus if skus else None

        # 计算 order_total_price（从 products 数组计算）
        total_price = Decimal('0')
        for p in products:
            try:
                price = Decimal(str(p.get("price", 0)))
                quantity = int(p.get("quantity", 1))
                total_price += price * quantity
            except (ValueError, TypeError, KeyError):
                pass
        posting.order_total_price = total_price

        # 计算 has_purchase_info
        if skus:
            sku_ints = [int(s) for s in skus if s.isdigit()]
            if sku_ints:
                result = await db.execute(
                    select(func.count(OzonProduct.id))
                    .where(
                        OzonProduct.shop_id == shop_id,
                        OzonProduct.ozon_sku.in_(sku_ints),
                        OzonProduct.purchase_url.isnot(None),
                        OzonProduct.purchase_url != ''
                    )
                )
                products_with_purchase = result.scalar() or 0
                posting.has_purchase_info = (products_with_purchase == len(sku_ints))
            else:
                posting.has_purchase_info = False
        else:
            posting.has_purchase_info = False

    async def _update_operation_status(
        self,
        db: AsyncSession,
        posting: OzonPosting,
        posting_data: Dict[str, Any]
    ) -> None:
        """更新 operation_status"""
        from ...posting_status_manager import PostingStatusManager

        # 初始状态设置
        if not posting.operation_status:
            ozon_status = posting_data.get("status", "")
            await db.flush()
            new_status, _ = PostingStatusManager.calculate_operation_status(
                posting=posting,
                ozon_status=ozon_status,
                preserve_manual=False
            )
            posting.operation_status = new_status
            logger.debug(
                f"Set initial operation_status for posting {posting.posting_number}: "
                f"{new_status} (OZON status: {ozon_status})"
            )

        # 状态同步
        await PostingStatusManager.update_posting_status(
            posting=posting,
            ozon_status=posting.status,
            db=db,
            source="sync",
            preserve_manual=True
        )

    async def _update_product_sales(
        self,
        db: AsyncSession,
        shop_id: int,
        products: List[Dict],
        is_new_posting: bool,
        old_is_cancelled: bool,
        new_is_cancelled: bool,
        posting: OzonPosting
    ) -> None:
        """更新商品销量统计"""
        from .sales_updater import SalesUpdater

        sales_updater = SalesUpdater()

        if is_new_posting and not new_is_cancelled:
            # 新订单，增加销量
            order_time = posting.in_process_at or posting.shipment_date or utcnow()
            await sales_updater.update_product_sales(db, shop_id, products, delta=1, order_time=order_time)
            logger.debug(f"Increased sales for new posting {posting.posting_number}")
        elif not is_new_posting:
            if not old_is_cancelled and new_is_cancelled:
                # 订单取消，减少销量
                await sales_updater.update_product_sales(db, shop_id, products, delta=-1, order_time=None)
                logger.debug(f"Decreased sales for cancelled posting {posting.posting_number}")
            elif old_is_cancelled and not new_is_cancelled:
                # 订单恢复，增加销量
                order_time = posting.in_process_at or posting.shipment_date or utcnow()
                await sales_updater.update_product_sales(db, shop_id, products, delta=1, order_time=order_time)
                logger.debug(f"Restored sales for uncancelled posting {posting.posting_number}")

    async def _sync_packages_fast(
        self,
        db: AsyncSession,
        posting: OzonPosting,
        posting_data: Dict[str, Any],
        shop: OzonShop,
        existing_packages: Dict[str, OzonShipmentPackage]
    ) -> List[OzonShipmentPackage]:
        """
        同步包裹信息（批量优化版）

        Args:
            db: 数据库会话
            posting: Posting 对象
            posting_data: OZON API 返回的 posting 数据
            shop: 店铺对象
            existing_packages: 已存在的包裹 {package_number: package}

        Returns:
            新创建的包裹列表
        """
        posting_status = posting_data.get("status")
        needs_tracking = posting_status in ["awaiting_deliver", "delivering", "delivered"]

        # 检查列表 API 返回的 packages
        packages_from_list = posting_data.get("packages", [])
        has_valid_tracking = False

        if packages_from_list:
            for pkg in packages_from_list:
                tracking = pkg.get("tracking_number")
                if tracking and tracking != posting.posting_number:
                    has_valid_tracking = True
                    break

        # 决定数据来源
        if packages_from_list and (has_valid_tracking or not needs_tracking):
            packages_list = packages_from_list
        elif needs_tracking:
            # 调用详情接口
            try:
                client = OzonAPIClient(shop.client_id, shop.api_key_enc)
                detail_response = await client.get_posting_details(posting.posting_number)
                detail_data = detail_response.get("result", {})

                if detail_data.get("packages"):
                    packages_list = detail_data["packages"]
                else:
                    return []

            except Exception as e:
                logger.warning(f"Failed to fetch package details for posting {posting.posting_number}: {e}")
                return []
        else:
            return []

        # 处理包裹信息
        new_packages: List[OzonShipmentPackage] = []

        for package_data in packages_list:
            package_number = package_data.get("package_number") or package_data.get("id")
            if not package_number:
                continue

            package = existing_packages.get(package_number)

            if not package:
                package = OzonShipmentPackage(
                    posting_id=posting.id,
                    package_number=package_number
                )
                new_packages.append(package)

            # 更新包裹信息
            raw_tracking_number = package_data.get("tracking_number")
            if raw_tracking_number and raw_tracking_number == posting.posting_number:
                package.tracking_number = None
            else:
                package.tracking_number = raw_tracking_number

            package.carrier_name = package_data.get("carrier_name")
            package.carrier_code = package_data.get("carrier_code")
            package.status = package_data.get("status")

            if package_data.get("status_updated_at"):
                package.status_updated_at = parse_datetime(package_data["status_updated_at"])

        return new_packages

    async def sync_packages(
        self,
        db: AsyncSession,
        posting: OzonPosting,
        posting_data: Dict[str, Any],
        shop: Optional[OzonShop]
    ) -> None:
        """
        同步包裹信息（单条处理版本，保留向后兼容）

        Args:
            db: 数据库会话
            posting: Posting 对象
            posting_data: OZON API 返回的 posting 数据
            shop: 店铺对象
        """
        posting_status = posting_data.get("status")
        needs_tracking = posting_status in ["awaiting_deliver", "delivering", "delivered"]

        # 检查列表 API 返回的 packages
        packages_from_list = posting_data.get("packages", [])
        has_valid_tracking = False

        if packages_from_list:
            for pkg in packages_from_list:
                tracking = pkg.get("tracking_number")
                if tracking and tracking != posting.posting_number:
                    has_valid_tracking = True
                    break

        # 决定数据来源
        if packages_from_list and (has_valid_tracking or not needs_tracking):
            packages_list = packages_from_list
            logger.info(f"Using {len(packages_list)} packages from list API for posting {posting.posting_number}")
        elif needs_tracking:
            # 调用详情接口
            if not shop:
                logger.warning(f"Shop not provided for posting {posting.posting_number}")
                return

            try:
                client = OzonAPIClient(shop.client_id, shop.api_key_enc)
                detail_response = await client.get_posting_details(posting.posting_number)
                detail_data = detail_response.get("result", {})

                if detail_data.get("packages"):
                    packages_list = detail_data["packages"]
                    logger.info(f"Fetched {len(packages_list)} packages from detail API for posting {posting.posting_number}")
                else:
                    logger.info(f"No packages found in detail API for posting {posting.posting_number}")
                    return

            except Exception as e:
                logger.warning(f"Failed to fetch package details for posting {posting.posting_number}: {e}")
                return
        else:
            return

        # 处理包裹信息
        for package_data in packages_list:
            package_number = package_data.get("package_number") or package_data.get("id")
            if not package_number:
                logger.warning(f"Package without package_number for posting {posting.posting_number}")
                continue

            # 查找或创建包裹
            existing_package_result = await db.execute(
                select(OzonShipmentPackage).where(
                    and_(
                        OzonShipmentPackage.posting_id == posting.id,
                        OzonShipmentPackage.package_number == package_number
                    )
                )
            )
            package = existing_package_result.scalar_one_or_none()

            if not package:
                package = OzonShipmentPackage(
                    posting_id=posting.id,
                    package_number=package_number
                )
                db.add(package)

            # 更新包裹信息
            raw_tracking_number = package_data.get("tracking_number")
            if raw_tracking_number and raw_tracking_number == posting.posting_number:
                logger.warning(
                    f"Ignoring invalid tracking_number (same as posting_number) "
                    f"for package {package_number} in posting {posting.posting_number}"
                )
                package.tracking_number = None
            else:
                package.tracking_number = raw_tracking_number

            package.carrier_name = package_data.get("carrier_name")
            package.carrier_code = package_data.get("carrier_code")
            package.status = package_data.get("status")

            if package_data.get("status_updated_at"):
                package.status_updated_at = parse_datetime(package_data["status_updated_at"])
