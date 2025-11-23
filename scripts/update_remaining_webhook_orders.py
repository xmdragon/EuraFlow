#!/usr/bin/env python3
"""
更新剩余的 webhook 订单 ID
这些订单有退货记录，不能删除，只能更新 ID
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


async def update_webhook_orders():
    """更新剩余的 webhook 订单 ID"""
    db_manager = get_db_manager()

    # 获取剩余的 webhook_ 订单
    async with db_manager.get_session() as session:
        stmt = select(OzonPosting).join(
            OzonOrder, OzonOrder.id == OzonPosting.order_id
        ).where(
            OzonOrder.ozon_order_id.like('webhook_%')
        ).order_by(OzonPosting.id)

        result = await session.execute(stmt)
        postings = result.scalars().all()
        posting_list = [(p.posting_number, p.shop_id, p.order_id) for p in postings]

    total = len(posting_list)
    print(f"找到 {total} 个剩余的 webhook 订单，开始更新...\n")

    updated_count = 0
    failed_count = 0

    for idx, (posting_number, shop_id, webhook_order_id) in enumerate(posting_list, 1):
        print(f"[{idx}/{total}] 更新 posting {posting_number} (shop_id={shop_id})...")

        try:
            async with db_manager.get_session() as work_session:
                shop = await work_session.get(OzonShop, shop_id)
                if not shop:
                    print(f"  ✗ 店铺不存在")
                    failed_count += 1
                    continue

                api_client = OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc,
                    shop_id=shop_id
                )

                # 获取 posting 详情
                detail_response = await api_client.get_posting_details(
                    posting_number=posting_number,
                    with_analytics_data=True,
                    with_financial_data=True
                )

                if not detail_response.get("result"):
                    print(f"  ✗ API 未返回数据")
                    failed_count += 1
                    await api_client.close()
                    continue

                posting_data = detail_response["result"]
                order_id = posting_data.get("order_id")

                if not order_id:
                    print(f"  ✗ API 未返回 order_id")
                    failed_count += 1
                    await api_client.close()
                    continue

                # 更新 webhook 订单的 ID
                webhook_order = await work_session.get(OzonOrder, webhook_order_id)
                if webhook_order:
                    old_ozon_id = webhook_order.ozon_order_id
                    webhook_order.ozon_order_id = str(order_id)
                    webhook_order.order_id = f"OZ-{order_id}"

                    # 使用订单同步服务更新订单完整数据
                    from plugins.ef.channels.ozon.services.order_sync import OrderSyncService

                    sync_service = OrderSyncService(shop_id=shop_id, api_client=api_client)
                    await sync_service._process_single_posting(work_session, posting_data)

                    await work_session.commit()

                    updated_count += 1
                    print(f"  ✓ 已更新: {old_ozon_id} → {order_id}")
                else:
                    print(f"  ✗ 未找到订单对象")
                    failed_count += 1

                await api_client.close()

        except Exception as e:
            print(f"  ✗ 更新失败: {e}")
            import traceback
            traceback.print_exc()
            failed_count += 1

    print("\n" + "="*60)
    print(f"更新完成！")
    print(f"总计: {total} 个订单")
    print(f"成功更新: {updated_count} 个")
    print(f"失败: {failed_count} 个")


if __name__ == "__main__":
    print("开始更新剩余的 webhook 订单...")
    asyncio.run(update_webhook_orders())
    print("\n脚本执行完成。")
