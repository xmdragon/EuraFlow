#!/usr/bin/env python3
"""检查 CSV 中哪些 posting_number 在数据库中不存在"""
import asyncio
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from ef_core.database import get_async_session


async def check_missing_postings(csv_path: str):
    """检查CSV中缺失的posting_number"""
    missing_postings = []

    # 读取CSV文件
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)

    print(f"检查 CSV 文件: {csv_path}")
    print(f"共有 {len(rows)} 条记录")
    print("=" * 80)

    async for session in get_async_session():
        try:
            for idx, row in enumerate(rows, 1):
                posting_number = row.get('货件编号', '').strip()

                if not posting_number:
                    continue

                # 查询 posting 是否存在
                stmt = text("""
                    SELECT id FROM ozon_postings
                    WHERE posting_number = :posting_number
                """)
                result = await session.execute(stmt, {"posting_number": posting_number})
                posting_row = result.fetchone()

                if not posting_row:
                    purchase_price = row.get('进货价格', '').strip()
                    tracking_number = row.get('国内运单号', '').strip()
                    missing_postings.append({
                        'row': idx,
                        'posting_number': posting_number,
                        'purchase_price': purchase_price,
                        'tracking_number': tracking_number
                    })

            print(f"\n找到 {len(missing_postings)} 个未在数据库中的货件编号:\n")

            if missing_postings:
                print(f"{'序号':<6} {'货件编号':<25} {'进货价格':<12} {'国内运单号':<20}")
                print("-" * 80)
                for item in missing_postings:
                    print(f"{item['row']:<6} {item['posting_number']:<25} {item['purchase_price']:<12} {item['tracking_number']:<20}")
            else:
                print("✓ 所有货件编号都在数据库中存在")

            print("\n" + "=" * 80)

        finally:
            await session.close()


if __name__ == "__main__":
    csv_path = "/mnt/e/pics/1.csv"
    asyncio.run(check_missing_postings(csv_path))
