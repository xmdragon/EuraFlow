#!/usr/bin/env python3
"""
临时脚本：手动同步特定的 posting
"""
import sys
import os
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import asyncio
from datetime import datetime, timezone, timedelta
from sqlalchemy import select

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
from plugins.ef.channels.ozon.api.client import OzonAPIClient
from plugins.ef.channels.ozon.models.orders import OzonPosting


async def sync_specific_postings():
    """同步指定的 posting"""
    db_manager = get_db_manager()

    # 要同步的 posting_numbers
    posting_numbers = ['90233942-0083-1', '90233942-0083-3']

    async with db_manager.get_session() as session:
        # 获取 Непревзойденный супермаркет 店铺
        stmt = select(OzonShop).where(
            OzonShop.shop_name.like('%Непревзойденный%')
        )
        shop = await session.scalar(stmt)

        if not shop:
            print('未找到店铺')
            return

        print(f'使用店铺: {shop.shop_name} (ID: {shop.id})')

        # 创建 API 客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        )

        # 查询最近3天的订单
        date_from = datetime.now(timezone.utc) - timedelta(days=3)
        date_to = datetime.now(timezone.utc)

        try:
            print(f'\n查询订单列表...')
            result = await client.get_orders(
                date_from=date_from,
                date_to=date_to,
                limit=100,
                offset=0
            )

            postings = result.get('result', {}).get('postings', [])
            print(f'找到 {len(postings)} 个订单')

            # 导入 order_sync 的处理函数
            from plugins.ef.channels.ozon.services.order_sync import OrderSyncService

            # 创建同步服务（但不使用 sync_orders 方法，避免创建 sync_log）
            sync_service = OrderSyncService(
                shop_id=shop.id,
                api_client=client
            )

            # 处理目标 posting
            success_count = 0
            for posting_data in postings:
                posting_number = posting_data.get('posting_number')
                if posting_number in posting_numbers:
                    print(f'\n处理 {posting_number}...')
                    try:
                        # 直接调用处理函数
                        await sync_service._process_single_posting(session, posting_data)
                        print(f'  ✅ 成功处理')
                        success_count += 1
                    except Exception as e:
                        print(f'  ❌ 处理失败: {e}')
                        import traceback
                        traceback.print_exc()

            # 提交事务
            if success_count > 0:
                await session.commit()
                print(f'\n✅ 已提交 {success_count} 个 posting 到数据库')

            # 验证结果
            print('\n' + '='*60)
            print('验证同步结果:')
            print('='*60)

            for posting_number in posting_numbers:
                stmt = select(OzonPosting).where(
                    OzonPosting.posting_number == posting_number
                )
                posting = await session.scalar(stmt)

                if posting:
                    print(f'\n✅ {posting_number}:')
                    print(f'  status: {posting.status}')
                    print(f'  operation_status: {posting.operation_status}')
                    print(f'  is_cancelled: {posting.is_cancelled}')
                    print(f'  updated_at: {posting.updated_at}')
                else:
                    print(f'\n❌ {posting_number}: 未找到')

        except Exception as e:
            print(f'\n❌ 同步失败: {e}')
            import traceback
            traceback.print_exc()

        finally:
            await client.close()


if __name__ == "__main__":
    asyncio.run(sync_specific_postings())
