#!/usr/bin/env python3
"""
同步CSV文件数据到数据库
根据货件编号同步进货价格和国内单号
使用原始SQL避免ORM模型冲突
"""
import asyncio
import csv
import sys
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

# 添加项目根目录到Python路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import text
from ef_core.database import get_async_session


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


async def sync_csv_data(csv_path: str):
    """
    同步CSV数据到数据库

    Args:
        csv_path: CSV文件路径
    """
    # 统计数据
    total = 0
    skipped = 0  # 两个值都有，跳过
    updated_price = 0  # 更新了进货价格
    updated_tracking = 0  # 更新了国内单号
    updated_both = 0  # 两个都更新了
    not_found = 0  # 货件编号未找到
    errors = 0  # 错误数量

    print(f"开始同步CSV数据: {csv_path}")
    print("=" * 80)

    # 读取CSV文件
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        total = len(rows)
        print(f"CSV文件共有 {total} 条记录\n")

    # 获取数据库会话
    async for session in get_async_session():
        try:
            for idx, row in enumerate(rows, 1):
                posting_number = row.get('货件编号', '').strip()
                purchase_price_str = row.get('进货价格', '').strip()
                tracking_number = row.get('国内运单号', '').strip()

                if not posting_number:
                    print(f"[{idx}/{total}] 跳过：货件编号为空")
                    errors += 1
                    continue

                # 查询 posting
                stmt = text("""
                    SELECT id, purchase_price
                    FROM ozon_postings
                    WHERE posting_number = :posting_number
                """)
                result = await session.execute(stmt, {"posting_number": posting_number})
                posting_row = result.fetchone()

                if not posting_row:
                    print(f"[{idx}/{total}] 未找到货件: {posting_number}")
                    not_found += 1
                    continue

                posting_id = posting_row[0]
                has_price = posting_row[1] is not None

                # 查询是否有国内单号
                stmt_tracking = text("""
                    SELECT COUNT(*) FROM ozon_domestic_tracking_numbers
                    WHERE posting_id = :posting_id
                """)
                result_tracking = await session.execute(stmt_tracking, {"posting_id": posting_id})
                tracking_count = result_tracking.scalar()
                has_tracking = tracking_count > 0

                # 如果两个值都有，跳过
                if has_price and has_tracking:
                    print(f"[{idx}/{total}] 跳过（已有数据）: {posting_number}")
                    skipped += 1
                    continue

                # 标记是否有更新
                updated = []

                # 更新进货价格
                if not has_price and purchase_price_str:
                    try:
                        purchase_price = Decimal(purchase_price_str)
                        update_stmt = text("""
                            UPDATE ozon_postings
                            SET purchase_price = :purchase_price,
                                purchase_price_updated_at = :updated_at
                            WHERE id = :posting_id
                        """)
                        await session.execute(update_stmt, {
                            "purchase_price": purchase_price,
                            "updated_at": utcnow(),
                            "posting_id": posting_id
                        })
                        updated.append('价格')
                    except Exception as e:
                        print(f"[{idx}/{total}] 进货价格格式错误: {posting_number}, {purchase_price_str}, {e}")
                        errors += 1
                        continue

                # 添加国内单号
                if not has_tracking and tracking_number:
                    # 检查是否已存在相同单号（避免重复）
                    check_stmt = text("""
                        SELECT COUNT(*) FROM ozon_domestic_tracking_numbers
                        WHERE posting_id = :posting_id AND tracking_number = :tracking_number
                    """)
                    check_result = await session.execute(check_stmt, {
                        "posting_id": posting_id,
                        "tracking_number": tracking_number
                    })
                    exists = check_result.scalar() > 0

                    if not exists:
                        insert_stmt = text("""
                            INSERT INTO ozon_domestic_tracking_numbers (posting_id, tracking_number, created_at)
                            VALUES (:posting_id, :tracking_number, :created_at)
                        """)
                        await session.execute(insert_stmt, {
                            "posting_id": posting_id,
                            "tracking_number": tracking_number,
                            "created_at": utcnow()
                        })
                        updated.append('单号')

                # 如果有更新，提交
                if updated:
                    await session.commit()

                    # 统计
                    if len(updated) == 2:
                        updated_both += 1
                        print(f"[{idx}/{total}] ✅ 更新价格+单号: {posting_number} - 价格:{purchase_price_str}, 单号:{tracking_number}")
                    elif '价格' in updated:
                        updated_price += 1
                        print(f"[{idx}/{total}] ✅ 更新价格: {posting_number} - {purchase_price_str}")
                    elif '单号' in updated:
                        updated_tracking += 1
                        print(f"[{idx}/{total}] ✅ 更新单号: {posting_number} - {tracking_number}")
                else:
                    # CSV中没有需要更新的数据
                    print(f"[{idx}/{total}] 跳过（CSV无新数据）: {posting_number}")
                    skipped += 1

            print("\n" + "=" * 80)
            print("同步完成！")
            print(f"总记录数: {total}")
            print(f"跳过（已有完整数据）: {skipped}")
            print(f"更新进货价格: {updated_price}")
            print(f"更新国内单号: {updated_tracking}")
            print(f"更新价格+单号: {updated_both}")
            print(f"货件未找到: {not_found}")
            print(f"错误数量: {errors}")
            print("=" * 80)

        except Exception as e:
            print(f"❌ 发生错误: {e}")
            import traceback
            traceback.print_exc()
            await session.rollback()
        finally:
            await session.close()


if __name__ == "__main__":
    csv_path = "/mnt/e/pics/1.csv"
    asyncio.run(sync_csv_data(csv_path))
