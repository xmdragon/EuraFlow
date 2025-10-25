#!/usr/bin/env python3
"""修复无效的物流单号：从单号表删除并移到备注字段"""
import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from sqlalchemy import text
from ef_core.database import get_async_session


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


def is_valid_tracking_number(tracking_number: str) -> bool:
    """
    判断是否是有效的物流单号
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


async def fix_invalid_tracking_numbers():
    """查找并修复所有无效的物流单号"""
    total_checked = 0
    total_invalid = 0
    total_fixed = 0

    print("开始扫描数据库中的无效物流单号...")
    print("=" * 80)

    async for session in get_async_session():
        try:
            # 查询所有国内单号
            stmt = text("""
                SELECT dt.id, dt.posting_id, dt.tracking_number, p.posting_number, p.order_notes
                FROM ozon_domestic_tracking_numbers dt
                JOIN ozon_postings p ON p.id = dt.posting_id
                ORDER BY dt.id
            """)
            result = await session.execute(stmt)
            rows = result.fetchall()
            total_checked = len(rows)

            print(f"共找到 {total_checked} 条国内单号记录\n")

            for row in rows:
                tracking_id, posting_id, tracking_number, posting_number, current_notes = row

                # 验证单号
                is_valid = is_valid_tracking_number(tracking_number)

                if not is_valid:
                    total_invalid += 1
                    print(f"[{total_invalid}] 发现无效单号:")
                    print(f"  货件编号: {posting_number}")
                    print(f"  无效单号: {tracking_number}")

                    # 1. 删除无效单号记录
                    delete_stmt = text("""
                        DELETE FROM ozon_domestic_tracking_numbers
                        WHERE id = :tracking_id
                    """)
                    await session.execute(delete_stmt, {"tracking_id": tracking_id})

                    # 2. 添加到备注字段
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
                        print(f"  ✓ 已移至备注字段")
                    else:
                        print(f"  ✓ 备注中已存在该信息")

                    await session.commit()
                    total_fixed += 1
                    print()

            print("=" * 80)
            print("修复完成！")
            print(f"扫描记录数: {total_checked}")
            print(f"发现无效单号: {total_invalid}")
            print(f"成功修复: {total_fixed}")
            print("=" * 80)

        except Exception as e:
            print(f"❌ 发生错误: {e}")
            import traceback
            traceback.print_exc()
            await session.rollback()
        finally:
            await session.close()


if __name__ == "__main__":
    asyncio.run(fix_invalid_tracking_numbers())
