#!/usr/bin/env python3
"""检查店铺信息"""
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
from ef_core.database import get_db_manager
import asyncio

async def check_shops():
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        from sqlalchemy import select

        # 查询所有店铺
        stmt = select(OzonShop).limit(5)
        result = await session.execute(stmt)
        shops = result.scalars().all()

        print(f'找到 {len(shops)} 个店铺:')
        print('=' * 80)

        for shop in shops:
            print(f'\nShop ID: {shop.id}')
            print(f'Shop Name: {shop.shop_name}')
            print(f'Shop Name CN: {shop.shop_name_cn}')
            print(f'Client ID: {shop.client_id}')
            print(f'Status: {shop.status}')
            print(f'Config: {shop.config}')

if __name__ == '__main__':
    asyncio.run(check_shops())
