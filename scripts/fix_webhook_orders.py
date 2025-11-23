#!/usr/bin/env python3
"""
临时脚本：批量同步 webhook 临时订单
将所有 webhook_ 开头的临时订单同步为真实订单
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonOrder, OzonPosting
from plugins.ef.channels.ozon.models import OzonShop
from plugins.ef.channels.ozon.api.client import OzonAPIClient
from plugins.ef.channels.ozon.services.order_sync import OrderSyncService


async def sync_webhook_orders():
    """批量同步所有 webhook 临时订单"""
    db_manager = get_db_manager()

    # 先获取所有要同步的posting列表
    async with db_manager.get_session() as session:
        stmt = select(OzonPosting).join(
            OzonOrder, OzonOrder.id == OzonPosting.order_id
        ).where(
            OzonOrder.ozon_order_id.like('webhook_%')
        ).order_by(OzonPosting.id)

        result = await session.execute(stmt)
        postings = result.scalars().all()

        # 提取posting信息
        posting_list = [(p.posting_number, p.shop_id) for p in postings]

    total = len(posting_list)
    print(f"找到 {total} 个临时订单，开始批量同步...")

    success_count = 0
    failed_count = 0
    failed_postings = []

    for idx, (posting_number, shop_id) in enumerate(posting_list, 1):
        print(f"\n[{idx}/{total}] 同步 posting {posting_number} (shop_id={shop_id})...")

        try:
            # 每个订单使用独立的session和事务
            async with db_manager.get_session() as sync_session:
                # 获取店铺信息
                shop = await sync_session.get(OzonShop, shop_id)
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
                    with_analytics_data=True,
                    with_financial_data=True
                )

                if not detail_response.get("result"):
                    print(f"  ✗ 在OZON中未找到货件 {posting_number}")
                    failed_count += 1
                    failed_postings.append((posting_number, "OZON中不存在"))
                    await api_client.close()
                    continue

                posting_data = detail_response["result"]

                # 使用订单同步服务处理数据
                sync_service = OrderSyncService(shop_id=shop_id, api_client=api_client)
                await sync_service._process_single_posting(sync_session, posting_data)
                await sync_session.commit()

                await api_client.close()

            print(f"  ✓ 同步成功")
            success_count += 1

            # 每10个订单休息一下，避免API限流
            if idx % 10 == 0:
                await asyncio.sleep(1)

        except Exception as e:
            print(f"  ✗ 同步失败: {e}")
            import traceback
            traceback.print_exc()
            failed_count += 1
            failed_postings.append((posting_number, str(e)))

    print("\n" + "="*60)
    print(f"批量同步完成！")
    print(f"总计: {total} 个订单")
    print(f"成功: {success_count} 个")
    print(f"失败: {failed_count} 个")

    if failed_postings:
        print("\n失败的货件编号:")
        for posting_number, reason in failed_postings:
            print(f"  - {posting_number}: {reason}")


if __name__ == "__main__":
    print("开始批量同步 webhook 临时订单...")
    asyncio.run(sync_webhook_orders())
    print("\n脚本执行完成。")
