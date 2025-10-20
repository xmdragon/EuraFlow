"""
跨境巴士物料成本自动同步服务
单线程模式：每15秒运行一次，每次处理1个订单，处理间隔5秒
"""
import logging
import asyncio
from datetime import datetime, timezone, timedelta
from typing import Dict, Any
from decimal import Decimal

from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from ..models.orders import OzonPosting
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
        self.delay_seconds = 5  # 每条记录之间的延迟（秒）
        self.batch_size = 1  # 每次处理的订单数量（单线程模式）

    async def sync_material_costs(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        同步物料成本主流程
        单线程模式：每次处理1个订单，处理间隔5秒

        Args:
            config: 服务配置
                - delay_seconds: 延迟时间（默认5秒）
                - batch_size: 每次处理订单数（默认1）

        Returns:
            同步结果统计
        """
        delay_seconds = config.get("delay_seconds", self.delay_seconds)
        batch_size = config.get("batch_size", self.batch_size)

        logger.info(f"Starting material cost sync (single-thread mode), delay={delay_seconds}s, batch_size={batch_size}")

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

            # 3. 查询需要同步的货件（posting维度）
            # 直接查询 posting 表，不再通过 order 关联
            # 排除条件：
            # - 等待备货状态 (awaiting_packaging)
            # - 已取消状态 (cancelled 或 is_cancelled=True)
            # - 已标记"订单不存在"错误（kuajing84_sync_error = '订单不存在'）
            # - 只查询90天以内的货件
            # - 按创建时间升序（优先处理最旧的）
            ninety_days_ago = datetime.now(timezone.utc) - timedelta(days=90)

            postings_result = await session.execute(
                select(OzonPosting)
                .where(OzonPosting.material_cost == None)
                .where(OzonPosting.posting_number != None)
                .where(OzonPosting.posting_number != '')
                .where(OzonPosting.status != 'awaiting_packaging')  # 排除等待备货
                .where(OzonPosting.status != 'cancelled')  # 排除已取消
                .where(OzonPosting.is_cancelled == False)  # 排除已取消标志
                .where(or_(OzonPosting.kuajing84_sync_error != '订单不存在', OzonPosting.kuajing84_sync_error == None))  # 排除已标记不存在的订单（但包含NULL）
                .where(OzonPosting.created_at >= ninety_days_ago)  # 只查询90天内
                .order_by(OzonPosting.created_at.asc())  # 升序：最旧的优先
                .limit(batch_size)
            )
            postings = postings_result.scalars().all()

            if not postings:
                logger.info("No postings need material cost sync")
                return {
                    **stats,
                    "message": "没有需要同步物料成本的货件"
                }

            logger.info(f"Found {len(postings)} postings to process (within 90 days, excluding awaiting_packaging, cancelled, and '订单不存在' errors)")

            # 4. 循环处理每个货件
            for posting in postings:
                posting_number = posting.posting_number
                logger.info(f"Processing posting {posting.id} with posting_number: {posting_number}")
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
                            # 更新物料成本（posting维度）
                            material_cost = Decimal(str(result["money"]))
                            posting.material_cost = material_cost

                            # 如果本地没有国内物流单号，使用跨境巴士的logistics_order
                            if not posting.domestic_tracking_number and result.get("logistics_order"):
                                posting.domestic_tracking_number = result["logistics_order"]
                                posting.domestic_tracking_updated_at = datetime.now(timezone.utc)
                                logger.info(
                                    f"Updated domestic tracking number for posting {posting.id}, "
                                    f"tracking_number={result['logistics_order']}"
                                )

                            # 更新国际物流费用（如果数据库中为空或为0）
                            out_freight_str = result.get("out_freight", "0.00")
                            if out_freight_str != "0.00":
                                out_freight = Decimal(str(out_freight_str))
                                # 只在数据库中没有值或为0时才更新
                                if not posting.international_logistics_fee_cny or posting.international_logistics_fee_cny == 0:
                                    posting.international_logistics_fee_cny = out_freight
                                    logger.info(
                                        f"Updated international logistics fee for posting {posting.id}, "
                                        f"posting_number={posting_number}, fee={out_freight}"
                                    )

                            # 清除错误状态并更新同步时间
                            posting.kuajing84_sync_error = None
                            posting.kuajing84_last_sync_at = datetime.now(timezone.utc)

                            logger.info(
                                f"Updated material cost for posting {posting.id}, "
                                f"posting_number={posting_number}, cost={material_cost}"
                            )

                            stats["records_updated"] += 1
                            order_updated = True
                            log_status = "success"

                            # 提交变更
                            await session.commit()
                        else:
                            logger.info(
                                f"Posting {posting.id} status is not '已打包' (current: {result['order_status_info']}), skipping"
                            )
                            stats["records_skipped"] += 1
                            error_message = f"状态: {result['order_status_info']}"
                    else:
                        logger.warning(
                            f"Failed to fetch posting from Kuajing84, "
                            f"posting_number={posting_number}, reason={result.get('message')}"
                        )
                        stats["records_skipped"] += 1
                        # 简化错误信息
                        raw_error = result.get("message", "Unknown error")
                        logger.info(f"Processing error for posting {posting.id}, raw_error='{raw_error}'")
                        if "跨境巴士没有记录" in raw_error:
                            error_message = "订单不存在"
                            # 记录错误到数据库，下次同步时跳过
                            logger.info(f"Setting kuajing84_sync_error for posting {posting.id} to '订单不存在'")
                            posting.kuajing84_sync_error = "订单不存在"
                            posting.kuajing84_last_sync_at = datetime.now(timezone.utc)
                            logger.info(f"Before commit: posting.kuajing84_sync_error={posting.kuajing84_sync_error}")
                            await session.commit()
                            logger.info(f"After commit: Marked posting {posting.id} as '订单不存在', will skip in future syncs")
                        elif "Cookie" in raw_error and "过期" in raw_error:
                            error_message = "Cookie过期"
                            posting.kuajing84_last_sync_at = datetime.now(timezone.utc)
                            await session.commit()
                        elif "API返回错误" in raw_error:
                            # 提取 code 和简短描述
                            error_message = "API错误"
                            posting.kuajing84_last_sync_at = datetime.now(timezone.utc)
                            await session.commit()
                        else:
                            error_message = raw_error[:50]  # 限制长度
                            posting.kuajing84_last_sync_at = datetime.now(timezone.utc)
                            await session.commit()
                        stats["errors"].append({
                            "posting_id": posting.id,
                            "posting_number": posting_number,
                            "error": error_message
                        })

                except Exception as e:
                    logger.error(f"Error syncing posting {posting.id}: {e}", exc_info=True)
                    # 简化异常信息
                    error_str = str(e)
                    if "timeout" in error_str.lower():
                        error_message = "请求超时"
                    elif "connection" in error_str.lower():
                        error_message = "连接失败"
                    else:
                        error_message = error_str[:50]  # 限制长度
                    log_status = "failed"
                    order_updated = False

                    # 记录同步时间（但不标记为永久失败）
                    posting.kuajing84_last_sync_at = datetime.now(timezone.utc)
                    await session.commit()

                    stats["errors"].append({
                        "posting_id": posting.id,
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
                        "posting_id": posting.id,
                        "order_id": posting.order_id
                    }
                )
                session.add(sync_log)
                await session.commit()
                logger.info(f"Created log for posting_number={posting_number}, status={log_status}")

                # 频率控制：等待指定秒数（除最后一个货件）
                if posting != postings[-1]:
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
                            "logistics_order": logistics_order,
                            "out_freight": order_data.get("out_freight", "0.00")
                        }
                    else:
                        logger.warning(f"API returned empty data for {posting_number}")
                        return {
                            "success": False,
                            "message": "跨境巴士没有记录"
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
