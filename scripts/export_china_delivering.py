#!/usr/bin/env python3
"""
临时脚本：导出OZON状态为"运输中"且配送为"China"开头的订单数据
导出字段：posting_number, tracking_number
"""
import os
import csv
import asyncio
from pathlib import Path
from dotenv import load_dotenv
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import selectinload

# 导入模型
import sys
sys.path.insert(0, '/opt/euraflow')

# 加载 .env 文件
env_path = Path('/opt/euraflow/.env')
if env_path.exists():
    load_dotenv(env_path)

from plugins.ef.channels.ozon.models.orders import OzonPosting, OzonShipmentPackage


async def export_china_delivering_orders():
    """导出符合条件的订单数据"""

    # 从环境变量读取数据库配置
    db_host = os.getenv('EF__DB_HOST', 'localhost')
    db_port = os.getenv('EF__DB_PORT', '5432')
    db_name = os.getenv('EF__DB_NAME', 'euraflow')
    db_user = os.getenv('EF__DB_USER', 'euraflow')
    db_password = os.getenv('EF__DB_PASSWORD', 'euraflow_dev')

    # 构建数据库URL
    database_url = f"postgresql+asyncpg://{db_user}:{db_password}@{db_host}:{db_port}/{db_name}"

    # 创建引擎
    engine = create_async_engine(database_url, echo=False)

    try:
        async with AsyncSession(engine) as session:
            # 查询符合条件的postings
            # 条件：状态为delivering，配送方式为China开头，且有追踪号码
            stmt = (
                select(OzonPosting)
                .where(
                    and_(
                        OzonPosting.status == 'delivering',
                        OzonPosting.delivery_method_name.like('China%'),
                        OzonPosting.raw_payload['tracking_number'].isnot(None)
                    )
                )
                .order_by(OzonPosting.shipment_date.desc().nulls_last())
            )

            result = await session.execute(stmt)
            postings = result.scalars().all()

            print(f"找到 {len(postings)} 条符合条件的订单")

            # 准备导出数据
            rows = []
            for posting in postings:
                # 从raw_payload提取tracking_number
                tracking_number = posting.raw_payload.get('tracking_number') if posting.raw_payload else None

                # 只导出有追踪号码的记录
                if tracking_number:
                    rows.append({
                        'posting_number': posting.posting_number,
                        'tracking_number': tracking_number,
                        'order_time': posting.shipment_date.strftime('%Y-%m-%d %H:%M:%S') if posting.shipment_date else ''
                    })

            # 导出为CSV
            output_file = '/opt/euraflow/logs/china_delivering_orders.csv'

            with open(output_file, 'w', newline='', encoding='utf-8') as f:
                writer = csv.DictWriter(f, fieldnames=['posting_number', 'tracking_number', 'order_time'])
                writer.writeheader()
                writer.writerows(rows)

            print(f"数据已导出到: {output_file}")
            print(f"总计: {len(rows)} 条记录")

    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(export_china_delivering_orders())
