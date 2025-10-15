#!/usr/bin/env python3
"""
临时脚本：根据 CSV 文件批量更新采购价格
CSV 格式：posting_number,purchase_price
"""
import sys
import os
import csv
from decimal import Decimal
from datetime import datetime, timezone

# 添加项目路径
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from sqlalchemy import select, update
from ef_core.database import get_db_session
from plugins.ef.channels.ozon.models.orders import OzonPosting


def update_purchase_prices_from_csv(csv_file_path: str):
    """从 CSV 文件读取并更新采购价格"""

    # 检查文件是否存在
    if not os.path.exists(csv_file_path):
        print(f"❌ 文件不存在: {csv_file_path}")
        return

    # 读取 CSV 数据
    updates = []
    with open(csv_file_path, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        for row_num, row in enumerate(reader, start=1):
            # 跳过表头行（检测是否包含中文或英文表头关键字）
            if row_num == 1 and (
                '货件编号' in row[0] or
                'posting_number' in row[0].lower() or
                '进货价格' in row[1] if len(row) > 1 else False
            ):
                print(f"跳过表头: {row}")
                continue

            if len(row) < 2:
                print(f"⚠️  第 {row_num} 行格式错误，跳过: {row}")
                continue

            posting_number = row[0].strip()
            try:
                purchase_price = Decimal(row[1].strip())
                updates.append((posting_number, purchase_price))
            except (ValueError, Exception) as e:
                print(f"⚠️  第 {row_num} 行价格格式错误，跳过: {row} - {e}")
                continue

    if not updates:
        print("❌ 没有有效的数据需要更新")
        return

    print(f"📊 共读取到 {len(updates)} 条数据")
    print(f"前 5 条预览:")
    for posting_number, price in updates[:5]:
        print(f"  {posting_number}: {price}")

    # 询问确认
    confirm = input(f"\n是否继续更新这 {len(updates)} 条记录？(yes/no): ")
    if confirm.lower() not in ['yes', 'y']:
        print("❌ 取消更新")
        return

    # 连接数据库并更新
    with get_db_session() as db:
        success_count = 0
        not_found_count = 0
        error_count = 0

        for posting_number, purchase_price in updates:
            try:
                # 查询 posting 是否存在
                stmt = select(OzonPosting).where(OzonPosting.posting_number == posting_number)
                result = db.execute(stmt)
                posting = result.scalar_one_or_none()

                if not posting:
                    print(f"⚠️  未找到: {posting_number}")
                    not_found_count += 1
                    continue

                # 更新采购价格
                posting.purchase_price = purchase_price
                posting.purchase_price_updated_at = datetime.now(timezone.utc)

                db.commit()
                success_count += 1

                if success_count % 10 == 0:
                    print(f"✅ 已更新 {success_count} 条...")

            except Exception as e:
                db.rollback()
                print(f"❌ 更新失败 {posting_number}: {e}")
                error_count += 1
                continue

    # 输出统计
    print("\n" + "="*50)
    print("📊 更新完成统计:")
    print(f"  ✅ 成功更新: {success_count} 条")
    print(f"  ⚠️  未找到: {not_found_count} 条")
    print(f"  ❌ 更新失败: {error_count} 条")
    print(f"  📝 总计: {len(updates)} 条")
    print("="*50)


if __name__ == "__main__":
    csv_file = "logs/2.csv"

    print("="*50)
    print("🔄 批量更新采购价格")
    print(f"📁 CSV 文件: {csv_file}")
    print("="*50)

    update_purchase_prices_from_csv(csv_file)
