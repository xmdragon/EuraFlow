#!/usr/bin/env python3
"""
查询订单财务交易明细
"""
import asyncio
import sys
import json
from pathlib import Path
from decimal import Decimal

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonShop
from plugins.ef.channels.ozon.api.client import OzonAPIClient
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def format_amount(amount):
    """格式化金额"""
    if amount is None:
        return "N/A"
    return f"{amount:,.2f} ₽"


async def query_transactions(posting_number: str):
    """查询指定订单的财务交易明细"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 根据posting_number找到对应的店铺
        from plugins.ef.channels.ozon.models.orders import OzonPosting

        posting_result = await db.execute(
            select(OzonPosting).where(OzonPosting.posting_number == posting_number)
        )
        posting_obj = posting_result.scalar_one_or_none()

        if posting_obj:
            # 使用posting对应的店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.id == posting_obj.shop_id)
            )
            shop = result.scalar_one_or_none()
        else:
            # 如果posting不存在，使用第一个店铺
            print(f"⚠️  订单 {posting_number} 不存在于数据库，使用默认店铺查询")
            result = await db.execute(select(OzonShop).limit(1))
            shop = result.scalar_one_or_none()

        if not shop:
            print("❌ 没有找到店铺配置")
            return

        print(f"🏪 使用店铺: {shop.shop_name} (ID: {shop.id})")
        print(f"📦 查询订单: {posting_number}\n")

        # 创建API客户端
        async with OzonAPIClient(shop.client_id, shop.api_key_enc) as client:
            try:
                # 调用财务交易明细API
                print("🔄 正在查询财务交易明细...")
                response = await client.get_finance_transaction_list(
                    posting_number=posting_number,
                    transaction_type="all",
                    page=1,
                    page_size=1000
                )

                result = response.get("result", {})
                operations = result.get("operations", [])
                page_count = result.get("page_count", 0)
                row_count = result.get("row_count", 0)

                print(f"✅ 查询成功")
                print(f"📊 总计 {row_count} 条交易记录，共 {page_count} 页\n")

                if not operations:
                    print("⚠️  该订单暂无财务交易记录")
                    return

                # 按日期分组显示
                print("=" * 80)
                print(f"财务交易明细 - {posting_number}")
                print("=" * 80)

                # 统计总额
                total_amount = Decimal('0')

                for idx, op in enumerate(operations, 1):
                    amount = Decimal(str(op.get("amount", 0)))
                    total_amount += amount

                    print(f"\n{idx}. {op.get('operation_type_name', op.get('operation_type', 'N/A'))}")
                    print(f"   操作ID: {op.get('operation_id')}")
                    print(f"   日期: {op.get('operation_date')}")
                    print(f"   金额: {format_amount(float(amount))} {'🔴' if amount < 0 else '🟢'}")

                    # 商品成本
                    accruals = op.get("accruals_for_sale", 0)
                    if accruals:
                        print(f"   商品成本: {format_amount(accruals)}")

                    # 运费
                    delivery = op.get("delivery_charge", 0)
                    if delivery:
                        print(f"   运费: {format_amount(delivery)}")

                    # 佣金
                    commission = op.get("sale_commission", 0)
                    if commission:
                        print(f"   销售佣金: {format_amount(commission)}")

                    # 退货费用
                    return_delivery = op.get("return_delivery_charge", 0)
                    if return_delivery:
                        print(f"   退货费用: {format_amount(return_delivery)}")

                    # 商品列表
                    items = op.get("items", [])
                    if items:
                        print(f"   商品:")
                        for item in items:
                            print(f"      • SKU: {item.get('sku')}, 数量: {item.get('quantity', 1)}")

                    # 服务费用
                    services = op.get("services", [])
                    if services:
                        print(f"   服务费用:")
                        for service in services:
                            svc_name = service.get("name", "未知服务")
                            svc_price = service.get("price", 0)
                            print(f"      • {svc_name}: {format_amount(svc_price)}")

                    # 发货信息
                    posting = op.get("posting", {})
                    if posting and posting.get("posting_number"):
                        delivery_schema = posting.get("delivery_schema", "N/A")
                        order_date = posting.get("order_date", "N/A")
                        print(f"   发货方案: {delivery_schema}")
                        print(f"   订单日期: {order_date}")

                print("\n" + "=" * 80)
                print(f"总金额: {format_amount(float(total_amount))} {'(支出)' if total_amount < 0 else '(收入)'}")
                print("=" * 80)

                # 保存详细数据到JSON文件（可选）
                output_file = project_root / f"transaction_details_{posting_number}.json"
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(response, f, ensure_ascii=False, indent=2, default=str)
                print(f"\n💾 详细数据已保存到: {output_file}")

            except Exception as e:
                print(f"❌ 查询失败: {e}")
                import traceback
                traceback.print_exc()


if __name__ == "__main__":
    # 默认查询的posting_number
    posting_number = sys.argv[1] if len(sys.argv) > 1 else "97129356-0045-1"
    asyncio.run(query_transactions(posting_number))
