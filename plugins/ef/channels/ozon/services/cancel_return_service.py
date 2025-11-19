"""
OZON 取消和退货申请同步服务
"""
import logging
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Any, List, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, func
from sqlalchemy.exc import IntegrityError

from ef_core.database import get_db_manager
from ..models import OzonShop, OzonPosting, OzonOrder
from ..models.cancel_return import OzonCancellation, OzonReturn
from ..api.client import OzonAPIClient

logger = logging.getLogger(__name__)


class CancelReturnService:
    """取消和退货申请同步服务"""

    def __init__(self):
        self.db_manager = get_db_manager()

    async def sync_cancellations(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步取消申请数据（定时任务处理函数）

        Args:
            config: 配置参数
                - shop_id: 店铺ID（可选，默认所有活跃店铺）
                - last_id: 上次同步的last_id（可选）

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
            logger.info(f"shop_id from config: {shop_id}, type: {type(shop_id)}")

            if shop_id:
                # 同步指定店铺
                result = await db.execute(
                    select(OzonShop).where(
                        OzonShop.id == shop_id,
                        OzonShop.status == "active"
                    )
                )
                shops = result.scalars().all()
                logger.info(f"查询指定店铺 {shop_id}，找到 {len(shops)} 个活跃店铺")
            else:
                # 同步所有活跃店铺
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()
                logger.info(f"查询所有活跃店铺，找到 {len(shops)} 个")

            for shop in shops:
                try:
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
            api_key=shop.api_key,
            shop_id=shop.id
        ) as client:
            # 分页获取取消申请列表
            current_last_id = last_id
            has_more = True

            while has_more:
                response = await client.get_conditional_cancellation_list(
                    last_id=current_last_id,
                    limit=1000
                )

                result = response.get("result", {})
                cancellations = result.get("items", [])
                has_next = result.get("has_next", False)
                next_last_id = result.get("last_id", 0)

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

                # 更新分页状态
                if has_next and next_last_id > current_last_id:
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
                order_id = posting.order_id

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

    async def sync_returns(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步退货申请数据（定时任务处理函数）

        Args:
            config: 配置参数
                - shop_id: 店铺ID（可选，默认所有活跃店铺）
                - last_id: 上次同步的last_id（可选）

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
            logger.info(f"shop_id from config: {shop_id}, type: {type(shop_id)}")

            if shop_id:
                # 同步指定店铺
                result = await db.execute(
                    select(OzonShop).where(
                        OzonShop.id == shop_id,
                        OzonShop.status == "active"
                    )
                )
                shops = result.scalars().all()
                logger.info(f"查询指定店铺 {shop_id}，找到 {len(shops)} 个活跃店铺")
            else:
                # 同步所有活跃店铺
                result = await db.execute(
                    select(OzonShop).where(OzonShop.status == "active")
                )
                shops = result.scalars().all()
                logger.info(f"查询所有活跃店铺，找到 {len(shops)} 个")

            for shop in shops:
                try:
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
            api_key=shop.api_key,
            shop_id=shop.id
        ) as client:
            # 分页获取退货申请列表
            current_last_id = last_id
            has_more = True

            while has_more:
                response = await client.get_returns_rfbs_list(
                    last_id=current_last_id,
                    limit=1000
                )

                result = response.get("result", {})
                returns = result.get("items", [])
                has_next = result.get("has_next", False)
                next_last_id = result.get("last_id", 0)

                for return_data in returns:
                    try:
                        is_updated = await self._save_return(db, shop.id, return_data)
                        if is_updated:
                            updated_count += 1
                        else:
                            synced_count += 1
                    except Exception as e:
                        logger.error(f"保存退货申请失败: {e}", exc_info=True)
                        continue

                # 提交批次
                await db.commit()

                # 更新分页状态
                if has_next and next_last_id > current_last_id:
                    current_last_id = next_last_id
                else:
                    has_more = False

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
                order_id = posting.order_id

        # 检查是否已存在
        result = await db.execute(
            select(OzonReturn).where(
                OzonReturn.shop_id == shop_id,
                OzonReturn.return_id == return_id
            )
        )
        existing = result.scalar_one_or_none()

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
            "product_name": data.get("product_name"),
            "offer_id": data.get("offer_id"),
            "sku": data.get("sku"),
            "price": Decimal(str(data.get("price", 0))) if data.get("price") else None,
            "currency_code": data.get("currency_code"),
            "group_state": data.get("group_state", ""),
            "state": data.get("state", ""),
            "state_name": data.get("state_name"),
            "money_return_state_name": data.get("money_return_state_name"),
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

            # 查询数据
            query = select(OzonReturn).where(and_(*conditions)) if conditions else select(OzonReturn)
            query = query.order_by(OzonReturn.created_at_ozon.desc())
            query = query.offset((page - 1) * limit).limit(limit)

            result = await db.execute(query)
            returns = result.scalars().all()

            # 转换为字典列表
            items = []
            for return_obj in returns:
                items.append({
                    "id": return_obj.id,
                    "return_id": return_obj.return_id,
                    "return_number": return_obj.return_number,
                    "posting_number": return_obj.posting_number,
                    "client_name": self._mask_client_name(return_obj.client_name),  # 脱敏
                    "product_name": return_obj.product_name,
                    "offer_id": return_obj.offer_id,
                    "sku": return_obj.sku,
                    "price": str(return_obj.price) if return_obj.price else None,
                    "currency_code": return_obj.currency_code,
                    "group_state": return_obj.group_state,
                    "state_name": return_obj.state_name,
                    "money_return_state_name": return_obj.money_return_state_name,
                    "created_at_ozon": return_obj.created_at_ozon.isoformat() if return_obj.created_at_ozon else None,
                })

            return {
                "items": items,
                "total": total,
                "page": page,
                "limit": limit
            }

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
