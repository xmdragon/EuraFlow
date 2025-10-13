"""
跨境巴士物料成本自动同步服务
每3秒查询一条订单的物料成本
"""
import logging
import asyncio
from datetime import datetime, timezone
from typing import Dict, Any
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ..models.orders import OzonOrder
from ..models.kuajing84_global_config import Kuajing84GlobalConfig
from .kuajing84_client import Kuajing84Client

logger = logging.getLogger(__name__)


class Kuajing84MaterialCostSyncService:
    """跨境巴士物料成本自动同步服务"""

    def __init__(self):
        """初始化服务"""
        self.delay_seconds = 3  # 每条记录之间的延迟（秒）

    async def sync_material_costs(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步物料成本主流程

        Args:
            config: 服务配置
                - batch_size: 每次处理的记录数（默认10条）
                - delay_seconds: 每条记录之间的延迟（默认3秒）

        Returns:
            同步结果统计
        """
        batch_size = config.get("batch_size", 10)
        delay_seconds = config.get("delay_seconds", self.delay_seconds)

        logger.info(f"Starting material cost sync, batch_size={batch_size}, delay={delay_seconds}s")

        stats = {
            "records_processed": 0,
            "records_updated": 0,
            "records_skipped": 0,
            "errors": []
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

            if not kuajing84_config.cookie:
                logger.warning("Kuajing84 cookie is missing, skipping sync")
                return {
                    **stats,
                    "message": "跨境巴士Cookie缺失，请先测试连接"
                }

            # 2. 查询需要同步的订单（material_cost IS NULL 且有 posting_number）
            orders_result = await session.execute(
                select(OzonOrder)
                .where(OzonOrder.material_cost == None)
                .join(OzonOrder.postings)
                .limit(batch_size)
            )
            orders = orders_result.scalars().all()

            if not orders:
                logger.info("No orders need material cost sync")
                return {
                    **stats,
                    "message": "没有需要同步物料成本的订单"
                }

            logger.info(f"Found {len(orders)} orders to sync")

            # 3. 逐条同步（频率控制）
            for order in orders:
                stats["records_processed"] += 1

                try:
                    # 获取第一个posting的posting_number
                    if not order.postings or len(order.postings) == 0:
                        logger.warning(f"Order {order.id} has no posting, skipping")
                        stats["records_skipped"] += 1
                        continue

                    posting_number = order.postings[0].posting_number

                    # 查询跨境巴士订单信息
                    result = await self._fetch_kuajing84_order(
                        posting_number=posting_number,
                        cookies=kuajing84_config.cookie,
                        base_url=kuajing84_config.base_url
                    )

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
                        else:
                            logger.info(
                                f"Order {order.id} status is not '已打包' (current: {result['order_status_info']}), skipping"
                            )
                            stats["records_skipped"] += 1
                    else:
                        logger.warning(
                            f"Failed to fetch order from Kuajing84, "
                            f"posting_number={posting_number}, reason={result.get('message')}"
                        )
                        stats["records_skipped"] += 1
                        stats["errors"].append({
                            "order_id": order.id,
                            "posting_number": posting_number,
                            "error": result.get("message", "Unknown error")
                        })

                except Exception as e:
                    logger.error(f"Error syncing order {order.id}: {e}", exc_info=True)
                    stats["errors"].append({
                        "order_id": order.id,
                        "error": str(e)
                    })

                # 频率控制：等待指定时间再处理下一条
                if stats["records_processed"] < len(orders):
                    await asyncio.sleep(delay_seconds)

            # 4. 提交所有变更
            await session.commit()

        logger.info(
            f"Material cost sync completed: "
            f"processed={stats['records_processed']}, "
            f"updated={stats['records_updated']}, "
            f"skipped={stats['records_skipped']}, "
            f"errors={len(stats['errors'])}"
        )

        return {
            **stats,
            "message": f"同步完成：处理{stats['records_processed']}条，更新{stats['records_updated']}条"
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
                if response.get("code") == 0:
                    data_list = response.get("data", [])

                    if data_list and len(data_list) > 0:
                        order_data = data_list[0]

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
                        return {
                            "success": False,
                            "message": f"订单不存在: {posting_number}"
                        }
                else:
                    return {
                        "success": False,
                        "message": f"API返回错误: code={response.get('code')}"
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
