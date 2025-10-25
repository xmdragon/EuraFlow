"""
Ozon 促销活动服务
处理促销活动的同步和管理逻辑
"""

import logging
from datetime import datetime
from typing import Dict, Any, List, Optional
from decimal import Decimal

from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OzonShop, OzonProduct, OzonPromotionAction, OzonPromotionProduct
from ..api.client import OzonAPIClient
from ..utils.datetime_utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)


class PromotionService:
    """促销活动服务"""

    @staticmethod
    async def sync_actions(shop_id: int, db: AsyncSession) -> Dict[str, Any]:
        """同步店铺的促销活动清单

        Args:
            shop_id: 店铺ID
            db: 数据库会话

        Returns:
            同步结果统计
        """
        try:
            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc, shop_id=shop_id)

            # 调用OZON API获取活动列表
            response = await client.get_actions()
            actions_data = response.get("result", [])

            synced_count = 0
            for action_data in actions_data:
                action_id = action_data.get("id")
                if not action_id:
                    continue

                # 查找或创建活动记录
                stmt = select(OzonPromotionAction).where(
                    and_(
                        OzonPromotionAction.shop_id == shop_id,
                        OzonPromotionAction.action_id == action_id
                    )
                )
                result = await db.execute(stmt)
                action = result.scalar_one_or_none()

                if action:
                    # 更新现有记录
                    action.title = action_data.get("title")
                    action.description = action_data.get("description")
                    action.date_start = parse_datetime(action_data.get("date_start"))
                    action.date_end = parse_datetime(action_data.get("date_end"))
                    action.status = action_data.get("status", "active")
                    action.raw_data = action_data
                    action.last_sync_at = utcnow()
                else:
                    # 创建新记录
                    action = OzonPromotionAction(
                        shop_id=shop_id,
                        action_id=action_id,
                        title=action_data.get("title"),
                        description=action_data.get("description"),
                        date_start=parse_datetime(action_data.get("date_start")),
                        date_end=parse_datetime(action_data.get("date_end")),
                        status=action_data.get("status", "active"),
                        auto_cancel_enabled=False,
                        raw_data=action_data,
                        last_sync_at=utcnow()
                    )
                    db.add(action)

                synced_count += 1

            await db.commit()
            await client.close()

            logger.info(f"Synced {synced_count} promotion actions for shop {shop_id}")
            return {"synced_count": synced_count}

        except Exception as e:
            logger.error(f"Failed to sync actions for shop {shop_id}: {e}", exc_info=True)
            await db.rollback()
            raise

    @staticmethod
    async def sync_action_candidates(
        shop_id: int, action_id: int, db: AsyncSession
    ) -> Dict[str, Any]:
        """同步活动的候选商品列表

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            db: 数据库会话

        Returns:
            同步结果统计
        """
        try:
            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc, shop_id=shop_id)

            # 分页获取候选商品
            offset = 0
            limit = 100
            synced_count = 0

            while True:
                response = await client.get_action_candidates(action_id, limit=limit, offset=offset)
                products_data = response.get("result", {}).get("products", [])

                if not products_data:
                    break

                for product_data in products_data:
                    ozon_product_id = product_data.get("id")
                    if not ozon_product_id:
                        continue

                    # 查找本地商品
                    stmt = select(OzonProduct).where(
                        and_(
                            OzonProduct.shop_id == shop_id,
                            OzonProduct.ozon_product_id == ozon_product_id
                        )
                    )
                    result = await db.execute(stmt)
                    local_product = result.scalar_one_or_none()

                    # 查找或创建关联记录
                    stmt = select(OzonPromotionProduct).where(
                        and_(
                            OzonPromotionProduct.shop_id == shop_id,
                            OzonPromotionProduct.action_id == action_id,
                            OzonPromotionProduct.ozon_product_id == ozon_product_id
                        )
                    )
                    result = await db.execute(stmt)
                    promo_product = result.scalar_one_or_none()

                    if promo_product:
                        # 更新状态为候选
                        if promo_product.status != "active":  # 不覆盖已参与的商品
                            promo_product.status = "candidate"
                        promo_product.last_sync_at = utcnow()
                    else:
                        # 创建新记录
                        promo_product = OzonPromotionProduct(
                            shop_id=shop_id,
                            action_id=action_id,
                            product_id=local_product.id if local_product else None,
                            ozon_product_id=ozon_product_id,
                            sku=product_data.get("offer_id"),
                            status="candidate",
                            raw_data=product_data,
                            last_sync_at=utcnow()
                        )
                        db.add(promo_product)

                    synced_count += 1

                offset += limit
                if len(products_data) < limit:
                    break

            await db.commit()
            await client.close()

            logger.info(f"Synced {synced_count} candidate products for action {action_id}")
            return {"synced_count": synced_count}

        except Exception as e:
            logger.error(f"Failed to sync candidates for action {action_id}: {e}", exc_info=True)
            await db.rollback()
            raise

    @staticmethod
    async def sync_action_products(
        shop_id: int, action_id: int, db: AsyncSession
    ) -> Dict[str, Any]:
        """同步活动的参与商品列表

        保护逻辑：如果商品已存在且add_mode=manual，不修改add_mode

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            db: 数据库会话

        Returns:
            同步结果统计
        """
        try:
            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc, shop_id=shop_id)

            # 分页获取参与商品
            offset = 0
            limit = 100
            synced_count = 0

            while True:
                response = await client.get_action_products(action_id, limit=limit, offset=offset)
                products_data = response.get("result", {}).get("products", [])

                if not products_data:
                    break

                for product_data in products_data:
                    ozon_product_id = product_data.get("id")
                    if not ozon_product_id:
                        continue

                    # 查找本地商品
                    stmt = select(OzonProduct).where(
                        and_(
                            OzonProduct.shop_id == shop_id,
                            OzonProduct.ozon_product_id == ozon_product_id
                        )
                    )
                    result = await db.execute(stmt)
                    local_product = result.scalar_one_or_none()

                    # 查找或创建关联记录
                    stmt = select(OzonPromotionProduct).where(
                        and_(
                            OzonPromotionProduct.shop_id == shop_id,
                            OzonPromotionProduct.action_id == action_id,
                            OzonPromotionProduct.ozon_product_id == ozon_product_id
                        )
                    )
                    result = await db.execute(stmt)
                    promo_product = result.scalar_one_or_none()

                    if promo_product:
                        # 更新现有记录
                        promo_product.status = "active"
                        promo_product.promotion_price = Decimal(str(product_data.get("action_price", 0)))
                        promo_product.promotion_stock = product_data.get("stock", 0)
                        promo_product.raw_data = product_data
                        promo_product.last_sync_at = utcnow()

                        # 保护逻辑：如果是manual，不修改add_mode
                        if promo_product.add_mode != "manual":
                            promo_product.add_mode = product_data.get("add_mode", "automatic")
                    else:
                        # 创建新记录（从OZON同步的默认为automatic）
                        promo_product = OzonPromotionProduct(
                            shop_id=shop_id,
                            action_id=action_id,
                            product_id=local_product.id if local_product else None,
                            ozon_product_id=ozon_product_id,
                            sku=product_data.get("offer_id"),
                            status="active",
                            promotion_price=Decimal(str(product_data.get("action_price", 0))),
                            promotion_stock=product_data.get("stock", 0),
                            add_mode=product_data.get("add_mode", "automatic"),
                            activated_at=utcnow(),
                            raw_data=product_data,
                            last_sync_at=utcnow()
                        )
                        db.add(promo_product)

                    synced_count += 1

                offset += limit
                if len(products_data) < limit:
                    break

            await db.commit()
            await client.close()

            logger.info(f"Synced {synced_count} active products for action {action_id}")
            return {"synced_count": synced_count}

        except Exception as e:
            logger.error(f"Failed to sync products for action {action_id}: {e}", exc_info=True)
            await db.rollback()
            raise

    @staticmethod
    async def get_actions_with_stats(
        shop_id: int, db: AsyncSession
    ) -> List[Dict[str, Any]]:
        """获取活动列表（带统计）

        Args:
            shop_id: 店铺ID
            db: 数据库会话

        Returns:
            活动列表，包含候选和参与商品数量
        """
        # 查询活动列表
        stmt = select(OzonPromotionAction).where(
            OzonPromotionAction.shop_id == shop_id
        ).order_by(OzonPromotionAction.date_start.desc())

        result = await db.execute(stmt)
        actions = result.scalars().all()

        actions_list = []
        for action in actions:
            # 统计候选商品数
            stmt = select(func.count()).select_from(OzonPromotionProduct).where(
                and_(
                    OzonPromotionProduct.shop_id == shop_id,
                    OzonPromotionProduct.action_id == action.action_id,
                    OzonPromotionProduct.status == "candidate"
                )
            )
            result = await db.execute(stmt)
            candidate_count = result.scalar()

            # 统计参与商品数
            stmt = select(func.count()).select_from(OzonPromotionProduct).where(
                and_(
                    OzonPromotionProduct.shop_id == shop_id,
                    OzonPromotionProduct.action_id == action.action_id,
                    OzonPromotionProduct.status == "active"
                )
            )
            result = await db.execute(stmt)
            active_count = result.scalar()

            # 从 raw_data 中提取所有字段
            raw = action.raw_data or {}

            actions_list.append({
                "id": action.id,
                "action_id": action.action_id,
                "title": action.title,
                "description": action.description,
                "date_start": action.date_start.isoformat() if action.date_start else None,
                "date_end": action.date_end.isoformat() if action.date_end else None,
                "status": action.status,
                "auto_cancel_enabled": action.auto_cancel_enabled,
                "candidate_count": candidate_count,
                "active_count": active_count,
                "last_sync_at": action.last_sync_at.isoformat() if action.last_sync_at else None,
                "created_at": action.created_at.isoformat() if action.created_at else None,
                "updated_at": action.updated_at.isoformat() if action.updated_at else None,
                # 从 raw_data 中提取的所有字段
                "action_type": raw.get("action_type"),
                "action_status": raw.get("action_status"),
                "participation_type": raw.get("participation_type"),
                "is_participating": raw.get("is_participating"),
                "mechanics": raw.get("mechanics"),
                "discount_info": raw.get("discount_info"),
                "with_targeting": raw.get("with_targeting"),
                "title_for_buyer": raw.get("title_for_buyer"),
                "title_for_index": raw.get("title_for_index"),
                "order_amount_bound": raw.get("order_amount_bound"),
                "participants_type": raw.get("participants_type"),
                "is_voucher_action": raw.get("is_voucher_action"),
                "raw_data": raw,  # 保留完整的原始数据
            })

        return actions_list

    @staticmethod
    async def get_candidates(
        shop_id: int, action_id: int, db: AsyncSession
    ) -> List[Dict[str, Any]]:
        """获取候选商品列表

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            db: 数据库会话

        Returns:
            候选商品列表
        """
        stmt = (
            select(OzonPromotionProduct, OzonProduct)
            .outerjoin(OzonProduct, OzonPromotionProduct.product_id == OzonProduct.id)
            .where(
                and_(
                    OzonPromotionProduct.shop_id == shop_id,
                    OzonPromotionProduct.action_id == action_id,
                    OzonPromotionProduct.status == "candidate"
                )
            )
        )

        result = await db.execute(stmt)
        rows = result.all()

        products_list = []
        for promo_product, product in rows:
            products_list.append({
                "id": promo_product.id,
                "product_id": promo_product.product_id,
                "ozon_product_id": promo_product.ozon_product_id,
                "sku": product.sku if product else None,  # 从本地商品表获取SKU
                "title": product.title if product else None,
                "price": float(product.price) if product and product.price else 0,
                "stock": product.stock if product else 0,
                "images": product.images if product else [],
            })

        return products_list

    @staticmethod
    async def get_active_products(
        shop_id: int, action_id: int, db: AsyncSession
    ) -> List[Dict[str, Any]]:
        """获取参与活动的商品列表

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            db: 数据库会话

        Returns:
            参与商品列表
        """
        stmt = (
            select(OzonPromotionProduct, OzonProduct)
            .outerjoin(OzonProduct, OzonPromotionProduct.product_id == OzonProduct.id)
            .where(
                and_(
                    OzonPromotionProduct.shop_id == shop_id,
                    OzonPromotionProduct.action_id == action_id,
                    OzonPromotionProduct.status == "active"
                )
            )
        )

        result = await db.execute(stmt)
        rows = result.all()

        products_list = []
        for promo_product, product in rows:
            products_list.append({
                "id": promo_product.id,
                "product_id": promo_product.product_id,
                "ozon_product_id": promo_product.ozon_product_id,
                "sku": product.sku if product else None,  # 从本地商品表获取SKU
                "title": product.title if product else None,
                "promotion_price": float(promo_product.promotion_price) if promo_product.promotion_price else 0,
                "promotion_stock": promo_product.promotion_stock,
                "add_mode": promo_product.add_mode,
                "images": product.images if product else [],
                "activated_at": promo_product.activated_at.isoformat() if promo_product.activated_at else None,
            })

        return products_list

    @staticmethod
    async def activate_products(
        shop_id: int,
        action_id: int,
        products: List[Dict[str, Any]],
        db: AsyncSession
    ) -> Dict[str, Any]:
        """用户手动添加商品到促销活动

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            products: 商品列表 [{"product_id": 123, "promotion_price": 100, "promotion_stock": 10}]
            db: 数据库会话

        Returns:
            操作结果
        """
        try:
            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc, shop_id=shop_id)

            # 构建OZON API请求数据
            api_products = []
            for prod in products:
                # 获取商品信息
                stmt = select(OzonProduct).where(OzonProduct.id == prod["product_id"])
                result = await db.execute(stmt)
                local_product = result.scalar_one_or_none()
                if not local_product:
                    continue

                api_products.append({
                    "product_id": local_product.ozon_product_id,
                    "action_price": str(prod["promotion_price"]),
                    "stock": prod["promotion_stock"]
                })

            # 调用OZON API
            if api_products:
                await client.activate_action_products(action_id, api_products)

            # 更新数据库
            for prod in products:
                stmt = select(OzonProduct).where(OzonProduct.id == prod["product_id"])
                result = await db.execute(stmt)
                local_product = result.scalar_one_or_none()
                if not local_product:
                    continue

                # 查找或创建关联记录
                stmt = select(OzonPromotionProduct).where(
                    and_(
                        OzonPromotionProduct.shop_id == shop_id,
                        OzonPromotionProduct.action_id == action_id,
                        OzonPromotionProduct.product_id == prod["product_id"]
                    )
                )
                result = await db.execute(stmt)
                promo_product = result.scalar_one_or_none()

                if promo_product:
                    promo_product.status = "active"
                    promo_product.promotion_price = Decimal(str(prod["promotion_price"]))
                    promo_product.promotion_stock = prod["promotion_stock"]
                    promo_product.add_mode = "manual"  # 用户添加的标记为manual
                    promo_product.activated_at = utcnow()
                else:
                    promo_product = OzonPromotionProduct(
                        shop_id=shop_id,
                        action_id=action_id,
                        product_id=prod["product_id"],
                        ozon_product_id=local_product.ozon_product_id,
                        sku=local_product.sku,
                        status="active",
                        promotion_price=Decimal(str(prod["promotion_price"])),
                        promotion_stock=prod["promotion_stock"],
                        add_mode="manual",  # 用户添加的标记为manual
                        activated_at=utcnow()
                    )
                    db.add(promo_product)

            await db.commit()
            await client.close()

            logger.info(f"Activated {len(products)} products for action {action_id}")
            return {"success": True, "activated_count": len(products)}

        except Exception as e:
            logger.error(f"Failed to activate products for action {action_id}: {e}", exc_info=True)
            await db.rollback()
            raise

    @staticmethod
    async def deactivate_products(
        shop_id: int,
        action_id: int,
        product_ids: List[int],
        db: AsyncSession
    ) -> Dict[str, Any]:
        """取消商品参与促销

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            product_ids: 商品ID列表
            db: 数据库会话

        Returns:
            操作结果
        """
        try:
            # 获取店铺
            result = await db.execute(select(OzonShop).where(OzonShop.id == shop_id))
            shop = result.scalar_one_or_none()
            if not shop:
                raise ValueError(f"Shop {shop_id} not found")

            # 创建API客户端
            client = OzonAPIClient(shop.client_id, shop.api_key_enc, shop_id=shop_id)

            # 获取OZON商品ID列表
            ozon_product_ids = []
            for product_id in product_ids:
                stmt = select(OzonProduct).where(OzonProduct.id == product_id)
                result = await db.execute(stmt)
                product = result.scalar_one_or_none()
                if product:
                    ozon_product_ids.append(product.ozon_product_id)

            # 调用OZON API
            if ozon_product_ids:
                await client.deactivate_action_products(action_id, ozon_product_ids)

            # 更新数据库状态
            for product_id in product_ids:
                stmt = select(OzonPromotionProduct).where(
                    and_(
                        OzonPromotionProduct.shop_id == shop_id,
                        OzonPromotionProduct.action_id == action_id,
                        OzonPromotionProduct.product_id == product_id
                    )
                )
                result = await db.execute(stmt)
                promo_product = result.scalar_one_or_none()
                if promo_product:
                    promo_product.status = "deactivated"
                    promo_product.deactivated_at = utcnow()

            await db.commit()
            await client.close()

            logger.info(f"Deactivated {len(product_ids)} products from action {action_id}")
            return {"success": True, "deactivated_count": len(product_ids)}

        except Exception as e:
            logger.error(f"Failed to deactivate products from action {action_id}: {e}", exc_info=True)
            await db.rollback()
            raise

    @staticmethod
    async def set_auto_cancel(
        shop_id: int,
        action_id: int,
        enabled: bool,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """切换活动的自动取消开关

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            enabled: 是否启用
            db: 数据库会话

        Returns:
            操作结果
        """
        stmt = select(OzonPromotionAction).where(
            and_(
                OzonPromotionAction.shop_id == shop_id,
                OzonPromotionAction.action_id == action_id
            )
        )
        result = await db.execute(stmt)
        action = result.scalar_one_or_none()

        if not action:
            raise ValueError(f"Action {action_id} not found")

        action.auto_cancel_enabled = enabled
        await db.commit()

        logger.info(f"Set auto_cancel={enabled} for action {action_id}")
        return {"success": True, "auto_cancel_enabled": enabled}

    @staticmethod
    async def set_add_mode(
        shop_id: int,
        action_id: int,
        product_id: int,
        add_mode: str,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """切换商品的 add_mode

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            product_id: 商品ID
            add_mode: manual 或 automatic
            db: 数据库会话

        Returns:
            操作结果
        """
        if add_mode not in ["manual", "automatic"]:
            raise ValueError("add_mode must be 'manual' or 'automatic'")

        stmt = select(OzonPromotionProduct).where(
            and_(
                OzonPromotionProduct.shop_id == shop_id,
                OzonPromotionProduct.action_id == action_id,
                OzonPromotionProduct.product_id == product_id
            )
        )
        result = await db.execute(stmt)
        promo_product = result.scalar_one_or_none()

        if not promo_product:
            raise ValueError(f"Product {product_id} not found in action {action_id}")

        promo_product.add_mode = add_mode
        await db.commit()

        logger.info(f"Set add_mode={add_mode} for product {product_id} in action {action_id}")
        return {"success": True, "add_mode": add_mode}

    @staticmethod
    async def auto_cancel_task(
        shop_id: int,
        action_id: int,
        db: AsyncSession
    ) -> Dict[str, Any]:
        """自动取消任务 - 只处理 add_mode=automatic 的商品

        Args:
            shop_id: 店铺ID
            action_id: 活动ID
            db: 数据库会话

        Returns:
            操作结果
        """
        try:
            # 查询需要取消的商品
            stmt = select(OzonPromotionProduct).where(
                and_(
                    OzonPromotionProduct.shop_id == shop_id,
                    OzonPromotionProduct.action_id == action_id,
                    OzonPromotionProduct.status == "active",
                    OzonPromotionProduct.add_mode == "automatic"
                )
            )
            result = await db.execute(stmt)
            promo_products = result.scalars().all()

            if not promo_products:
                return {"success": True, "cancelled_count": 0}

            # 提取商品ID
            product_ids = [pp.product_id for pp in promo_products if pp.product_id]

            # 调用取消方法
            result = await PromotionService.deactivate_products(
                shop_id, action_id, product_ids, db
            )

            logger.info(
                f"Auto-cancelled {len(product_ids)} products from action {action_id}",
                extra={"shop_id": shop_id, "action_id": action_id, "count": len(product_ids)}
            )

            return result

        except Exception as e:
            logger.error(f"Failed to auto-cancel products for action {action_id}: {e}", exc_info=True)
            raise
