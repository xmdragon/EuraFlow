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


def is_valid_tracking_number(tracking_number: str) -> bool:
    """
    判断是否是有效的物流单号

    有效的物流单号通常：
    - 长度至少10位
    - 主要由数字和字母组成
    - 不包含中文字符

    Args:
        tracking_number: 待检查的单号

    Returns:
        True表示是有效的物流单号，False表示可能是备注信息
    """
    if not tracking_number or len(tracking_number) < 10:
        return False

    # 检查是否包含中文字符
    if any('\u4e00' <= char <= '\u9fff' for char in tracking_number):
        return False

    # 检查是否主要由数字和字母组成（至少80%）
    alphanumeric_count = sum(1 for char in tracking_number if char.isalnum())
    if alphanumeric_count / len(tracking_number) < 0.8:
        return False

    return True


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
    updated_notes = 0  # 更新了备注
    updated_both = 0  # 更新了多个字段
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

                # 处理国内单号或备注信息
                if tracking_number:
                    # 判断是否是有效的物流单号
                    is_valid = is_valid_tracking_number(tracking_number)

                    if is_valid and not has_tracking:
                        # 是有效的物流单号，添加到国内单号表
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
                    elif not is_valid:
                        # 不是有效的物流单号，保存为备注信息
                        # 查询当前备注
                        check_notes_stmt = text("""
                            SELECT order_notes FROM ozon_postings WHERE id = :posting_id
                        """)
                        notes_result = await session.execute(check_notes_stmt, {"posting_id": posting_id})
                        current_notes = notes_result.scalar()

                        # 如果备注为空或不包含该信息，则更新
                        if not current_notes or tracking_number not in current_notes:
                            new_notes = f"{current_notes}\n{tracking_number}" if current_notes else tracking_number
                            update_notes_stmt = text("""
                                UPDATE ozon_postings
                                SET order_notes = :order_notes
                                WHERE id = :posting_id
                            """)
                            await session.execute(update_notes_stmt, {
                                "order_notes": new_notes.strip(),
                                "posting_id": posting_id
                            })
                            updated.append('备注')

                # 如果有更新，提交
                if updated:
                    await session.commit()

                    # 统计并打印
                    update_desc = "+".join(updated)
                    details = []
                    if '价格' in updated:
                        updated_price += 1
                        details.append(f"价格:{purchase_price_str}")
                    if '单号' in updated:
                        updated_tracking += 1
                        details.append(f"单号:{tracking_number}")
                    if '备注' in updated:
                        updated_notes += 1
                        details.append(f"备注:{tracking_number}")

                    if len(updated) >= 2:
                        updated_both += 1

                    detail_str = ", ".join(details)
                    print(f"[{idx}/{total}] ✅ 更新{update_desc}: {posting_number} - {detail_str}")
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
