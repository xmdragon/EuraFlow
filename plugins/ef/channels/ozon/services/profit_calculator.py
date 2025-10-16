"""
利润计算工具函数
"""
from decimal import Decimal
import logging
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.orders import OzonPosting, OzonOrder

logger = logging.getLogger(__name__)


async def calculate_and_update_profit(
    session: AsyncSession,
    posting: OzonPosting
) -> None:
    """
    计算并更新利润字段

    利润 = 订单金额 - (进货价格 + Ozon佣金 + 国际物流费 + 尾程派送费 + 打包费用)
    利润率 = (利润 / 订单金额) * 100

    Args:
        session: 数据库会话
        posting: 货件对象
    """
    try:
        # 查询关联的订单
        order_result = await session.execute(
            select(OzonOrder).where(OzonOrder.id == posting.order_id)
        )
        order = order_result.scalar_one_or_none()

        if not order:
            logger.warning(f"Order not found for posting {posting.id}")
            return

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

        # 5. 更新posting记录
        posting.profit = profit.quantize(Decimal('0.01'))
        posting.profit_rate = profit_rate

        logger.info(
            f"Calculated profit for posting {posting.id}: "
            f"order_amount={order_amount}, total_cost={total_cost}, "
            f"profit={posting.profit}, profit_rate={posting.profit_rate}%"
        )

    except Exception as e:
        logger.error(f"Error calculating profit for posting {posting.id}: {e}", exc_info=True)
