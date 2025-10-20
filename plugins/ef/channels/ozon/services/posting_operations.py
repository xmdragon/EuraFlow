"""
打包发货操作服务
处理备货、更新业务信息、填写国内单号等操作
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Any, Optional
import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.orders import OzonPosting, OzonOrder
from ..models.ozon_shops import OzonShop
from ..api.client import OzonAPIClient
from .kuajing84_sync import create_kuajing84_sync_service

logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class PostingOperationsService:
    """打包发货操作服务"""

    def __init__(self, db: AsyncSession):
        self.db = db

    async def prepare_stock(
        self,
        posting_number: str,
        purchase_price: Decimal,
        source_platform: Optional[str] = None,
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        备货操作：保存业务信息 + 调用 OZON ship API（v4）

        Args:
            posting_number: 货件编号
            purchase_price: 进货价格（必填）
            source_platform: 采购平台（可选：1688/拼多多/咸鱼/淘宝）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始备货操作，posting_number: {posting_number}, purchase_price: {purchase_price}, source_platform: {source_platform}")

        # 1. 查询 posting 和关联的 shop
        result = await self.db.execute(
            select(OzonPosting, OzonShop)
            .join(OzonShop, OzonPosting.shop_id == OzonShop.id)
            .where(OzonPosting.posting_number == posting_number)
        )
        row = result.first()

        if not row:
            logger.error(f"货件不存在: {posting_number}")
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        posting, shop = row

        logger.info(f"找到货件，当前状态: {posting.operation_status}, shop_id: {posting.shop_id}")

        # 2. 幂等性检查：如果状态已 >= allocating，禁止重复操作
        if posting.operation_status in ["allocating", "allocated", "tracking_confirmed"]:
            logger.warning(f"货件已完成备货操作，当前状态：{posting.operation_status}")
            return {
                "success": False,
                "message": f"该货件已完成备货操作，当前状态：{posting.operation_status}"
            }

        # 3. 保存业务信息
        posting.purchase_price = purchase_price
        posting.purchase_price_updated_at = utcnow()
        if source_platform:
            posting.source_platform = source_platform
        if order_notes:
            posting.order_notes = order_notes
        posting.operation_time = utcnow()

        # 立即更新操作状态为"分配中"（在 API 调用前）
        posting.operation_status = "allocating"

        # 4. 调用 OZON ship API（v4）告诉 OZON 订单已组装完成
        try:
            packages = self._build_packages_for_ship(posting)

            # 创建 API 客户端
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 调用 v4 ship API
            logger.info(f"调用 OZON ship API (v4)，posting_number: {posting_number}, packages: {packages}")
            ship_result = await api_client.ship_posting_v4(
                posting_number=posting_number,
                packages=packages
            )
            await api_client.close()

            logger.info(f"OZON ship API 调用成功，posting_number: {posting_number}, result: {ship_result}")

        except Exception as e:
            logger.error(f"调用 OZON ship API 失败，posting_number: {posting_number}, error: {str(e)}")
            # OZON API 调用失败不回滚数据库事务，因为业务信息已保存且状态已更新
            # 返回部分成功的结果
            await self.db.commit()
            await self.db.refresh(posting)
            return {
                "success": False,
                "message": f"业务信息已保存，状态已更新为分配中，但 OZON API 调用失败：{str(e)}",
                "data": {
                    "posting_number": posting.posting_number,
                    "operation_status": posting.operation_status,
                    "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
                }
            }

        # 5. 提交数据库事务
        await self.db.commit()
        await self.db.refresh(posting)

        logger.info(f"备货操作成功，posting_number: {posting_number}, operation_status: {posting.operation_status}")

        return {
            "success": True,
            "message": "备货成功",
            "data": {
                "posting_number": posting.posting_number,
                "operation_status": posting.operation_status,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
            }
        }

    async def update_business_info(
        self,
        posting_number: str,
        purchase_price: Optional[Decimal] = None,
        material_cost: Optional[Decimal] = None,
        source_platform: Optional[str] = None,
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        更新业务信息（不改变操作状态）

        Args:
            posting_number: 货件编号
            purchase_price: 进货价格（可选）
            material_cost: 打包费用（可选）
            source_platform: 采购平台（可选）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始更新业务信息，posting_number: {posting_number}")

        # 1. 查询 posting
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        # 2. 更新业务字段
        if purchase_price is not None:
            posting.purchase_price = purchase_price
            posting.purchase_price_updated_at = utcnow()
        if material_cost is not None:
            posting.material_cost = material_cost
        if source_platform is not None:
            posting.source_platform = source_platform
        if order_notes is not None:
            posting.order_notes = order_notes

        posting.operation_time = utcnow()

        # 3. 重新计算利润（如果进货价格或打包费用有变化）
        if purchase_price is not None or material_cost is not None:
            from .profit_calculator import calculate_and_update_profit
            await calculate_and_update_profit(self.db, posting)

        # 4. 提交数据库事务
        await self.db.commit()
        await self.db.refresh(posting)

        logger.info(f"业务信息更新成功，posting_number: {posting_number}")

        return {
            "success": True,
            "message": "更新成功",
            "data": {
                "posting_number": posting.posting_number,
                "purchase_price": str(posting.purchase_price) if posting.purchase_price else None,
                "material_cost": str(posting.material_cost) if posting.material_cost else None,
                "source_platform": posting.source_platform,
                "order_notes": posting.order_notes,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None
            }
        }

    async def submit_domestic_tracking(
        self,
        posting_number: str,
        domestic_tracking_number: str,
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        填写国内物流单号 + 同步跨境巴士

        Args:
            posting_number: 货件编号
            domestic_tracking_number: 国内物流单号（必填）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始填写国内单号，posting_number: {posting_number}, domestic_tracking_number: {domestic_tracking_number}")

        # 1. 查询 posting
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        # 2. 幂等性检查：如果状态已是 tracking_confirmed，禁止重复操作
        if posting.operation_status == "tracking_confirmed":
            return {
                "success": False,
                "message": "该货件已完成国内单号填写操作"
            }

        # 2.1 互斥状态检查：已打印和单号确认互斥
        if posting.operation_status == "printed":
            return {
                "success": False,
                "message": "该订单已标记为已打印，不能进行单号确认操作"
            }

        # 3. 保存国内单号和备注
        posting.domestic_tracking_number = domestic_tracking_number
        posting.domestic_tracking_updated_at = utcnow()
        if order_notes is not None:
            posting.order_notes = order_notes
        posting.operation_time = utcnow()

        # 4. 查询关联的订单（用于跨境巴士同步）
        order_result = await self.db.execute(
            select(OzonOrder).where(OzonOrder.id == posting.order_id)
        )
        order = order_result.scalar_one_or_none()

        if not order:
            return {
                "success": False,
                "message": f"订单不存在: {posting.order_id}"
            }

        # 5. 同步到跨境巴士
        kuajing84_service = create_kuajing84_sync_service(self.db)
        sync_result = await kuajing84_service.sync_logistics_order(
            ozon_order_id=order.id,
            posting_number=posting_number,
            logistics_order=domestic_tracking_number
        )

        if not sync_result["success"]:
            logger.warning(f"跨境巴士同步失败（不影响状态更新）: {sync_result['message']}")
            # 注意：跨境巴士同步失败不影响状态更新，因为已经保存了国内单号

        # 6. 更新操作状态为"单号确认"
        posting.operation_status = "tracking_confirmed"

        # 7. 提交数据库事务
        await self.db.commit()
        await self.db.refresh(posting)

        logger.info(f"国内单号填写成功，posting_number: {posting_number}, operation_status: {posting.operation_status}")

        return {
            "success": True,
            "message": "国内单号提交成功" + (f"，跨境巴士同步：{'成功' if sync_result['success'] else '失败'}" if sync_result else ""),
            "data": {
                "posting_number": posting.posting_number,
                "domestic_tracking_number": posting.domestic_tracking_number,
                "operation_status": posting.operation_status,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None,
                "kuajing84_sync": sync_result
            }
        }

    def _build_packages_for_ship(self, posting: OzonPosting) -> list:
        """
        从 posting.raw_payload 提取商品信息并构造 /v4/posting/fbs/ship API 所需的 packages 数据

        Args:
            posting: OzonPosting 实例

        Returns:
            packages 数据列表
        """
        if not posting.raw_payload or "products" not in posting.raw_payload:
            raise ValueError("无法从 posting 中提取商品信息（raw_payload.products 不存在）")

        # 构建单个包裹的 products 列表
        products = []
        for product in posting.raw_payload["products"]:
            # 提取 product_id（OZON 的商品ID，即 sku 字段）
            product_id = product.get("sku")
            if not product_id:
                logger.warning(f"商品缺少 product_id/sku: {product}")
                continue

            # 提取数量
            quantity = product.get("quantity", 1)

            products.append({
                "product_id": int(product_id),
                "quantity": quantity
            })

        if not products:
            raise ValueError("无法构造 packages 数据（没有有效的商品）")

        # 返回单个包裹（大多数订单是单包裹）
        return [{"products": products}]

    async def sync_material_cost_single(
        self,
        posting_number: str
    ) -> Dict[str, Any]:
        """
        从跨境巴士同步单个发货单的打包费用

        Args:
            posting_number: 货件编号

        Returns:
            操作结果
        """
        try:
            logger.info(f"开始同步打包费用，posting_number: {posting_number}")

            # 1. 查询 posting 和关联的订单
            result = await self.db.execute(
                select(OzonPosting)
                .where(OzonPosting.posting_number == posting_number)
            )
            posting = result.scalar_one_or_none()

            if not posting:
                logger.error(f"货件不存在: {posting_number}")
                return {
                    "success": False,
                    "message": f"货件不存在: {posting_number}"
                }

            # 2. 查询全局跨境巴士配置
            from ..models.kuajing84_global_config import Kuajing84GlobalConfig
            config_result = await self.db.execute(
                select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
            )
            kuajing84_config = config_result.scalar_one_or_none()

            if not kuajing84_config or not kuajing84_config.enabled:
                return {
                    "success": False,
                    "message": "跨境巴士未启用，请在同步服务中配置并启用"
                }

            # 3. 获取有效的 Cookie
            from .kuajing84_sync import create_kuajing84_sync_service
            sync_service = create_kuajing84_sync_service(self.db)
            valid_cookies = await sync_service._get_valid_cookies()

            if not valid_cookies:
                return {
                    "success": False,
                    "message": "无法获取有效的Cookie，请检查跨境巴士配置或测试连接"
                }

            # 4. 调用跨境巴士服务获取打包费用
            from .kuajing84_material_cost_sync_service import Kuajing84MaterialCostSyncService
            kuajing84_service = Kuajing84MaterialCostSyncService()

            fetch_result = await kuajing84_service._fetch_kuajing84_order(
                posting_number=posting_number,
                cookies=valid_cookies,
                base_url=kuajing84_config.base_url
            )

            if not fetch_result.get("success"):
                logger.error(f"跨境巴士API调用失败: {fetch_result.get('message')}")
                return {
                    "success": False,
                    "message": f"跨境巴士同步失败: {fetch_result.get('message', '未知错误')}"
                }

            # 5. 检查订单状态是否为"已打包"
            if fetch_result.get("order_status_info") != "已打包":
                return {
                    "success": False,
                    "message": f"跨境巴士订单状态为 '{fetch_result.get('order_status_info')}'，只有'已打包'状态才能同步费用"
                }

            # 6. 更新打包费用
            material_cost = Decimal(str(fetch_result["money"]))
            posting.material_cost = material_cost

            # 7. 如果本地没有国内物流单号，使用跨境巴士的logistics_order
            if not posting.domestic_tracking_number and fetch_result.get("logistics_order"):
                posting.domestic_tracking_number = fetch_result["logistics_order"]
                posting.domestic_tracking_updated_at = utcnow()

            # 8. 清除错误状态并更新同步时间
            posting.kuajing84_sync_error = None
            posting.kuajing84_last_sync_at = utcnow()

            # 9. 重新计算利润
            from .profit_calculator import calculate_and_update_profit
            await calculate_and_update_profit(self.db, posting)

            # 10. 提交数据库事务
            await self.db.commit()
            await self.db.refresh(posting)

            logger.info(f"打包费用同步成功，posting_number: {posting_number}, material_cost: {material_cost}")

            return {
                "success": True,
                "message": "打包费用同步成功",
                "data": {
                    "posting_number": posting.posting_number,
                    "material_cost": str(posting.material_cost) if posting.material_cost else None,
                    "domestic_tracking_number": posting.domestic_tracking_number,
                    "profit_amount_cny": str(posting.profit_amount_cny) if posting.profit_amount_cny else None,
                    "profit_rate": posting.profit_rate
                }
            }

        except Exception as e:
            logger.error(f"同步失败: {str(e)}", exc_info=True)
            return {
                "success": False,
                "message": f"同步失败: {str(e)}"
            }

    async def sync_finance_single(
        self,
        posting_number: str
    ) -> Dict[str, Any]:
        """
        从 OZON 同步单个发货单的财务费用（佣金、物流费等）

        Args:
            posting_number: 货件编号

        Returns:
            操作结果
        """
        logger.info(f"开始同步财务费用，posting_number: {posting_number}")

        # 1. 查询 posting 和关联的 shop
        result = await self.db.execute(
            select(OzonPosting, OzonShop)
            .join(OzonShop, OzonPosting.shop_id == OzonShop.id)
            .where(OzonPosting.posting_number == posting_number)
        )
        row = result.first()

        if not row:
            logger.error(f"货件不存在: {posting_number}")
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        posting, shop = row

        # 2. 调用 OZON 财务同步服务
        from .ozon_finance_sync_service import OzonFinanceSyncService

        finance_service = OzonFinanceSyncService()

        try:
            # 3. 调用批量同步服务中的单个发货单同步逻辑
            # 为了复用逻辑，我们调用 _sync_single_posting 私有方法
            from datetime import datetime, timedelta, timezone as tz

            # 创建 OZON API 客户端
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 获取 posting 的发货时间作为查询起始时间
            # 如果没有发货时间，使用创建时间前30天
            if posting.shipped_at:
                date_from = posting.shipped_at
            elif posting.created_at:
                date_from = posting.created_at - timedelta(days=30)
            else:
                date_from = datetime.now(tz.utc) - timedelta(days=30)

            date_to = datetime.now(tz.utc)

            # 4. 获取财务交易记录
            logger.info(f"获取财务交易记录，posting_number: {posting_number}, date_from: {date_from}, date_to: {date_to}")
            operations = await api_client.get_finance_transactions(
                posting_number=posting_number,
                date_from=date_from,
                date_to=date_to
            )
            await api_client.close()

            if not operations:
                return {
                    "success": False,
                    "message": "未找到该发货单的财务交易记录"
                }

            # 5. 计算汇率
            exchange_rate = await finance_service._calculate_exchange_rate(operations)
            if not exchange_rate:
                return {
                    "success": False,
                    "message": "无法计算汇率（缺少卢布订单金额或人民币订单金额）"
                }

            # 6. 提取并转换费用
            fees = await finance_service._extract_and_convert_fees(operations, exchange_rate)

            # 7. 更新 posting 记录
            posting.last_mile_delivery_fee_cny = fees["last_mile_delivery"]
            posting.international_logistics_fee_cny = fees["international_logistics"]
            posting.ozon_commission_cny = fees["ozon_commission"]
            posting.finance_synced_at = utcnow()

            # 8. 重新计算利润
            from .profit_calculator import calculate_and_update_profit
            await calculate_and_update_profit(self.db, posting)

            # 9. 提交数据库事务
            await self.db.commit()
            await self.db.refresh(posting)

            logger.info(
                f"财务费用同步成功，posting_number: {posting_number}, "
                f"ozon_commission: {fees['ozon_commission']}, "
                f"last_mile_delivery: {fees['last_mile_delivery']}, "
                f"international_logistics: {fees['international_logistics']}"
            )

            return {
                "success": True,
                "message": "财务费用同步成功",
                "data": {
                    "posting_number": posting.posting_number,
                    "ozon_commission_cny": str(posting.ozon_commission_cny) if posting.ozon_commission_cny else None,
                    "last_mile_delivery_fee_cny": str(posting.last_mile_delivery_fee_cny) if posting.last_mile_delivery_fee_cny else None,
                    "international_logistics_fee_cny": str(posting.international_logistics_fee_cny) if posting.international_logistics_fee_cny else None,
                    "exchange_rate": str(exchange_rate),
                    "profit_amount_cny": str(posting.profit_amount_cny) if posting.profit_amount_cny else None,
                    "profit_rate": posting.profit_rate
                }
            }

        except Exception as e:
            logger.error(f"财务费用同步失败，posting_number: {posting_number}, error: {str(e)}")
            return {
                "success": False,
                "message": f"财务费用同步失败: {str(e)}"
            }
