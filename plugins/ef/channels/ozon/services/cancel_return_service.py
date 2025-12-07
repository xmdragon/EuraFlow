"""
OZON 取消和退货申请同步服务
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Any, Optional, Callable, Awaitable
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from ef_core.database import get_db_manager
from ..models import OzonShop, OzonPosting
from ..models.cancel_return import OzonCancellation, OzonReturn
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)


class CancelReturnService:
    """取消和退货申请同步服务"""

    def __init__(self):
        self.db_manager = get_db_manager()

    async def sync_cancellations(
        self,
        config: Dict[str, Any],
        progress_callback: Optional[Callable[[int, str], Awaitable[None]]] = None
    ) -> Dict[str, Any]:
        """
        同步取消申请数据（定时任务处理函数）

        Args:
            config: 配置参数
                - shop_id: 店铺ID（可选，默认所有活跃店铺）
                - last_id: 上次同步的last_id（可选）
            progress_callback: 进度回调函数 callback(progress: int, message: str)

        Returns:
            同步结果
        """
        logger.info(f"开始同步取消申请数据，config={config}")

        total_synced = 0
        total_updated = 0
        shops_synced = []

        async with self.db_manager.get_session() as db:
            # 获取要同步的店铺列表
            shop_id = config.get("shop_id")
            logger.info(f"从config获取shop_id: {shop_id}, type: {type(shop_id)}")

            if shop_id:
                # 同步指定店铺
                logger.info(f"查询指定店铺 {shop_id}（必须status=active）")
                result = await db.execute(
                    select(OzonShop).where(
                        OzonShop.id == shop_id,
                        OzonShop.status == "active"
                    )
                )
                shops = result.scalars().all()
                logger.info(f"查询到 {len(shops)} 个活跃店铺")
            else:
                # 同步所有活跃店铺
                logger.info("查询所有活跃店铺")
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()
                logger.info(f"查询到 {len(shops)} 个活跃店铺")

            total_shops = len(shops)
            for idx, shop in enumerate(shops, 1):
                try:
                    # 更新进度
                    if progress_callback:
                        progress = int((idx - 1) / total_shops * 100)
                        await progress_callback(progress, f"正在同步店铺 {shop.shop_name} ({idx}/{total_shops})...")

                    synced_count, updated_count = await self._sync_shop_cancellations(
                        db=db,
                        shop=shop,
                        last_id=config.get("last_id", 0)
                    )

                    total_synced += synced_count
                    total_updated += updated_count
                    shops_synced.append({
                        "shop_id": shop.id,
                        "shop_name": shop.shop_name,
                        "synced_count": synced_count,
                        "updated_count": updated_count
                    })

                    logger.info(f"店铺 {shop.shop_name} 取消申请同步完成，新增 {synced_count} 条，更新 {updated_count} 条")

                    # 更新进度
                    if progress_callback:
                        progress = int(idx / total_shops * 100)
                        await progress_callback(progress, f"已完成 {idx}/{total_shops} 个店铺")

                except Exception as e:
                    logger.error(f"店铺 {shop.shop_name} 取消申请同步失败: {e}", exc_info=True)
                    continue

        return {
            "records_synced": total_synced,
            "records_updated": total_updated,
            "message": f"同步完成：{len(shops_synced)}个店铺，新增{total_synced}条，更新{total_updated}条",
            "shops": shops_synced
        }

    async def _sync_shop_cancellations(
        self,
        db: AsyncSession,
        shop: Any,
        last_id: int = 0
    ) -> tuple[int, int]:
        """
        同步单个店铺的取消申请

        Args:
            db: 数据库会话
            shop: 店铺对象
            last_id: 上次同步的last_id

        Returns:
            (新增数量, 更新数量)
        """
        synced_count = 0
        updated_count = 0

        # 创建OZON API客户端
        async with OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        ) as client:
            # 分页获取取消申请列表
            current_last_id = last_id
            has_more = True

            while has_more:
                logger.info(f"调用 OZON API，参数：last_id={current_last_id}, limit=500, filters={{'state': 'ALL'}}")

                response = await client.get_conditional_cancellation_list(
                    last_id=current_last_id,
                    limit=500,  # OZON API 最大值为500
                    filters={"state": "ALL"}  # 获取所有状态的取消申请
                )

                logger.info(f"OZON API 完整响应：{response}")

                # OZON API 响应格式：{'result': [...], 'last_id': 0, 'counter': 0}
                # result 字段直接就是数组，不是包含 items 的对象
                cancellations = response.get("result", [])
                next_last_id = response.get("last_id", 0)
                counter = response.get("counter", 0)

                logger.info(f"OZON API 返回：{len(cancellations)} 条取消申请，last_id={next_last_id}, counter={counter}")

                for cancellation_data in cancellations:
                    try:
                        is_updated = await self._save_cancellation(db, shop.id, cancellation_data)
                        if is_updated:
                            updated_count += 1
                        else:
                            synced_count += 1
                    except Exception as e:
                        logger.error(f"保存取消申请失败: {e}", exc_info=True)
                        continue

                # 提交批次
                await db.commit()

                # 更新分页状态：如果 result 为空或 last_id 没变化，说明没有更多数据
                if len(cancellations) > 0 and next_last_id > current_last_id:
                    current_last_id = next_last_id
                else:
                    has_more = False

        return synced_count, updated_count

    async def _save_cancellation(
        self,
        db: AsyncSession,
        shop_id: int,
        data: Dict[str, Any]
    ) -> bool:
        """
        保存取消申请到数据库

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            data: OZON取消申请数据

        Returns:
            True表示更新现有记录，False表示新增记录
        """
        cancellation_id = data.get("cancellation_id")

        # 查找关联的posting
        posting_number = data.get("posting_number")
        posting_id = None
        order_id = None

        if posting_number:
            result = await db.execute(
                select(OzonPosting).where(OzonPosting.posting_number == posting_number)
            )
            posting = result.scalar_one_or_none()
            if posting:
                posting_id = posting.id

        # 检查是否已存在
        result = await db.execute(
            select(OzonCancellation).where(
                OzonCancellation.shop_id == shop_id,
                OzonCancellation.cancellation_id == cancellation_id
            )
        )
        existing = result.scalar_one_or_none()

        # 准备数据
        cancellation_dict = {
            "shop_id": shop_id,
            "posting_id": posting_id,
            "order_id": order_id,
            "cancellation_id": cancellation_id,
            "posting_number": posting_number,
            "state": data.get("state", ""),
            "state_name": data.get("state_name"),
            "cancellation_initiator": data.get("cancellation_initiator"),
            "cancellation_reason_id": data.get("cancellation_reason_id"),
            "cancellation_reason_name": data.get("cancellation_reason_name"),
            "cancellation_reason_message": data.get("cancellation_reason_message"),
            "approve_comment": data.get("approve_comment"),
            "approve_date": self._parse_datetime(data.get("approve_date")),
            "auto_approve_date": self._parse_datetime(data.get("auto_approve_date")),
            "order_date": self._parse_datetime(data.get("order_date")),
            "cancelled_at": self._parse_datetime(data.get("cancelled_at")),
            "raw_payload": data,
        }

        if existing:
            # 更新现有记录
            for key, value in cancellation_dict.items():
                if key not in ("shop_id", "cancellation_id"):  # 不更新主键字段
                    setattr(existing, key, value)
            existing.updated_at = datetime.now(timezone.utc)
            return True
        else:
            # 创建新记录
            cancellation = OzonCancellation(**cancellation_dict)
            db.add(cancellation)
            return False

    async def sync_returns(
        self,
        config: Dict[str, Any],
        progress_callback: Optional[Callable[[int, str], Awaitable[None]]] = None
    ) -> Dict[str, Any]:
        """
        同步退货申请数据（定时任务处理函数）

        Args:
            config: 配置参数
                - shop_id: 店铺ID（可选，默认所有活跃店铺）
                - last_id: 上次同步的last_id（可选）
            progress_callback: 进度回调函数 callback(progress: int, message: str)

        Returns:
            同步结果
        """
        logger.info(f"开始同步退货申请数据，config={config}")

        total_synced = 0
        total_updated = 0
        shops_synced = []

        async with self.db_manager.get_session() as db:
            # 获取要同步的店铺列表
            shop_id = config.get("shop_id")
            logger.info(f"从config获取shop_id: {shop_id}, type: {type(shop_id)}")

            if shop_id:
                # 同步指定店铺
                logger.info(f"查询指定店铺 {shop_id}（必须status=active）")
                result = await db.execute(
                    select(OzonShop).where(
                        OzonShop.id == shop_id,
                        OzonShop.status == "active"
                    )
                )
                shops = result.scalars().all()
                logger.info(f"查询到 {len(shops)} 个活跃店铺")
            else:
                # 同步所有活跃店铺
                logger.info("查询所有活跃店铺")
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()
                logger.info(f"查询到 {len(shops)} 个活跃店铺")

            total_shops = len(shops)
            for idx, shop in enumerate(shops, 1):
                try:
                    # 更新进度
                    if progress_callback:
                        progress = int((idx - 1) / total_shops * 100)
                        await progress_callback(progress, f"正在同步店铺 {shop.shop_name} ({idx}/{total_shops})...")

                    synced_count, updated_count = await self._sync_shop_returns(
                        db=db,
                        shop=shop,
                        last_id=config.get("last_id", 0)
                    )

                    total_synced += synced_count
                    total_updated += updated_count
                    shops_synced.append({
                        "shop_id": shop.id,
                        "shop_name": shop.shop_name,
                        "synced_count": synced_count,
                        "updated_count": updated_count
                    })

                    logger.info(f"店铺 {shop.shop_name} 退货申请同步完成，新增 {synced_count} 条，更新 {updated_count} 条")

                    # 更新进度
                    if progress_callback:
                        progress = int(idx / total_shops * 100)
                        await progress_callback(progress, f"已完成 {idx}/{total_shops} 个店铺")

                except Exception as e:
                    logger.error(f"店铺 {shop.shop_name} 退货申请同步失败: {e}", exc_info=True)
                    continue

        return {
            "records_synced": total_synced,
            "records_updated": total_updated,
            "message": f"同步完成：{len(shops_synced)}个店铺，新增{total_synced}条，更新{total_updated}条",
            "shops": shops_synced
        }

    async def _sync_shop_returns(
        self,
        db: AsyncSession,
        shop: Any,
        last_id: int = 0
    ) -> tuple[int, int]:
        """
        同步单个店铺的退货申请

        Args:
            db: 数据库会话
            shop: 店铺对象
            last_id: 上次同步的last_id

        Returns:
            (新增数量, 更新数量)
        """
        synced_count = 0
        updated_count = 0

        # 创建OZON API客户端
        async with OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        ) as client:
            # 分页获取退货申请列表
            current_last_id = last_id
            has_more = True

            while has_more:
                logger.info(f"调用 OZON 退货API，参数：last_id={current_last_id}, limit=500, filter=None（不传filter获取所有）")

                response = await client.get_returns_rfbs_list(
                    last_id=current_last_id,
                    limit=500,  # OZON API 最大值为500
                    filters=None  # 不传 filter 参数，获取所有状态
                )

                logger.info(f"OZON 退货API 完整响应：{response}")

                # ⚠️ 注意：退货API响应格式和取消API完全不同！
                # 退货API：{'returns': [...], 'has_next': bool}
                # 取消API：{'result': [...], 'last_id': int, 'counter': int}
                returns = response.get("returns", [])
                has_next = response.get("has_next", False)

                logger.info(f"OZON 退货API 返回：{len(returns)} 条退货申请，has_next={has_next}")

                # 第一阶段：保存基本数据
                return_ids_to_fetch_detail = []
                for return_data in returns:
                    try:
                        is_updated = await self._save_return(db, shop.id, return_data)
                        if is_updated:
                            updated_count += 1
                        else:
                            synced_count += 1

                        # 记录需要获取详情的 return_id
                        return_id = return_data.get("return_id")
                        if return_id:
                            return_ids_to_fetch_detail.append(return_id)
                    except Exception as e:
                        logger.error(f"保存退货申请失败: {e}", exc_info=True)
                        continue

                # 提交基本数据，释放事务锁
                await db.commit()

                # 第二阶段：获取详情（在事务外进行 API 调用，避免长时间持有事务）
                for return_id in return_ids_to_fetch_detail:
                    try:
                        await self._fetch_and_update_return_detail(db, shop, return_id)
                    except Exception as detail_error:
                        logger.warning(f"获取退货详情失败 (return_id={return_id}): {detail_error}")
                        # 详情获取失败不影响主流程，继续处理

                # 提交详情更新
                await db.commit()

                # ⚠️ 退货API分页逻辑：使用 has_next 判断，从最后一条记录获取 id
                if has_next and len(returns) > 0:
                    # 获取最后一条记录的ID作为下次请求的 last_id
                    last_return = returns[-1]
                    current_last_id = int(last_return.get("id", 0))
                    logger.info(f"继续分页，下次 last_id={current_last_id}")
                else:
                    has_more = False
                    logger.info("分页结束，无更多数据")

        return synced_count, updated_count

    async def _save_return(
        self,
        db: AsyncSession,
        shop_id: int,
        data: Dict[str, Any]
    ) -> bool:
        """
        保存退货申请到数据库

        Args:
            db: 数据库会话
            shop_id: 店铺ID
            data: OZON退货申请数据

        Returns:
            True表示更新现有记录，False表示新增记录
        """
        return_id = data.get("return_id")

        # 查找关联的posting
        posting_number = data.get("posting_number")
        posting_id = None
        order_id = None

        if posting_number:
            result = await db.execute(
                select(OzonPosting).where(OzonPosting.posting_number == posting_number)
            )
            posting = result.scalar_one_or_none()
            if posting:
                posting_id = posting.id

        # 检查是否已存在
        result = await db.execute(
            select(OzonReturn).where(
                OzonReturn.shop_id == shop_id,
                OzonReturn.return_id == return_id
            )
        )
        existing = result.scalar_one_or_none()

        # 提取嵌套字段
        state_obj = data.get("state", {}) if isinstance(data.get("state"), dict) else {}
        product_obj = data.get("product", {}) if isinstance(data.get("product"), dict) else {}

        # 准备数据
        return_dict = {
            "shop_id": shop_id,
            "posting_id": posting_id,
            "order_id": order_id,
            "return_id": return_id,
            "return_number": data.get("return_number", ""),
            "posting_number": posting_number,
            "order_number": data.get("order_number"),
            "client_name": data.get("client_name"),
            # 从 product 对象中提取商品信息
            "product_name": product_obj.get("name"),
            "offer_id": product_obj.get("offer_id"),
            "sku": product_obj.get("sku"),
            "price": Decimal(str(product_obj.get("price", 0))) if product_obj.get("price") else None,
            "currency_code": product_obj.get("currency_code"),
            # ⚠️ 所有状态字段都在 state 对象内部！
            "group_state": state_obj.get("group_state", ""),
            "state": state_obj.get("state", ""),
            "state_name": state_obj.get("state_name"),
            "money_return_state_name": state_obj.get("money_return_state_name"),
            "created_at_ozon": self._parse_datetime(data.get("created_at")),
            "raw_payload": data,
        }

        if existing:
            # 更新现有记录
            for key, value in return_dict.items():
                if key not in ("shop_id", "return_id"):  # 不更新主键字段
                    setattr(existing, key, value)
            existing.updated_at = datetime.now(timezone.utc)
            return True
        else:
            # 创建新记录
            return_obj = OzonReturn(**return_dict)
            db.add(return_obj)
            return False

    async def get_cancellation_list(
        self,
        shop_id: Optional[int],
        page: int,
        limit: int,
        filters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        获取取消申请列表

        Args:
            shop_id: 店铺ID（None表示所有店铺）
            page: 页码
            limit: 每页数量
            filters: 筛选条件（state/initiator/posting_number/date_from/date_to）

        Returns:
            分页数据：{"items": [...], "total": 156, "page": 1, "limit": 50}
        """
        async with self.db_manager.get_session() as db:
            # 构建查询条件
            conditions = []

            if shop_id:
                conditions.append(OzonCancellation.shop_id == shop_id)

            if filters.get("state"):
                conditions.append(OzonCancellation.state == filters["state"])

            if filters.get("initiator"):
                conditions.append(OzonCancellation.cancellation_initiator == filters["initiator"])

            if filters.get("posting_number"):
                conditions.append(OzonCancellation.posting_number.like(f"%{filters['posting_number']}%"))

            if filters.get("date_from"):
                conditions.append(OzonCancellation.cancelled_at >= filters["date_from"])

            if filters.get("date_to"):
                conditions.append(OzonCancellation.cancelled_at <= filters["date_to"])

            # 查询总数
            count_query = select(func.count()).select_from(OzonCancellation)
            if conditions:
                count_query = count_query.where(and_(*conditions))

            total_result = await db.execute(count_query)
            total = total_result.scalar()

            # 查询数据
            query = select(OzonCancellation).where(and_(*conditions)) if conditions else select(OzonCancellation)
            query = query.order_by(OzonCancellation.cancelled_at.desc())
            query = query.offset((page - 1) * limit).limit(limit)

            result = await db.execute(query)
            cancellations = result.scalars().all()

            # 转换为字典列表
            items = []
            for cancellation in cancellations:
                items.append({
                    "id": cancellation.id,
                    "cancellation_id": cancellation.cancellation_id,
                    "posting_number": cancellation.posting_number,
                    "order_date": cancellation.order_date.isoformat() if cancellation.order_date else None,
                    "cancelled_at": cancellation.cancelled_at.isoformat() if cancellation.cancelled_at else None,
                    "cancellation_initiator": cancellation.cancellation_initiator,
                    "cancellation_reason_name": cancellation.cancellation_reason_name,
                    "state": cancellation.state,
                    "state_name": cancellation.state_name,
                    "auto_approve_date": cancellation.auto_approve_date.isoformat() if cancellation.auto_approve_date else None,
                })

            return {
                "items": items,
                "total": total,
                "page": page,
                "limit": limit
            }

    async def get_return_list(
        self,
        shop_id: Optional[int],
        page: int,
        limit: int,
        filters: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        获取退货申请列表

        Args:
            shop_id: 店铺ID（None表示所有店铺）
            page: 页码
            limit: 每页数量
            filters: 筛选条件（group_state/posting_number/offer_id/date_from/date_to）

        Returns:
            分页数据：{"items": [...], "total": 89, "page": 1, "limit": 50}
        """
        async with self.db_manager.get_session() as db:
            # 构建查询条件
            conditions = []

            if shop_id:
                conditions.append(OzonReturn.shop_id == shop_id)

            if filters.get("group_state"):
                conditions.append(OzonReturn.group_state == filters["group_state"])

            if filters.get("posting_number"):
                conditions.append(OzonReturn.posting_number.like(f"%{filters['posting_number']}%"))

            if filters.get("offer_id"):
                conditions.append(OzonReturn.offer_id.like(f"%{filters['offer_id']}%"))

            if filters.get("date_from"):
                conditions.append(OzonReturn.created_at_ozon >= filters["date_from"])

            if filters.get("date_to"):
                conditions.append(OzonReturn.created_at_ozon <= filters["date_to"])

            # 查询总数
            count_query = select(func.count()).select_from(OzonReturn)
            if conditions:
                count_query = count_query.where(and_(*conditions))

            total_result = await db.execute(count_query)
            total = total_result.scalar()

            # 查询数据（JOIN 商品表获取图片）
            from ..models import OzonProduct
            # 从 images JSON 字段中提取 primary 图片 URL（使用 ->> 操作符）
            image_url_expr = OzonProduct.images['primary'].astext
            query = (
                select(OzonReturn, image_url_expr)
                .outerjoin(OzonProduct, OzonReturn.sku == OzonProduct.ozon_sku)
            )
            if conditions:
                query = query.where(and_(*conditions))
            query = query.order_by(OzonReturn.created_at_ozon.desc())
            query = query.offset((page - 1) * limit).limit(limit)

            result = await db.execute(query)
            rows = result.all()

            # 转换为字典列表
            items = []
            for return_obj, primary_image in rows:
                items.append({
                    "id": return_obj.id,
                    "return_id": return_obj.return_id,
                    "return_number": return_obj.return_number,
                    "posting_number": return_obj.posting_number,
                    "order_number": return_obj.order_number,
                    "client_name": self._mask_client_name(return_obj.client_name),  # 脱敏
                    "product_name": return_obj.product_name,
                    "offer_id": return_obj.offer_id,
                    "sku": return_obj.sku,
                    "price": str(return_obj.price) if return_obj.price else None,
                    "currency_code": return_obj.currency_code,
                    "group_state": return_obj.group_state,
                    "state": return_obj.state,  # 详细状态标识
                    "state_name": return_obj.state_name,
                    "money_return_state_name": return_obj.money_return_state_name,
                    "delivery_method_name": return_obj.delivery_method_name,
                    # 从详情API获取的字段
                    "return_reason_id": return_obj.return_reason_id,
                    "return_reason_name": return_obj.return_reason_name,
                    "rejection_reason_id": return_obj.rejection_reason_id,
                    "rejection_reason_name": return_obj.rejection_reason_name,
                    "return_method_description": return_obj.return_method_description,
                    "created_at_ozon": return_obj.created_at_ozon.isoformat() if return_obj.created_at_ozon else None,
                    # 商品图片（从商品表JOIN获取）
                    "image_url": primary_image,
                })

            return {
                "items": items,
                "total": total,
                "page": page,
                "limit": limit
            }

    async def get_return_detail(
        self,
        return_id: int,
        current_user: Any,
        db: AsyncSession
    ) -> Optional[Dict[str, Any]]:
        """
        获取退货申请详情

        Args:
            return_id: 退货申请ID
            current_user: 当前用户
            db: 数据库会话

        Returns:
            退货申请详情字典，如果不存在或无权限则返回None
        """
        from ..models import OzonProduct
        from ..api.permissions import filter_by_shop_permission

        # 查询退货申请（JOIN 商品表获取图片）
        image_url_expr = OzonProduct.images['primary'].astext
        query = (
            select(OzonReturn, image_url_expr)
            .outerjoin(OzonProduct, OzonReturn.sku == OzonProduct.ozon_sku)
            .where(OzonReturn.return_id == return_id)
        )

        result = await db.execute(query)
        row = result.first()

        if not row:
            return None

        return_obj, primary_image = row

        # 权限校验
        try:
            allowed_shop_ids = await filter_by_shop_permission(current_user, db, return_obj.shop_id)
            if return_obj.shop_id not in allowed_shop_ids:
                return None
        except Exception:
            return None

        # 返回详情
        return {
            "id": return_obj.id,
            "return_id": return_obj.return_id,
            "return_number": return_obj.return_number,
            "posting_number": return_obj.posting_number,
            "order_number": return_obj.order_number,
            "client_name": self._mask_client_name(return_obj.client_name),
            "product_name": return_obj.product_name,
            "offer_id": return_obj.offer_id,
            "sku": return_obj.sku,
            "price": str(return_obj.price) if return_obj.price else None,
            "currency_code": return_obj.currency_code,
            "group_state": return_obj.group_state,
            "state": return_obj.state,
            "state_name": return_obj.state_name,
            "money_return_state_name": return_obj.money_return_state_name,
            "delivery_method_name": return_obj.delivery_method_name,
            "return_reason_id": return_obj.return_reason_id,
            "return_reason_name": return_obj.return_reason_name,
            "rejection_reason_id": return_obj.rejection_reason_id,
            "rejection_reason_name": return_obj.rejection_reason_name,
            "return_method_description": return_obj.return_method_description,
            "created_at_ozon": return_obj.created_at_ozon.isoformat() if return_obj.created_at_ozon else None,
            "image_url": primary_image,
        }

    async def _fetch_and_update_return_detail(
        self,
        db: AsyncSession,
        shop: Any,
        return_id: int
    ) -> None:
        """
        获取退货详情并更新数据库

        Args:
            db: 数据库会话
            shop: 店铺对象
            return_id: 退货申请ID
        """
        from ..api.client import OzonAPIClient

        # 使用 async with 确保 API 客户端正确关闭
        async with OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        ) as client:
            # 调用详情API
            detail_response = await client.get_return_rfbs_info(return_id)

        # 提取详情数据（从 returns 字段）
        detail_data = detail_response.get("returns", {})
        if not detail_data:
            logger.warning(f"退货详情API返回空数据: return_id={return_id}")
            return

        # 查询数据库记录
        result = await db.execute(
            select(OzonReturn).where(
                OzonReturn.shop_id == shop.id,
                OzonReturn.return_id == return_id
            )
        )
        return_obj = result.scalar_one_or_none()

        if not return_obj:
            logger.warning(f"未找到退货记录: return_id={return_id}")
            return

        # 更新详情字段（从嵌套对象中提取）
        return_obj.return_method_description = detail_data.get("return_method_description")
        return_obj.available_actions = detail_data.get("available_actions")

        # 退货原因（嵌套对象）
        return_reason = detail_data.get("return_reason", {})
        if return_reason:
            return_obj.return_reason_id = return_reason.get("id")
            return_obj.return_reason_name = return_reason.get("name")

        # 拒绝原因（数组）
        rejection_reasons = detail_data.get("rejection_reason", [])
        if rejection_reasons and len(rejection_reasons) > 0:
            first_rejection = rejection_reasons[0]
            return_obj.rejection_reason_id = first_rejection.get("id")
            return_obj.rejection_reason_name = first_rejection.get("name")
            return_obj.rejection_reasons = rejection_reasons

        # 退款状态（从state中提取）
        state_data = detail_data.get("state", {})
        if state_data:
            return_obj.state_name = state_data.get("state_name")

        # 从posting表获取配送方式（如果return_obj有posting_id）
        if return_obj.posting_id:
            posting_result = await db.execute(
                select(OzonPosting.delivery_method_name).where(
                    OzonPosting.id == return_obj.posting_id
                )
            )
            delivery_method_name = posting_result.scalar_one_or_none()
            if delivery_method_name:
                return_obj.delivery_method_name = delivery_method_name

        return_obj.updated_at = datetime.now(timezone.utc)

        logger.debug(f"更新退货详情成功: return_id={return_id}")

    @staticmethod
    def _parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
        """解析日期时间字符串"""
        if not dt_str:
            return None
        try:
            # OZON API返回的时间格式：2025-11-15T10:30:00Z
            if dt_str.endswith('Z'):
                dt_str = dt_str[:-1] + '+00:00'
            return datetime.fromisoformat(dt_str)
        except Exception as e:
            logger.warning(f"解析日期时间失败: {dt_str}, {e}")
            return None

    @staticmethod
    def _mask_client_name(name: Optional[str]) -> Optional[str]:
        """客户姓名脱敏"""
        if not name:
            return None
        if len(name) <= 1:
            return name
        return name[0] + "**"
