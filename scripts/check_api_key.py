#!/usr/bin/env python3
"""检查数据库中的API key存储"""
import asyncio
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from ef_core.database import DatabaseManager
from plugins.ef.channels.ozon.models.ozon_shops import OzonShop

async def main():
    db_manager = DatabaseManager()
    engine = db_manager.create_async_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        stmt = select(OzonShop).where(OzonShop.status == "active").limit(1)
        result = await db.execute(stmt)
        shop = result.scalar_one_or_none()

        if not shop:
            print("未找到活跃的店铺")
            return

        print(f"店铺名称: {shop.shop_name}")
        print(f"Client ID: {shop.client_id}")
        print(f"API Key (加密): {shop.api_key_enc[:100]}...")
        print(f"API Key 长度: {len(shop.api_key_enc)}")
        print(f"API Key 是否为空: {not shop.api_key_enc}")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
