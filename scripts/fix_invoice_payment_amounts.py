#!/usr/bin/env python3
"""
修复账单付款金额数据

从 raw_data 中重新解析金额，修正因解析错误导致的 0 值
"""
import asyncio
from decimal import Decimal
from sqlalchemy import select, update

# 添加项目路径
import sys
sys.path.insert(0, '/opt/euraflow')

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.finance import OzonInvoicePayment


def parse_amount_cny(amount_str: str) -> Decimal:
    """
    解析金额字符串，支持俄罗斯/欧洲格式
    例如: "11 676,27 ¥" -> Decimal("11676.27")
    """
    if not amount_str:
        return Decimal("0")

    # 1. 移除货币符号和空格（包括普通空格和非断行空格 U+00A0）
    cleaned = amount_str.replace("¥", "").replace("₽", "").replace(" ", "").replace("\u00a0", "").strip()

    # 2. 处理负数
    is_negative = False
    if cleaned.startswith("−") or cleaned.startswith("-"):
        is_negative = True
        cleaned = cleaned[1:]

    # 3. 处理小数分隔符
    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")

    # 4. 解析
    try:
        result = Decimal(cleaned)
        return -result if is_negative else result
    except Exception:
        return Decimal("0")


async def fix_amounts():
    """修复所有金额为 0 的记录"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 查询所有记录
        result = await db.execute(
            select(OzonInvoicePayment).where(OzonInvoicePayment.amount_cny == 0)
        )
        records = result.scalars().all()

        print(f"Found {len(records)} records with amount_cny = 0")

        fixed_count = 0
        for record in records:
            if record.raw_data and 'original' in record.raw_data:
                orig_amount = record.raw_data['original'].get('amount_cny', '')
                new_amount = parse_amount_cny(orig_amount)

                if new_amount != 0:
                    print(f"  ID {record.id}: '{orig_amount}' -> {new_amount}")
                    record.amount_cny = new_amount
                    fixed_count += 1
                else:
                    print(f"  ID {record.id}: '{orig_amount}' -> STILL 0 (parse failed)")

        await db.commit()
        print(f"\nFixed {fixed_count} records")


if __name__ == "__main__":
    asyncio.run(fix_amounts())
