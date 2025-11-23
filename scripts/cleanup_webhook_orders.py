#!/usr/bin/env python3
"""
清理 webhook 临时订单
1. 将 webhook_ 订单的 posting 重新关联到真实订单
2. 删除 webhook_ 订单
"""
import asyncio
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, and_, delete
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonOrder, OzonPosting, OzonOrderItem
from plugins.ef.channels.ozon.models import OzonShop
from plugins.ef.channels.ozon.api.client import OzonAPIClient


async def cleanup_webhook_orders():
    """清理所有 webhook 临时订单"""
    db_manager = get_db_manager()

    # 获取所有 webhook_ 订单
    async with db_manager.get_session() as session:
        stmt = select(OzonPosting).join(
            OzonOrder, OzonOrder.id == OzonPosting.order_id
        ).where(
            OzonOrder.ozon_order_id.like('webhook_%')
        ).order_by(OzonPosting.id)

        result = await session.execute(stmt)
        postings = result.scalars().all()

        # 提取信息
        posting_list = [(p.id, p.posting_number, p.shop_id, p.order_id) for p in postings]

    total = len(posting_list)
    print(f"找到 {total} 个 webhook 订单，开始清理...\n")

    migrated_count = 0
    deleted_count = 0
    failed_count = 0
    failed_postings = []

    for idx, (posting_id, posting_number, shop_id, webhook_order_id) in enumerate(posting_list, 1):
        print(f"[{idx}/{total}] 处理 posting {posting_number} (shop_id={shop_id})...")

        try:
            async with db_manager.get_session() as work_session:
                # 获取店铺信息
                shop = await work_session.get(OzonShop, shop_id)
                if not shop:
                    print(f"  ✗ 店铺 {shop_id} 不存在")
                    failed_count += 1
                    failed_postings.append((posting_number, "店铺不存在"))
                    continue

                # 创建 API 客户端
                api_client = OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc,
                    shop_id=shop_id
                )

                # 获取 posting 详情
                detail_response = await api_client.get_posting_details(
                    posting_number=posting_number,
                    with_analytics_data=False,
                    with_financial_data=False
                )

                if not detail_response.get("result"):
                    print(f"  ✗ API 未返回数据")
                    failed_count += 1
                    failed_postings.append((posting_number, "API未返回数据"))
                    await api_client.close()
                    continue

                posting_data = detail_response["result"]
                order_id = posting_data.get("order_id")

                if not order_id:
                    print(f"  ✗ API 未返回 order_id")
                    failed_count += 1
                    failed_postings.append((posting_number, "API未返回order_id"))
                    await api_client.close()
                    continue

                # 查找真实订单
                real_order_stmt = select(OzonOrder).where(
                    and_(
                        OzonOrder.shop_id == shop_id,
                        OzonOrder.ozon_order_id == str(order_id)
                    )
                )
                real_order = await work_session.scalar(real_order_stmt)

                if not real_order:
                    print(f"  ✗ 未找到真实订单 (order_id={order_id})")
                    failed_count += 1
                    failed_postings.append((posting_number, f"未找到真实订单 {order_id}"))
                    await api_client.close()
                    continue

                # 迁移 posting 到真实订单
                posting_obj = await work_session.get(OzonPosting, posting_id)
                if posting_obj:
                    old_order_id = posting_obj.order_id
                    posting_obj.order_id = real_order.id

                    # 删除 webhook_ 订单的商品（如果有）
                    delete_items_stmt = delete(OzonOrderItem).where(
                        OzonOrderItem.order_id == old_order_id
                    )
                    await work_session.execute(delete_items_stmt)

                    # 删除 webhook_ 订单
                    webhook_order = await work_session.get(OzonOrder, old_order_id)
                    if webhook_order:
                        await work_session.delete(webhook_order)

                    await work_session.commit()

                    migrated_count += 1
                    deleted_count += 1
                    print(f"  ✓ 已迁移 posting 到真实订单 (ID: {real_order.id}) 并删除 webhook 订单")
                else:
                    print(f"  ✗ 未找到 posting 对象")
                    failed_count += 1
                    failed_postings.append((posting_number, "未找到posting对象"))

                await api_client.close()

            # 每 10 个订单休息一下
            if idx % 10 == 0:
                await asyncio.sleep(1)

        except Exception as e:
            print(f"  ✗ 处理失败: {e}")
            import traceback
            traceback.print_exc()
            failed_count += 1
            failed_postings.append((posting_number, str(e)))

    print("\n" + "="*60)
    print(f"清理完成！")
    print(f"总计: {total} 个订单")
    print(f"成功迁移: {migrated_count} 个")
    print(f"成功删除: {deleted_count} 个")
    print(f"失败: {failed_count} 个")

    if failed_postings:
        print("\n失败的货件编号:")
        for posting_number, reason in failed_postings:
            print(f"  - {posting_number}: {reason}")


if __name__ == "__main__":
    print("开始清理 webhook 临时订单...")
    asyncio.run(cleanup_webhook_orders())
    print("\n脚本执行完成。")
