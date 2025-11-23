#!/usr/bin/env python3
"""
检查 webhook 订单是否有对应的真实订单
"""
import asyncio
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, and_
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonOrder, OzonPosting
from plugins.ef.channels.ozon.models import OzonShop
from plugins.ef.channels.ozon.api.client import OzonAPIClient


async def check():
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 获取所有 webhook_ 订单
        stmt = select(OzonPosting).join(
            OzonOrder, OzonOrder.id == OzonPosting.order_id
        ).where(
            OzonOrder.ozon_order_id.like('webhook_%')
        )

        postings = await session.scalars(stmt)
        webhook_postings = list(postings)

        print(f"找到 {len(webhook_postings)} 个 webhook 订单")
        print("检查前 10 个订单是否有对应的真实订单...\n")

        has_real_order = 0
        no_real_order = 0
        api_not_found = 0

        for posting in webhook_postings[:10]:
            shop = await session.get(OzonShop, posting.shop_id)
            api_client = OzonAPIClient(
                client_id=shop.client_id,
                api_key=shop.api_key_enc,
                shop_id=posting.shop_id
            )

            try:
                response = await api_client.get_posting_details(
                    posting_number=posting.posting_number,
                    with_analytics_data=False,
                    with_financial_data=False
                )

                result = response.get('result')
                if result and result.get('order_id'):
                    order_id = str(result['order_id'])

                    # 检查是否有对应的真实订单
                    real_order_stmt = select(OzonOrder).where(
                        and_(
                            OzonOrder.shop_id == posting.shop_id,
                            OzonOrder.ozon_order_id == order_id
                        )
                    )
                    real_order = await session.scalar(real_order_stmt)

                    if real_order:
                        has_real_order += 1
                        status = "有真实订单"
                        detail = f"ID: {real_order.id}"
                    else:
                        no_real_order += 1
                        status = "无真实订单"
                        detail = f"order_id: {order_id}"

                    print(f"[{status}] {posting.posting_number} ({detail})")
                else:
                    api_not_found += 1
                    print(f"[API无数据] {posting.posting_number}")
            except Exception as e:
                api_not_found += 1
                print(f"[API错误] {posting.posting_number}: {str(e)[:50]}")

            await api_client.close()
            await asyncio.sleep(0.2)

        print(f"\n统计（前10个）:")
        print(f"  有真实订单: {has_real_order}")
        print(f"  无真实订单: {no_real_order}")
        print(f"  API查询失败: {api_not_found}")


if __name__ == "__main__":
    asyncio.run(check())
