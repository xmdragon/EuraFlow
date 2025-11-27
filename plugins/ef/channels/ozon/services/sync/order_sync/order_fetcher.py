"""
订单数据获取器

负责从 OZON API 获取订单数据，支持增量和全量模式。
"""

from datetime import timedelta
from typing import Dict, List, AsyncIterator
import logging

from ....api.client import OzonAPIClient
from ....utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class OrderFetcher:
    """订单数据获取器"""

    async def fetch_orders_incremental(
        self,
        client: OzonAPIClient,
        days: int = 7,
        batch_size: int = 200,
    ) -> AsyncIterator[tuple[List[Dict], bool]]:
        """
        增量获取订单（最近N天）

        Args:
            client: OZON API 客户端
            days: 获取最近N天的订单
            batch_size: 每批获取数量

        Yields:
            (items, has_next) - 订单列表、是否有下一页
        """
        date_from = utcnow() - timedelta(days=days)
        date_to = utcnow()

        logger.info(f"Fetching orders from {date_from} to {date_to} ({days} days, all statuses)")

        offset = 0
        has_more = True

        while has_more:
            try:
                orders_data = await client.get_orders(
                    date_from=date_from,
                    date_to=date_to,
                    status=None,  # 不传递状态，获取所有状态的订单
                    limit=batch_size,
                    offset=offset
                )
            except Exception as e:
                logger.error(f"Failed to fetch orders at offset {offset}: {e}")
                break

            result_data = orders_data.get("result", {})
            items = result_data.get("postings", [])
            has_next = result_data.get("has_next", False)

            if not items:
                break

            logger.info(f"Offset {offset}: got {len(items)} orders, has_next={has_next}")

            yield items, has_next

            if not has_next or len(items) < batch_size:
                has_more = False
            else:
                offset += batch_size

    async def fetch_orders_full(
        self,
        client: OzonAPIClient,
        days: int = 360,
        batch_size: int = 200,
    ) -> AsyncIterator[tuple[List[Dict], bool]]:
        """
        全量获取订单（历史订单）

        Args:
            client: OZON API 客户端
            days: 获取最近N天的订单（OZON API限制最大364天）
            batch_size: 每批获取数量

        Yields:
            (items, has_next) - 订单列表、是否有下一页
        """
        date_from = utcnow() - timedelta(days=days)
        date_to = utcnow()

        logger.info(f"Full sync: fetching orders from {date_from} to {date_to}")

        offset = 0
        has_more = True

        while has_more:
            try:
                orders_data = await client.get_orders(
                    date_from=date_from,
                    date_to=date_to,
                    limit=batch_size,
                    offset=offset
                )
            except Exception as e:
                logger.error(f"Failed to fetch orders batch at offset {offset}: {e}")
                raise

            result = orders_data.get("result", {})
            items = result.get("postings", [])
            has_next = result.get("has_next", False)

            if not items:
                break

            logger.info(f"Batch at offset {offset}: got {len(items)} orders, has_next={has_next}")

            yield items, has_next

            if not has_next or len(items) < batch_size:
                has_more = False
                logger.info(f"No more orders to fetch: has_next={has_next}, items_count={len(items)}")
            else:
                offset += batch_size
