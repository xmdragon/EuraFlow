"""
打包发货操作服务
处理备货、更新业务信息、填写国内单号等操作
"""
from datetime import datetime, timezone
from decimal import Decimal
from typing import Dict, Any, Optional, List
import logging

from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.orders import OzonPosting, OzonOrder, OzonDomesticTracking
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

        # 2. 检查是否需要调用OZON API
        # 如果已有进货价格，且用户提交的值都没变化，则只更新operation_status，跳过OZON API调用
        old_purchase_price = str(posting.purchase_price) if posting.purchase_price else None
        old_source_platform = posting.source_platform
        old_order_notes = posting.order_notes

        # 将传入的值转换为字符串进行比较（purchase_price是Decimal类型）
        new_purchase_price_str = str(purchase_price) if purchase_price else None

        # 判断是否有变化的逻辑：
        # - 进货价格：必填字段，必须比较
        # - 采购平台/备注：可选字段，如果传入None，视为"不修改"，不参与比较
        price_unchanged = (old_purchase_price == new_purchase_price_str)
        # 采购平台：传入None时视为不修改，不算变化
        platform_unchanged = (source_platform is None or old_source_platform == source_platform)
        # 备注：传入None时视为不修改，不算变化
        notes_unchanged = (order_notes is None or old_order_notes == order_notes)

        # 如果已有进货价格且所有值都没变，跳过OZON API调用
        skip_ozon_api = (
            posting.purchase_price is not None and
            price_unchanged and
            platform_unchanged and
            notes_unchanged
        )

        if skip_ozon_api:
            logger.info(
                f"备货信息未变化，跳过OZON API调用: posting_number={posting_number}, "
                f"purchase_price={purchase_price}, source_platform={source_platform}"
            )
            # 只更新operation_status和operation_time
            posting.operation_status = "allocating"
            posting.operation_time = utcnow()

            await self.db.commit()
            await self.db.refresh(posting)

            return {
                "success": True,
                "message": "备货操作成功（信息未变化，未调用OZON API）",
                "data": {
                    "posting_number": posting.posting_number,
                    "operation_status": posting.operation_status,
                    "operation_time": posting.operation_time.isoformat() if posting.operation_time else None,
                    "skipped_ozon_api": True
                }
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
        domestic_tracking_numbers: List[str],
        order_notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        填写国内物流单号 + 同步跨境巴士（支持多单号）

        Args:
            posting_number: 货件编号
            domestic_tracking_numbers: 国内物流单号列表（支持多个）
            order_notes: 订单备注（可选）

        Returns:
            操作结果
        """
        logger.info(f"开始填写国内单号，posting_number: {posting_number}, domestic_tracking_numbers: {domestic_tracking_numbers}")

        # 1. 验证输入
        if not domestic_tracking_numbers:
            return {
                "success": False,
                "message": "至少需要提供一个国内物流单号"
            }

        # 去重并清理空值
        unique_numbers = list(set([n.strip() for n in domestic_tracking_numbers if n and n.strip()]))
        if not unique_numbers:
            return {
                "success": False,
                "message": "国内物流单号不能为空"
            }

        if len(unique_numbers) > 10:
            return {
                "success": False,
                "message": "最多支持10个国内物流单号"
            }

        logger.info(f"去重后的国内单号: {unique_numbers}")

        # 2. 查询 posting
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "message": f"货件不存在: {posting_number}"
            }

        # 3. 幂等性检查：如果状态已是 tracking_confirmed，禁止重复操作
        if posting.operation_status == "tracking_confirmed":
            return {
                "success": False,
                "message": "该货件已完成国内单号填写操作"
            }

        # 3.1 互斥状态检查：已打印和单号确认互斥
        if posting.operation_status == "printed":
            return {
                "success": False,
                "message": "该订单已标记为已打印，不能进行单号确认操作"
            }

        # 4. 删除现有单号记录（替换模式）
        await self.db.execute(
            delete(OzonDomesticTracking).where(OzonDomesticTracking.posting_id == posting.id)
        )

        # 5. 批量插入新单号
        tracking_records = [
            OzonDomesticTracking(
                posting_id=posting.id,
                tracking_number=number,
                created_at=utcnow()
            )
            for number in unique_numbers
        ]
        self.db.add_all(tracking_records)

        # 6. 更新元数据
        if order_notes is not None:
            posting.order_notes = order_notes
        posting.operation_time = utcnow()

        # 7. 查询关联的订单（用于跨境巴士同步）
        order_result = await self.db.execute(
            select(OzonOrder).where(OzonOrder.id == posting.order_id)
        )
        order = order_result.scalar_one_or_none()

        if not order:
            return {
                "success": False,
                "message": f"订单不存在: {posting.order_id}"
            }

        # 8. 创建跨境巴士同步日志（异步模式）
        from ..models.kuajing84 import Kuajing84SyncLog
        sync_log = Kuajing84SyncLog(
            ozon_order_id=order.id,
            shop_id=order.shop_id,
            order_number=posting_number,
            logistics_order=unique_numbers[0],  # 使用第一个单号
            sync_type="submit_tracking",
            posting_id=posting.id,
            sync_status="pending",
            attempts=0
        )
        self.db.add(sync_log)

        # 9. 更新操作状态为"单号确认"
        posting.operation_status = "tracking_confirmed"

        # 10. 提交数据库事务（必须先提交，异步任务才能访问）
        await self.db.commit()
        await self.db.refresh(posting)
        await self.db.refresh(sync_log)

        # 11. 启动后台异步任务（不等待）
        import asyncio
        from .kuajing84_async_tasks import async_sync_logistics_order
        from ef_core.database import get_async_session

        async def _start_background_task():
            """创建独立的数据库会话用于后台任务"""
            async for db_session in get_async_session():
                try:
                    await async_sync_logistics_order(db_session, sync_log.id)
                finally:
                    await db_session.close()

        # 使用 asyncio.create_task 启动后台任务
        asyncio.create_task(_start_background_task())

        logger.info(f"国内单号填写成功，posting_number: {posting_number}, count: {len(unique_numbers)}, operation_status: {posting.operation_status}, sync_log_id: {sync_log.id}")

        return {
            "success": True,
            "message": f"国内单号提交成功（共{len(unique_numbers)}个），正在后台同步到跨境巴士...",
            "data": {
                "posting_number": posting.posting_number,
                "domestic_tracking_numbers": unique_numbers,  # 新字段：数组
                "domestic_tracking_number": unique_numbers[0],  # 兼容字段：第一个单号
                "operation_status": posting.operation_status,
                "operation_time": posting.operation_time.isoformat() if posting.operation_time else None,
                "sync_log_id": sync_log.id,  # 新增：同步日志ID（用于轮询）
                "kuajing84_sync": {
                    "success": None,  # 异步模式：同步状态未知
                    "message": "后台同步中...",
                    "log_id": sync_log.id
                }
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
            current_tracking_numbers = posting.get_domestic_tracking_numbers()
            if not current_tracking_numbers and fetch_result.get("logistics_order"):
                # 创建新的国内物流单号记录
                new_tracking = OzonDomesticTracking(
                    posting_id=posting.id,
                    tracking_number=fetch_result["logistics_order"],
                    created_at=utcnow()
                )
                self.db.add(new_tracking)
                logger.info(
                    f"添加国内物流单号: posting_number={posting_number}, "
                    f"tracking_number={fetch_result['logistics_order']}"
                )

            # 8. 更新国际物流费用（如果数据库中为空或为0）
            out_freight_str = fetch_result.get("out_freight", "0.00")
            if out_freight_str != "0.00":
                out_freight = Decimal(str(out_freight_str))
                # 只在数据库中没有值或为0时才更新
                if not posting.international_logistics_fee_cny or posting.international_logistics_fee_cny == 0:
                    posting.international_logistics_fee_cny = out_freight
                    logger.info(
                        f"更新国际物流费用: posting_number={posting_number}, fee={out_freight}"
                    )

            # 9. 清除错误状态并更新同步时间
            posting.kuajing84_sync_error = None
            posting.kuajing84_last_sync_at = utcnow()

            # 10. 重新计算利润
            from .profit_calculator import calculate_and_update_profit
            await calculate_and_update_profit(self.db, posting)

            # 11. 提交数据库事务
            await self.db.commit()
            await self.db.refresh(posting)

            logger.info(
                f"打包费用同步成功，posting_number: {posting_number}, "
                f"material_cost: {material_cost}, "
                f"international_logistics_fee: {posting.international_logistics_fee_cny}"
            )

            # 获取国内物流单号列表
            tracking_numbers = posting.get_domestic_tracking_numbers()

            return {
                "success": True,
                "message": "打包费用同步成功",
                "data": {
                    "posting_number": posting.posting_number,
                    "material_cost": str(posting.material_cost) if posting.material_cost else None,
                    "domestic_tracking_numbers": tracking_numbers,  # 统一使用数组形式
                    "international_logistics_fee_cny": str(posting.international_logistics_fee_cny) if posting.international_logistics_fee_cny else None,
                    "profit_amount_cny": str(posting.profit) if posting.profit else None,
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
            # 3. 创建 OZON API 客户端
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=shop.id
            )

            # 4. 调用财务交易API
            logger.info(f"获取财务交易记录，posting_number: {posting_number}")
            response = await api_client.get_finance_transaction_list(
                posting_number=posting_number,
                transaction_type="all",
                page=1,
                page_size=1000
            )
            await api_client.close()

            result = response.get("result", {})
            operations = result.get("operations", [])

            if not operations:
                return {
                    "success": False,
                    "message": "未找到该发货单的财务交易记录"
                }

            # 5. 计算汇率（需要传入 posting 对象）
            exchange_rate = await finance_service._calculate_exchange_rate(posting, operations)

            if not exchange_rate or exchange_rate <= 0:
                return {
                    "success": False,
                    "message": "无法计算汇率（缺少卢布订单金额或人民币订单金额）"
                }

            logger.info(f"计算得到汇率: {exchange_rate:.6f}")

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
                    "profit_amount_cny": str(posting.profit) if posting.profit else None,
                    "profit_rate": posting.profit_rate
                }
            }

        except Exception as e:
            logger.error(f"财务费用同步失败，posting_number: {posting_number}, error: {str(e)}")
            return {
                "success": False,
                "message": f"财务费用同步失败: {str(e)}"
            }

    async def discard_posting_async(
        self,
        posting_number: str
    ) -> Dict[str, Any]:
        """
        异步废弃订单（同步到跨境84并更新本地状态）

        Args:
            posting_number: 货件编号

        Returns:
            操作结果（立即返回，包含 sync_log_id 用于轮询）
        """
        logger.info(f"开始异步废弃订单，posting_number: {posting_number}")

        # 1. 验证 posting 是否存在
        result = await self.db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting = result.scalar_one_or_none()

        if not posting:
            return {
                "success": False,
                "message": f"发货单 {posting_number} 不存在"
            }

        # 2. 检查是否已经是取消状态
        if posting.operation_status == "cancelled":
            return {
                "success": False,
                "message": "订单已经是取消状态"
            }

        # 3. 查询关联的订单
        order_result = await self.db.execute(
            select(OzonOrder).where(OzonOrder.id == posting.order_id)
        )
        order = order_result.scalar_one_or_none()

        if not order:
            return {
                "success": False,
                "message": f"订单不存在: {posting.order_id}"
            }

        # 4. 创建跨境巴士同步日志（异步模式）
        from ..models.kuajing84 import Kuajing84SyncLog
        sync_log = Kuajing84SyncLog(
            ozon_order_id=order.id,
            shop_id=order.shop_id,
            order_number=posting_number,
            logistics_order="",  # 废弃操作不需要物流单号
            sync_type="discard_order",
            posting_id=posting.id,
            sync_status="pending",
            attempts=0
        )
        self.db.add(sync_log)

        # 5. 提交数据库事务（必须先提交，异步任务才能访问）
        await self.db.commit()
        await self.db.refresh(sync_log)

        # 6. 启动后台异步任务（不等待）
        import asyncio
        from .kuajing84_async_tasks import async_discard_order
        from ef_core.database import get_async_session

        async def _start_background_task():
            """创建独立的数据库会话用于后台任务"""
            async for db_session in get_async_session():
                try:
                    await async_discard_order(db_session, sync_log.id)
                finally:
                    await db_session.close()

        # 使用 asyncio.create_task 启动后台任务
        asyncio.create_task(_start_background_task())

        logger.info(f"异步废弃订单任务已启动，posting_number: {posting_number}, sync_log_id: {sync_log.id}")

        return {
            "success": True,
            "message": "订单废弃请求已提交，正在后台同步到跨境巴士...",
            "data": {
                "posting_number": posting_number,
                "sync_log_id": sync_log.id,  # 新增：同步日志ID（用于轮询）
                "kuajing84_sync": {
                    "success": None,  # 异步模式：同步状态未知
                    "message": "后台同步中...",
                    "log_id": sync_log.id
                }
            }
        }
