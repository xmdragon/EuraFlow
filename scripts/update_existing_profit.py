#!/usr/bin/env python3
"""
临时脚本：计算并更新现有OzonPosting记录的利润字段

使用方法：
    python scripts/update_existing_profit.py

说明：
    该脚本会遍历所有OzonPosting记录，根据订单金额和各项费用计算利润和利润率，
    并更新到数据库中的profit和profit_rate字段。

计算公式：
    利润 = 订单金额 - (进货价格 + Ozon佣金 + 国际物流费 + 尾程派送费 + 打包费用)
    利润率 = (利润 / 订单金额) * 100
"""

import asyncio
import sys
from pathlib import Path
from decimal import Decimal
from datetime import datetime, timezone

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting, OzonOrder


async def calculate_profit_for_posting(
    posting: OzonPosting,
    order: OzonOrder
) -> tuple[Decimal, Decimal]:
    """
    计算单个posting的利润和利润率

    Args:
        posting: 货件对象
        order: 订单对象

    Returns:
        (profit, profit_rate) 元组
    """
    # 1. 获取订单金额（CNY）
    order_amount = order.total_price or Decimal('0')

    # 2. 获取各项费用（CNY）
    purchase_price = posting.purchase_price or Decimal('0')
    ozon_commission = posting.ozon_commission_cny or Decimal('0')
    international_logistics = posting.international_logistics_fee_cny or Decimal('0')
    last_mile_delivery = posting.last_mile_delivery_fee_cny or Decimal('0')
    material_cost = posting.material_cost or Decimal('0')

    # 3. 计算利润
    total_cost = purchase_price + ozon_commission + international_logistics + last_mile_delivery + material_cost
    profit = order_amount - total_cost

    # 4. 计算利润率
    if order_amount > 0:
        profit_rate = (profit / order_amount * 100).quantize(Decimal('0.0001'))
    else:
        profit_rate = Decimal('0')

    # 5. 保留精度
    profit = profit.quantize(Decimal('0.01'))

    return profit, profit_rate


async def update_all_profits():
    """更新所有OzonPosting记录的利润字段"""

    print("=" * 80)
    print("开始计算并更新现有OzonPosting记录的利润字段")
    print("=" * 80)
    print()

    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 1. 查询所有posting及其关联的order
        print("正在查询所有OzonPosting记录...")
        query = select(OzonPosting, OzonOrder).join(
            OzonOrder, OzonPosting.order_id == OzonOrder.id
        ).order_by(OzonPosting.id)

        result = await session.execute(query)
        posting_order_pairs = result.all()

        total_count = len(posting_order_pairs)
        print(f"共找到 {total_count} 条记录需要处理\n")

        if total_count == 0:
            print("没有记录需要更新")
            return

        # 2. 统计变量
        updated_count = 0
        skipped_count = 0
        error_count = 0
        batch_size = 100
        batch_count = 0

        # 3. 遍历并更新
        for index, (posting, order) in enumerate(posting_order_pairs, 1):
            try:
                # 计算利润
                profit, profit_rate = await calculate_profit_for_posting(posting, order)

                # 更新posting
                posting.profit = profit
                posting.profit_rate = profit_rate

                updated_count += 1

                # 每100条打印一次进度
                if index % 100 == 0:
                    print(f"进度: {index}/{total_count} ({index*100//total_count}%)")

                # 每100条提交一次
                if index % batch_size == 0:
                    await session.commit()
                    batch_count += 1
                    print(f"  → 已提交批次 #{batch_count} ({batch_size} 条记录)")

            except Exception as e:
                error_count += 1
                print(f"  ✗ 处理posting {posting.id} 时出错: {str(e)}")
                continue

        # 4. 提交最后一批
        if updated_count % batch_size != 0:
            await session.commit()
            batch_count += 1
            print(f"  → 已提交最后批次 #{batch_count} ({updated_count % batch_size} 条记录)")

        print()
        print("=" * 80)
        print("更新完成！")
        print("=" * 80)
        print(f"总记录数: {total_count}")
        print(f"成功更新: {updated_count}")
        print(f"跳过记录: {skipped_count}")
        print(f"错误记录: {error_count}")
        print(f"提交批次: {batch_count}")
        print()


async def main():
    """主函数"""
    try:
        await update_all_profits()
    except KeyboardInterrupt:
        print("\n\n程序被用户中断")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n发生错误: {str(e)}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
