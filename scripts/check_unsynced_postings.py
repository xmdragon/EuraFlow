#!/usr/bin/env python3
"""查看未同步财务的订单统计"""
import asyncio
from sqlalchemy import select, func
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


async def check_unsynced():
    db_manager = get_db_manager()
    async with db_manager.get_session() as db:
        # Count unsynced postings by shop
        result = await db.execute(
            select(
                OzonPosting.shop_id,
                func.count(OzonPosting.id).label('count')
            )
            .where(OzonPosting.status == 'delivered')
            .where(OzonPosting.finance_synced_at.is_(None))
            .where(OzonPosting.posting_number.is_not(None))
            .where(OzonPosting.posting_number != '')
            .group_by(OzonPosting.shop_id)
            .order_by(OzonPosting.shop_id)
        )
        print('未同步财务的已签收订单（按店铺统计）：')
        print('shop_id | count')
        print('-' * 20)
        total = 0
        for row in result:
            print(f'{row.shop_id:7} | {row.count:5}')
            total += row.count
        print('-' * 20)
        print(f'总计    | {total:5}')

        # Show top 10 most recent unsynced postings
        print('\n最近10个未同步订单：')
        result = await db.execute(
            select(OzonPosting)
            .where(OzonPosting.status == 'delivered')
            .where(OzonPosting.finance_synced_at.is_(None))
            .where(OzonPosting.posting_number.is_not(None))
            .where(OzonPosting.posting_number != '')
            .order_by(OzonPosting.delivered_at.desc())
            .limit(10)
        )
        postings = result.scalars().all()
        print('posting_number          | shop_id | delivered_at')
        print('-' * 60)
        for p in postings:
            print(f'{p.posting_number:23} | {p.shop_id:7} | {p.delivered_at}')


if __name__ == "__main__":
    asyncio.run(check_unsynced())
