"""
利润计算工具函数
"""
from decimal import Decimal
import logging

from ..models.orders import OzonPosting

logger = logging.getLogger(__name__)


def calculate_and_update_profit(posting: OzonPosting) -> None:
    """
    计算并更新利润字段（同步方法，不需要 session）

    利润 = 订单金额 - (进货价格 + Ozon佣金 + 国际物流费 + 尾程派送费 + 打包费用)
    利润率 = (利润 / 订单金额) * 100

    Args:
        posting: 货件对象
    """
    try:
        # 1. 获取订单金额（CNY）- 使用 posting.order_total_price
        order_amount = posting.order_total_price or Decimal('0')

        # 取消订单不计销售额
        if posting.status == 'cancelled':
            order_amount = Decimal('0')

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
        if posting.status == 'cancelled':
            profit_rate = Decimal('0')
        elif order_amount > 0:
            profit_rate = (profit / order_amount * 100).quantize(Decimal('0.0001'))
        else:
            profit_rate = Decimal('0')

        # 5. 更新posting记录
        posting.profit = profit.quantize(Decimal('0.01'))
        posting.profit_rate = profit_rate

        logger.debug(
            f"Calculated profit for posting {posting.id}: "
            f"order_amount={order_amount}, total_cost={total_cost}, "
            f"profit={posting.profit}, profit_rate={posting.profit_rate}%"
        )

    except Exception as e:
        logger.error(f"Error calculating profit for posting {posting.id}: {e}", exc_info=True)
