"""
临时脚本：从CSV导入货件的进货价格和国内单号
路径：/mnt/e/pics/10.csv

功能：
1. 根据货件编号（posting_number）更新进货价格
2. 添加国内物流单号（支持单元格内多个单号，用逗号等分隔符分隔）

更新规则：
- 进货价格：CSV有值且非0才更新；CSV为空或0则保留数据库值
- 国内单号：解析所有单号并添加到关联表（去重，保留现有）
"""
import asyncio
import csv
import re
from decimal import Decimal, InvalidOperation
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import select
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting, OzonDomesticTracking


def parse_tracking_numbers(tracking_str: str) -> list[str]:
    """
    解析国内单号字段，支持多种分隔符

    支持的分隔符：逗号、分号、空格、换行符、制表符

    Args:
        tracking_str: 单号字符串（可能包含多个单号）

    Returns:
        单号列表（去重、去空、去空格）
    """
    if not tracking_str or not tracking_str.strip():
        return []

    # 使用正则表达式分割（支持逗号、分号、空格、换行符、制表符等）
    # 分隔符模式：一个或多个逗号、分号、空格、换行符、制表符
    parts = re.split(r'[,;，；\s\n\r\t]+', tracking_str.strip())

    # 清理每个单号（去空格、去空值）
    cleaned = [p.strip() for p in parts if p.strip()]

    # 去重（保持顺序）
    seen = set()
    result = []
    for num in cleaned:
        if num not in seen:
            seen.add(num)
            result.append(num)

    return result


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


async def import_posting_data():
    """导入CSV数据"""
    csv_path = "/mnt/e/pics/10.csv"

    # 检查文件是否存在
    if not Path(csv_path).exists():
        print(f"❌ CSV文件不存在: {csv_path}")
        return

    # 统计数据
    stats = {
        "total_rows": 0,
        "updated_price": 0,
        "skipped_price": 0,
        "added_tracking": 0,
        "existing_tracking": 0,
        "not_found": 0,
        "errors": 0,
    }

    print(f"开始导入CSV数据: {csv_path}")
    print("=" * 80)

    db_manager = get_db_manager()
    async with db_manager.get_session() as db:
        try:
            with open(csv_path, "r", encoding="utf-8") as f:
                reader = csv.reader(f)
                next(reader)  # 跳过表头

                for row_num, row in enumerate(reader, start=2):  # 从第2行开始（第1行是表头）
                    if len(row) < 3:
                        print(f"⚠️  第{row_num}行：列数不足，跳过")
                        continue

                    posting_number = row[0].strip()
                    price_str = row[1].strip()
                    tracking_str = row[2].strip()

                    if not posting_number:
                        print(f"⚠️  第{row_num}行：货件编号为空，跳过")
                        continue

                    stats["total_rows"] += 1

                    # 查询posting
                    result = await db.execute(
                        select(OzonPosting).where(OzonPosting.posting_number == posting_number)
                    )
                    posting = result.scalar_one_or_none()

                    if not posting:
                        print(f"❌ 第{row_num}行：货件未找到 {posting_number}")
                        stats["not_found"] += 1
                        continue

                    print(f"\n处理货件: {posting_number} (第{row_num}行)")

                    # 1. 更新进货价格
                    try:
                        if price_str and price_str not in ("0", "0.0", "0.00"):
                            new_price = Decimal(price_str)
                            if posting.purchase_price != new_price:
                                old_price = posting.purchase_price
                                posting.purchase_price = new_price
                                posting.purchase_price_updated_at = utcnow()
                                stats["updated_price"] += 1
                                print(f"  ✓ 更新进货价格: {old_price} → {new_price}")
                            else:
                                print(f"  → 进货价格无变化: {new_price}")
                        else:
                            # CSV为空或0，保留数据库值
                            if posting.purchase_price:
                                print(f"  → 保留现有价格: {posting.purchase_price} (CSV为空或0)")
                            else:
                                print(f"  → 价格为空 (CSV和数据库都为空)")
                            stats["skipped_price"] += 1
                    except (ValueError, InvalidOperation) as e:
                        print(f"  ❌ 价格格式错误: {price_str} - {e}")
                        stats["errors"] += 1

                    # 2. 添加国内单号
                    tracking_numbers = parse_tracking_numbers(tracking_str)
                    if tracking_numbers:
                        print(f"  解析到 {len(tracking_numbers)} 个单号: {', '.join(tracking_numbers)}")

                        for tracking_number in tracking_numbers:
                            # 检查是否已存在
                            existing = await db.execute(
                                select(OzonDomesticTracking).where(
                                    OzonDomesticTracking.posting_id == posting.id,
                                    OzonDomesticTracking.tracking_number == tracking_number
                                )
                            )
                            if not existing.scalar_one_or_none():
                                new_tracking = OzonDomesticTracking(
                                    posting_id=posting.id,
                                    tracking_number=tracking_number
                                )
                                db.add(new_tracking)
                                stats["added_tracking"] += 1
                                print(f"    ✓ 添加单号: {tracking_number}")
                            else:
                                stats["existing_tracking"] += 1
                                print(f"    → 单号已存在: {tracking_number}")
                    else:
                        print(f"  → 无单号 (CSV为空)")

            # 提交事务
            await db.commit()
            print("\n" + "=" * 80)
            print("✅ 事务提交成功")

        except Exception as e:
            print(f"\n❌ 发生错误，事务回滚: {e}")
            await db.rollback()
            raise

    # 打印统计
    print("\n" + "=" * 80)
    print("📊 导入完成统计")
    print("=" * 80)
    print(f"总行数:           {stats['total_rows']}")
    print(f"更新进货价格:     {stats['updated_price']}")
    print(f"跳过价格更新:     {stats['skipped_price']}")
    print(f"添加国内单号:     {stats['added_tracking']}")
    print(f"单号已存在:       {stats['existing_tracking']}")
    print(f"未找到货件:       {stats['not_found']}")
    print(f"错误数量:         {stats['errors']}")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(import_posting_data())
