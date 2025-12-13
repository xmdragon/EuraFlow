#!/usr/bin/env python3
"""
导入 OZON 物流费率数据
从 tmp/ship.csv 导入到 ozon_shipping_rates 表
"""
import asyncio
import csv
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, delete

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonShippingRate


def parse_bool(value: str) -> bool:
    """解析 允许/禁止 为 Boolean"""
    return value.strip() == "允许"


def parse_int(value: str) -> int | None:
    """解析整数，处理千分位分隔符"""
    if not value or value.strip() == "-":
        return None
    # 移除千分位分隔符（逗号）
    cleaned = value.strip().replace(",", "").replace(" ", "")
    try:
        return int(cleaned)
    except ValueError:
        return None


async def import_shipping_rates():
    """导入物流费率数据"""
    csv_path = Path(__file__).parent.parent / "tmp" / "ship.csv"

    if not csv_path.exists():
        print(f"CSV 文件不存在: {csv_path}")
        return

    print(f"读取 CSV 文件: {csv_path}")

    records = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.reader(f)
        rows = list(reader)

    # 第1行是标题，第2行是空行，第3行是表头，第4行开始是数据
    header_row = rows[2]
    data_rows = rows[3:]

    print(f"表头: {header_row}")
    print(f"数据行数: {len(data_rows)}")

    for row in data_rows:
        # 跳过分隔行（包含 переход）
        if not row or len(row) < 5:
            continue
        if "переход" in row[1]:
            continue

        # 解析字段（第一列是空的）
        try:
            record = OzonShippingRate(
                size_group=row[1].strip() if row[1] else None,
                service_level=row[2].strip() if row[2] else None,
                logistics_provider=row[3].strip() if row[3] else None,
                delivery_method=row[4].strip() if row[4] else None,
                ozon_rating=parse_int(row[5]) if len(row) > 5 else None,
                transit_days=row[6].strip() if len(row) > 6 and row[6] else None,
                rate=row[7].strip() if len(row) > 7 and row[7] else None,
                battery_allowed=parse_bool(row[8]) if len(row) > 8 else False,
                liquid_allowed=parse_bool(row[9]) if len(row) > 9 else False,
                size_limit=row[10].strip() if len(row) > 10 and row[10] else None,
                weight_min_g=parse_int(row[11]) if len(row) > 11 else None,
                weight_max_g=parse_int(row[12]) if len(row) > 12 else None,
                value_limit_rub=row[13].strip() if len(row) > 13 and row[13] else None,
                value_limit_cny=row[14].strip() if len(row) > 14 and row[14] else None,
                value_limit_usd=row[15].strip() if len(row) > 15 and row[15] else None,
                value_limit_eur=row[16].strip() if len(row) > 16 and row[16] else None,
                billing_type=row[17].strip() if len(row) > 17 and row[17] else None,
                volume_weight_calc=row[18].strip() if len(row) > 18 and row[18] else None,
                loss_compensation_rub=parse_int(row[19]) if len(row) > 19 else None,
            )

            # 验证必填字段
            if record.size_group and record.service_level and record.logistics_provider:
                records.append(record)
        except Exception as e:
            print(f"解析行出错: {row[:5]}... 错误: {e}")
            continue

    print(f"有效记录数: {len(records)}")

    # 写入数据库
    db_manager = get_db_manager()
    async with db_manager.get_session() as db:
        # 清空现有数据
        await db.execute(delete(OzonShippingRate))
        print("已清空现有数据")

        # 批量插入
        db.add_all(records)
        await db.commit()
        print(f"成功导入 {len(records)} 条记录")

    # 验证
    async with db_manager.get_session() as db:
        result = await db.execute(select(OzonShippingRate))
        count = len(result.scalars().all())
        print(f"数据库中共有 {count} 条记录")


if __name__ == "__main__":
    asyncio.run(import_shipping_rates())
