"""
跨境巴士物料成本自动同步服务
每5分钟运行一次，每次处理10个订单，订单间延迟10秒
"""
import logging
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ..models.orders import OzonOrder, OzonPosting
from ..models.kuajing84_global_config import Kuajing84GlobalConfig
from ..models.sync_service import SyncServiceLog
from .kuajing84_sync import create_kuajing84_sync_service
from .kuajing84_client import Kuajing84Client
import uuid

logger = logging.getLogger(__name__)


class Kuajing84MaterialCostSyncService:
    """跨境巴士物料成本自动同步服务"""

    def __init__(self):
        """初始化服务"""
        self.delay_seconds = 10  # 每条记录之间的延迟（秒）
        self.batch_size = 10  # 每次处理的订单数量

    async def sync_material_costs(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步物料成本主流程
        预先登录，批量处理10个订单，每个订单间隔10秒

        Args:
            config: 服务配置
                - delay_seconds: 延迟时间（默认10秒）

        Returns:
            同步结果统计
        """
        delay_seconds = config.get("delay_seconds", self.delay_seconds)

        logger.info(f"Starting material cost sync (batch mode), delay={delay_seconds}s, batch_size={self.batch_size}")

        stats = {
            "records_processed": 0,
            "records_updated": 0,
            "records_skipped": 0,
            "errors": [],
            "posting_numbers": []  # 记录处理的posting_number列表
        }

        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            # 1. 检查跨境巴士配置是否启用
            config_result = await session.execute(
                select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
            )
            kuajing84_config = config_result.scalar_one_or_none()

            if not kuajing84_config or not kuajing84_config.enabled:
                logger.warning("Kuajing84 is not enabled, skipping sync")
                return {
                    **stats,
                    "message": "跨境巴士未启用"
                }

            # 2. 预先登录获取有效Cookie
            logger.info("Pre-login to get valid cookies")
            sync_service = create_kuajing84_sync_service(session)
            valid_cookies = await sync_service._get_valid_cookies()

            if not valid_cookies:
                logger.error("Failed to get valid cookies, cannot proceed")
                return {
                    **stats,
                    "message": "无法获取有效的Cookie，请检查跨境巴士配置或测试连接"
                }

            logger.info(f"Successfully obtained {len(valid_cookies)} cookies")

            # 3. 查询需要同步的订单（批量查询10个，使用 distinct 避免重复）
            from sqlalchemy.orm import selectinload

            orders_result = await session.execute(
                select(OzonOrder)
                .distinct()  # 确保每个订单只返回一次
                .options(selectinload(OzonOrder.postings))  # 预加载postings关系
                .where(OzonOrder.material_cost == None)
                .join(OzonOrder.postings)
                .where(OzonPosting.posting_number != None)
                .where(OzonPosting.posting_number != '')
                .limit(self.batch_size)
            )
            orders = orders_result.scalars().all()

            if not orders:
                logger.info("No orders need material cost sync")
                return {
                    **stats,
                    "message": "没有需要同步物料成本的订单"
                }

            logger.info(f"Found {len(orders)} orders to process")

            # 4. 循环处理每个订单
            for order in orders:
                # 获取第一个有效的posting_number
                posting_number = None
                for posting in order.postings:
                    if posting.posting_number:
                        posting_number = posting.posting_number
                        break

                if not posting_number:
                    logger.warning(f"Order {order.id} has no valid posting_number, skipping")
                    stats["records_processed"] += 1
                    stats["records_skipped"] += 1
                    continue

                logger.info(f"Processing order {order.id} with posting_number: {posting_number}")
                stats["records_processed"] += 1
                stats["posting_numbers"].append(posting_number)

                # 记录开始时间
                started_at = datetime.now(timezone.utc)
                run_id = f"kuajing84_material_cost_{uuid.uuid4().hex[:12]}"

                try:
                    # 使用有效的Cookie查询跨境巴士订单信息
                    result = await self._fetch_kuajing84_order(
                        posting_number=posting_number,
                        cookies=valid_cookies,
                        base_url=kuajing84_config.base_url
                    )

                    # 如果返回Cookie过期，刷新Cookie并重试
                    if not result["success"] and "Cookie已过期" in result.get("message", ""):
                        logger.warning(f"Cookie expired while processing {posting_number}, refreshing...")

                        # 强制刷新Cookie（清空数据库缓存）
                        kuajing84_config.cookie = None
                        kuajing84_config.cookie_expires_at = None
                        await session.commit()

                        # 重新获取Cookie
                        valid_cookies = await sync_service._get_valid_cookies()

                        if valid_cookies:
                            logger.info("Cookie refreshed successfully, retrying API request")
                            # 使用新Cookie重试
                            result = await self._fetch_kuajing84_order(
                                posting_number=posting_number,
                                cookies=valid_cookies,
                                base_url=kuajing84_config.base_url
                            )
                        else:
                            logger.error("Failed to refresh cookie")
                            result = {
                                "success": False,
                                "message": "Cookie刷新失败，无法重新登录"
                            }

                    # 处理查询结果
                    order_updated = False
                    log_status = "failed"
                    error_message = None

                    if result["success"]:
                        # 检查订单状态是否为"已打包"
                        if result["order_status_info"] == "已打包":
                            # 更新物料成本
                            material_cost = Decimal(str(result["money"]))
                            order.material_cost = material_cost

                            # 如果本地没有国内物流单号，使用跨境巴士的logistics_order
                            if not order.domestic_tracking_number and result.get("logistics_order"):
                                order.domestic_tracking_number = result["logistics_order"]
                                order.domestic_tracking_updated_at = datetime.now(timezone.utc)
                                logger.info(
                                    f"Updated domestic tracking number for order {order.id}, "
                                    f"tracking_number={result['logistics_order']}"
                                )

                            logger.info(
                                f"Updated material cost for order {order.id}, "
                                f"posting_number={posting_number}, cost={material_cost}"
                            )

                            stats["records_updated"] += 1
                            order_updated = True
                            log_status = "success"

                            # 提交变更
                            await session.commit()
                        else:
                            logger.info(
                                f"Order {order.id} status is not '已打包' (current: {result['order_status_info']}), skipping"
                            )
                            stats["records_skipped"] += 1
                            error_message = f"订单状态不符: {result['order_status_info']}"
                    else:
                        logger.warning(
                            f"Failed to fetch order from Kuajing84, "
                            f"posting_number={posting_number}, reason={result.get('message')}"
                        )
                        stats["records_skipped"] += 1
                        error_message = result.get("message", "Unknown error")
                        stats["errors"].append({
                            "order_id": order.id,
                            "posting_number": posting_number,
                            "error": error_message
                        })

                except Exception as e:
                    logger.error(f"Error syncing order {order.id}: {e}", exc_info=True)
                    error_message = str(e)
                    log_status = "failed"
                    order_updated = False
                    stats["errors"].append({
                        "order_id": order.id,
                        "posting_number": posting_number,
                        "error": error_message
                    })

                # 创建日志记录
                finished_at = datetime.now(timezone.utc)
                execution_time_ms = int((finished_at - started_at).total_seconds() * 1000)

                sync_log = SyncServiceLog(
                    service_key="kuajing84_material_cost",
                    run_id=run_id,
                    started_at=started_at,
                    finished_at=finished_at,
                    status=log_status,
                    records_processed=1,
                    records_updated=1 if order_updated else 0,
                    execution_time_ms=execution_time_ms,
                    error_message=error_message,
                    extra_data={
                        "posting_number": posting_number,
                        "order_id": order.id
                    }
                )
                session.add(sync_log)
                await session.commit()
                logger.info(f"Created log for posting_number={posting_number}, status={log_status}")

                # 频率控制：等待指定秒数（除最后一个订单）
                if order != orders[-1]:
                    await asyncio.sleep(delay_seconds)

        logger.info(
            f"Material cost sync completed: "
            f"processed={stats['records_processed']}, "
            f"updated={stats['records_updated']}, "
            f"skipped={stats['records_skipped']}, "
            f"errors={len(stats['errors'])}"
        )

        # 生成结果消息
        if stats["records_updated"] > 0:
            message = f"成功更新{stats['records_updated']}条订单物料成本"
        elif stats["records_skipped"] > 0:
            message = f"处理了{stats['records_processed']}条订单，但没有更新（状态不符或查询失败）"
        elif len(stats["errors"]) > 0:
            message = f"处理失败，共{len(stats['errors'])}个错误"
        else:
            message = "没有需要同步的订单"

        return {
            **stats,
            "message": message
        }

    async def _fetch_kuajing84_order(
        self,
        posting_number: str,
        cookies: list,
        base_url: str
    ) -> Dict[str, Any]:
        """
        从跨境巴士查询订单信息

        Args:
            posting_number: 货件编号（OZON posting number）
            cookies: 跨境巴士Cookie
            base_url: 跨境巴士API地址

        Returns:
            查询结果：
            {
                "success": True/False,
                "order_status_info": "已打包",
                "money": "1.50",
                "logistics_order": "78946860552672",
                "message": "错误信息"
            }
        """
        try:
            async with Kuajing84Client(base_url=base_url) as client:
                # 调用跨境巴士订单查询API
                response = await client.search_order(
                    order_number=posting_number,
                    cookies=cookies
                )

                # 解析返回值
                logger.info(f"Kuajing84 API response for {posting_number}: {response}")

                if response.get("code") == 0:
                    data_list = response.get("data", [])

                    if data_list and len(data_list) > 0:
                        order_data = data_list[0]
                        logger.info(f"Found order data: status={order_data.get('order_status_info')}, money={order_data.get('money')}")

                        # 从package列表中提取logistics_order
                        logistics_order = None
                        packages = order_data.get("package", [])
                        if packages and len(packages) > 0:
                            logistics_order = packages[0].get("logistics_order")

                        return {
                            "success": True,
                            "order_status_info": order_data.get("order_status_info", ""),
                            "money": order_data.get("money", "0"),
                            "logistics_order": logistics_order
                        }
                    else:
                        logger.warning(f"API returned empty data for {posting_number}")
                        return {
                            "success": False,
                            "message": f"订单不存在: {posting_number}"
                        }
                else:
                    error_msg = response.get("msg", response.get("message", "Unknown error"))
                    logger.error(f"Kuajing84 API error for {posting_number}: code={response.get('code')}, msg={error_msg}")
                    return {
                        "success": False,
                        "message": f"API返回错误: code={response.get('code')}, msg={error_msg}"
                    }

        except Exception as e:
            logger.error(f"Error fetching Kuajing84 order {posting_number}: {e}", exc_info=True)
            return {
                "success": False,
                "message": str(e)
            }


# 全局单例
_service_instance = None


def get_kuajing84_material_cost_sync_service() -> Kuajing84MaterialCostSyncService:
    """获取服务实例"""
    global _service_instance
    if _service_instance is None:
        _service_instance = Kuajing84MaterialCostSyncService()
    return _service_instance
