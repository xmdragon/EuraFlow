#!/usr/bin/env python3
"""检查特定订单的保存情况"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from ef_core.database import get_async_session


async def check_records():
    posting_numbers = [
        '0133383139-0107-1',  # 转售
        '29749280-0640-1',    # 转售
        '30410872-0445-1',    # 库存发货
    ]

    async for session in get_async_session():
        try:
            for pn in posting_numbers:
                print(f"\n{'='*60}")
                print(f"货件编号: {pn}")
                print(f"{'='*60}")

                # 查询 posting 信息
                stmt = text("""
                    SELECT purchase_price, order_notes
                    FROM ozon_postings
                    WHERE posting_number = :posting_number
                """)
                result = await session.execute(stmt, {"posting_number": pn})
                row = result.fetchone()

                if row:
                    print(f"进货价格: {row[0]}")
                    print(f"订单备注: {row[1] if row[1] else '(无)'}")
                else:
                    print("未找到该货件")
                    continue

                # 查询国内单号
                stmt_tracking = text("""
                    SELECT tracking_number
                    FROM ozon_domestic_tracking_numbers
                    WHERE posting_id = (SELECT id FROM ozon_postings WHERE posting_number = :posting_number)
                """)
                result_tracking = await session.execute(stmt_tracking, {"posting_number": pn})
                tracking_rows = result_tracking.fetchall()

                if tracking_rows:
                    print(f"国内单号数量: {len(tracking_rows)}")
                    for i, tr in enumerate(tracking_rows, 1):
                        print(f"  单号{i}: {tr[0]}")
                else:
                    print("国内单号: (无)")

        finally:
            await session.close()


if __name__ == "__main__":
    asyncio.run(check_records())
