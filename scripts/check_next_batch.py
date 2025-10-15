#!/usr/bin/env python3
"""查看下一批待处理订单"""
import asyncio
import sys
from pathlib import Path
from sqlalchemy import select
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))


async def check():
    db_manager = get_db_manager()
    async with db_manager.get_session() as db:
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
        print('接下来10个待处理订单:')
        print('posting_number          | shop_id | delivered_at')
        print('-' * 70)
        shop_counts = {}
        for p in postings:
            print(f'{p.posting_number:23} | {p.shop_id:7} | {p.delivered_at}')
            shop_counts[p.shop_id] = shop_counts.get(p.shop_id, 0) + 1
        print('-' * 70)
        print(f'\n店铺分布:')
        for shop_id, count in sorted(shop_counts.items()):
            print(f'  shop_id={shop_id}: {count}条')


if __name__ == "__main__":
    asyncio.run(check())
