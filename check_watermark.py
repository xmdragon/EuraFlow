#!/usr/bin/env python3
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import select
from ef_core.database import DatabaseManager
from plugins.ef.channels.ozon.models.watermark import WatermarkConfig

async def check():
    db_manager = DatabaseManager()
    session_factory = db_manager.get_async_session_factory()
    async with session_factory() as db:
        result = await db.execute(
            select(WatermarkConfig).where(WatermarkConfig.is_active == True)
        )
        configs = result.scalars().all()

        print(f"找到 {len(configs)} 个激活的水印配置:\n")
        for config in configs:
            print(f"ID: {config.id}")
            print(f"名称: {config.name}")
            print(f"图片URL: {config.image_url}")
            print(f"Cloudinary Public ID: {config.cloudinary_public_id}")
            print("-" * 60)

asyncio.run(check())
