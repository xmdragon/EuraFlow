"""
订单报表 API路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, case
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone
from decimal import Decimal
import logging
import calendar

from ef_core.database import get_async_session
from ..models import OzonPosting, OzonProduct, OzonShop, OzonGlobalSetting
from ..utils.datetime_utils import utcnow, get_global_timezone

router = APIRouter(tags=["ozon-reports"])
logger = logging.getLogger(__name__)


@router.get("/reports/orders")
async def get_order_report(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取订单报表数据

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔（不传则查询所有店铺）

    Returns:
        包含统计汇总和详细订单数据的报表
    """
    from sqlalchemy import and_, extract, or_
    from decimal import Decimal
    import calendar

    try:
        # 获取全局时区设置
        global_timezone = await get_global_timezone(db)
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(global_timezone)

        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算月份的开始和结束日期（基于用户时区）
        # 月初：用户时区的1号00:00:00
        start_date_tz = datetime(year, month_num, 1, 0, 0, 0, tzinfo=tz)
        # 月末：用户时区的最后一天23:59:59
        last_day = calendar.monthrange(year, month_num)[1]
        end_date_tz = datetime(year, month_num, last_day, 23, 59, 59, 999999, tzinfo=tz)

        # 转换为UTC用于数据库查询
        start_date = start_date_tz.astimezone(timezone.utc)
        end_date = end_date_tz.astimezone(timezone.utc)

        # 构建查询条件（使用 OzonPosting，避免 JOIN OzonOrder）
        conditions = [
            OzonPosting.created_at >= start_date,
            OzonPosting.created_at <= end_date,
            # 只查询已确认或已完成的订单状态
            OzonPosting.status.in_([
                'awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered'
            ])
        ]

        # 如果指定了店铺ID
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]
            conditions.append(OzonPosting.shop_id.in_(shop_id_list))

        # 查询 posting 数据（无需 JOIN OzonOrder）
        from sqlalchemy.orm import selectinload

        postings_query = select(
            OzonPosting,
            OzonShop.shop_name
        ).join(
            OzonShop, OzonPosting.shop_id == OzonShop.id
        ).where(and_(*conditions)).options(
            selectinload(OzonPosting.domestic_trackings)
        )

        result = await db.execute(postings_query)
        postings_with_shop = result.all()

        # 计算统计数据
        total_sales = Decimal('0')  # 销售总额
        total_purchase = Decimal('0')  # 进货总额
        total_cost = Decimal('0')  # 费用总额
        order_count = 0

        # 构建详细数据列表
        report_data = []

        for posting, shop_name in postings_with_shop:
            # 从 posting.raw_payload.products 获取商品列表
            products = []
            if posting.raw_payload and 'products' in posting.raw_payload:
                products = posting.raw_payload['products']

            # 从posting读取字段（posting维度）
            purchase_price = posting.purchase_price or Decimal('0')
            material_cost = posting.material_cost or Decimal('0')
            # 获取所有国内物流单号，用逗号分隔显示
            tracking_numbers = posting.get_domestic_tracking_numbers()
            domestic_tracking_number = ', '.join(tracking_numbers) if tracking_numbers else None
            order_notes = posting.order_notes
            posting_number = posting.posting_number
            # 从 raw_payload 获取追踪号
            tracking_number = posting.raw_payload.get('tracking_number') if posting.raw_payload else None

            for product in products:
                # 计算单个商品的价格
                item_price = Decimal(str(product.get('price', 0)))
                quantity = product.get('quantity', 1)
                sale_price = item_price * quantity

                # 计算利润
                profit = sale_price - purchase_price - material_cost

                # 累加统计数据
                total_sales += sale_price
                total_purchase += purchase_price
                total_cost += material_cost
                order_count += 1

                from ..utils.serialization import format_currency

                # 添加到详细数据
                report_data.append({
                    "date": posting.created_at.strftime("%Y-%m-%d"),
                    "shop_name": shop_name,
                    "product_name": product.get('name', product.get('sku', '未知商品')),
                    "posting_number": posting_number,
                    "purchase_price": format_currency(purchase_price),
                    "sale_price": format_currency(sale_price),
                    "tracking_number": tracking_number,
                    "domestic_tracking_number": domestic_tracking_number,
                    "material_cost": format_currency(material_cost),
                    "order_notes": order_notes,
                    "profit": format_currency(profit),
                    "sku": product.get('sku'),
                    "quantity": quantity,
                    "offer_id": product.get('offer_id')
                })

        # 计算利润总额和利润率
        total_profit = total_sales - total_purchase - total_cost
        profit_rate = (total_profit / total_sales * 100) if total_sales > 0 else Decimal('0')

        # 返回报表数据
        return {
            "summary": {
                "total_sales": str(total_sales),
                "total_purchase": str(total_purchase),
                "total_cost": str(total_cost),
                "total_profit": str(total_profit),
                "profit_rate": float(profit_rate),  # 百分比形式
                "order_count": order_count,
                "month": month
            },
            "data": report_data
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"无效的月份格式: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to get order report: {e}")
        raise HTTPException(status_code=500, detail=f"获取报表失败: {str(e)}")


@router.get("/reports/orders/export")
async def export_order_report(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    导出订单报表为Excel文件

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔

    Returns:
        Excel文件流
    """
    from fastapi.responses import StreamingResponse
    import pandas as pd
    from io import BytesIO

    try:
        # 获取报表数据
        report = await get_order_report(month, shop_ids, db)

        # 创建DataFrame
        df = pd.DataFrame(report["data"])

        if not df.empty:
            # 重命名列为中文
            df = df.rename(columns={
                "date": "日期",
                "shop_name": "店铺名称",
                "product_name": "商品名称",
                "posting_number": "货件编号",
                "purchase_price": "进货价格",
                "sale_price": "出售价格",
                "tracking_number": "国际运单号",
                "domestic_tracking_number": "国内运单号",
                "material_cost": "材料费用",
                "order_notes": "备注",
                "profit": "利润",
                "sku": "SKU",
                "quantity": "数量"
            })

            # 选择要导出的列
            export_columns = [
                "日期", "店铺名称", "商品名称", "货件编号",
                "进货价格", "出售价格", "国际运单号", "国内运单号",
                "材料费用", "备注", "利润"
            ]
            df = df[export_columns]

        # 创建Excel文件
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            # 写入数据表
            df.to_excel(writer, sheet_name='订单报表', index=False)

            # 获取工作表
            worksheet = writer.sheets['订单报表']

            # 添加统计汇总行（在表格底部）
            summary = report["summary"]
            last_row = len(df) + 3  # 空一行后添加统计

            worksheet.cell(row=last_row, column=1, value="统计汇总")
            worksheet.cell(row=last_row + 1, column=1, value="销售总额")
            worksheet.cell(row=last_row + 1, column=2, value=f"¥{summary['total_sales']}")
            worksheet.cell(row=last_row + 2, column=1, value="进货总额")
            worksheet.cell(row=last_row + 2, column=2, value=f"¥{summary['total_purchase']}")
            worksheet.cell(row=last_row + 3, column=1, value="费用总额")
            worksheet.cell(row=last_row + 3, column=2, value=f"¥{summary['total_cost']}")
            worksheet.cell(row=last_row + 4, column=1, value="利润总额")
            worksheet.cell(row=last_row + 4, column=2, value=f"¥{summary['total_profit']}")
            worksheet.cell(row=last_row + 5, column=1, value="利润率")
            worksheet.cell(row=last_row + 5, column=2, value=f"{summary['profit_rate']:.2f}%")
            worksheet.cell(row=last_row + 6, column=1, value="订单总数")
            worksheet.cell(row=last_row + 6, column=2, value=summary['order_count'])

            # 调整列宽
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except Exception:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width

        # 重置文件指针
        output.seek(0)

        # 返回文件流
        filename = f"ozon_order_report_{month}.xlsx"
        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )

    except Exception as e:
        logger.error(f"Failed to export order report: {e}")
        raise HTTPException(status_code=500, detail=f"导出报表失败: {str(e)}")


# Posting级别报表端点（新版 - 优化版，不加载 raw_payload）
@router.get("/reports/postings")
async def get_posting_report(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    status_filter: str = Query("delivered", description="状态过滤：delivered(已签收) 或 placed(已下订)"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=100, description="每页条数，最大100"),
    sort_by: Optional[str] = Query(None, description="排序字段：profit_rate"),
    sort_order: str = Query("desc", description="排序方向：asc或desc"),
    posting_number: Optional[str] = Query(None, description="货件编号（支持通配符%）"),
    no_commission: bool = Query(False, description="筛选无Ozon佣金的订单"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取Posting级别的订单报表数据（支持分页和排序）

    优化说明：
    - 不加载 raw_payload 字段（10-100KB/行）
    - 使用预计算的 order_total_price 字段
    - 使用 JSONB 函数获取 product_count
    - 商品详情通过单独的 /reports/postings/{posting_number} 端点获取

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔（不传则查询所有店铺）
        status_filter: 状态过滤 (delivered=已签收, placed=已下订包含多种状态)
        page: 页码（从1开始）
        page_size: 每页条数（默认50，最大100）

    Returns:
        包含posting列表、分页信息的报表数据（不含商品详情）
    """
    from sqlalchemy import and_, or_
    from sqlalchemy.orm import defer
    import calendar

    try:
        # 获取全局时区设置
        global_timezone = await get_global_timezone(db)
        from zoneinfo import ZoneInfo
        tz = ZoneInfo(global_timezone)

        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算月份的开始和结束日期（基于用户时区）
        start_date_tz = datetime(year, month_num, 1, 0, 0, 0, tzinfo=tz)
        last_day = calendar.monthrange(year, month_num)[1]
        end_date_tz = datetime(year, month_num, last_day, 23, 59, 59, 999999, tzinfo=tz)

        # 转换为UTC用于数据库查询
        start_date = start_date_tz.astimezone(timezone.utc)
        end_date = end_date_tz.astimezone(timezone.utc)

        # 构建查询条件（使用 in_process_at 替代 ordered_at，避免 JOIN）
        conditions = [
            OzonPosting.in_process_at >= start_date,
            OzonPosting.in_process_at <= end_date,
        ]

        # 状态过滤逻辑
        if status_filter == 'delivered':
            conditions.append(OzonPosting.status == 'delivered')
        elif status_filter == 'placed':
            conditions.append(OzonPosting.status.in_([
                'awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled'
            ]))
        else:
            raise HTTPException(status_code=400, detail=f"无效的status_filter: {status_filter}")

        # 如果指定了店铺ID（使用 OzonPosting.shop_id）
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]
            conditions.append(OzonPosting.shop_id.in_(shop_id_list))

        # 货件编号过滤（支持通配符）
        if posting_number:
            posting_number_value = posting_number.strip()
            if posting_number_value:
                if '%' in posting_number_value:
                    conditions.append(OzonPosting.posting_number.like(posting_number_value))
                else:
                    conditions.append(OzonPosting.posting_number == posting_number_value)

        # 无Ozon佣金过滤
        if no_commission:
            conditions.append(or_(
                OzonPosting.ozon_commission_cny == None,
                OzonPosting.ozon_commission_cny == 0
            ))

        # 查询总数（用于分页，无需 JOIN）
        count_query = select(func.count(OzonPosting.id)).where(and_(*conditions))

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # 计算分页
        offset = (page - 1) * page_size
        total_pages = (total + page_size - 1) // page_size

        # 确定排序字段和顺序（使用 in_process_at 替代 ordered_at）
        if sort_by == 'profit_rate':
            order_clause = OzonPosting.profit_rate.desc() if sort_order == 'desc' else OzonPosting.profit_rate.asc()
        else:
            order_clause = OzonPosting.in_process_at.desc()

        # 查询posting数据（无需 JOIN OzonOrder）
        product_count_expr = func.coalesce(
            func.jsonb_array_length(OzonPosting.raw_payload['products']),
            0
        ).label('product_count')

        postings_query = select(
            OzonPosting.id,
            OzonPosting.posting_number,
            OzonPosting.status,
            OzonPosting.in_process_at,
            OzonPosting.delivered_at,  # 签收日期
            OzonPosting.order_total_price,
            OzonPosting.purchase_price,
            OzonPosting.ozon_commission_cny,
            OzonPosting.international_logistics_fee_cny,
            OzonPosting.last_mile_delivery_fee_cny,
            OzonPosting.material_cost,
            OzonPosting.profit_rate,
            OzonPosting.in_process_at.label('ordered_at'),  # 兼容前端字段名
            OzonShop.shop_name,
            product_count_expr
        ).join(
            OzonShop, OzonPosting.shop_id == OzonShop.id
        ).where(
            and_(*conditions)
        ).order_by(
            order_clause
        ).offset(offset).limit(page_size)

        result = await db.execute(postings_query)
        postings_data = result.all()

        # 构建返回数据（不再需要批量查询图片）
        from ..utils.serialization import format_currency

        report_data = []
        for row in postings_data:
            # 使用预计算的 order_total_price
            real_order_amount = row.order_total_price or Decimal('0')

            # 计算订单金额（取消订单不计销售额）
            is_cancelled = row.status == 'cancelled'
            order_amount = Decimal('0') if is_cancelled else real_order_amount

            # 获取费用字段
            purchase_price = row.purchase_price or Decimal('0')
            ozon_commission = row.ozon_commission_cny or Decimal('0')
            intl_logistics = row.international_logistics_fee_cny or Decimal('0')
            last_mile = row.last_mile_delivery_fee_cny or Decimal('0')
            material_cost = row.material_cost or Decimal('0')

            # 计算利润
            profit = order_amount - (purchase_price + ozon_commission + intl_logistics + last_mile + material_cost)

            # 计算利润率
            if is_cancelled:
                profit_rate = 0.0
            else:
                profit_rate = float((profit / order_amount * 100)) if order_amount > 0 else 0.0

            report_data.append({
                'posting_number': row.posting_number,
                'shop_name': row.shop_name,
                'status': row.status,
                'is_cancelled': is_cancelled,
                'created_at': row.ordered_at.isoformat(),
                'in_process_at': row.in_process_at.isoformat() if row.in_process_at else None,
                'delivered_at': row.delivered_at.isoformat() if row.delivered_at else None,  # 签收日期
                'product_count': row.product_count,  # 商品数量（替代 products 数组）
                'order_amount': format_currency(real_order_amount),
                'purchase_price': format_currency(purchase_price),
                'ozon_commission_cny': format_currency(ozon_commission),
                'international_logistics_fee_cny': format_currency(intl_logistics),
                'last_mile_delivery_fee_cny': format_currency(last_mile),
                'material_cost': format_currency(material_cost),
                'profit': format_currency(profit),
                'profit_rate': round(profit_rate, 2)
            })

        # 返回分页数据
        return {
            "data": report_data,
            "total": total,
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"无效的月份格式: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to get posting report: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"获取报表失败: {str(e)}")


# 报表汇总端点（用于图表数据）- 优化版，使用 SQL 聚合
@router.get("/reports/summary")
async def get_report_summary(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    status_filter: str = Query("delivered", description="状态过滤：delivered(已签收) 或 placed(已下订)"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取报表汇总数据（用于图表展示）

    优化说明：
    - 使用 SQL SUM/COUNT 聚合代替 Python 循环
    - 使用预计算的 order_total_price 字段
    - 减少数据传输量

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔（不传则查询所有店铺）
        status_filter: 状态过滤 (delivered=已签收, placed=已下订)

    Returns:
        包含统计汇总、成本分解、店铺分布、每日趋势、TOP10商品的数据
    """
    from sqlalchemy import and_, or_, case, literal
    from sqlalchemy.dialects.postgresql import JSONB
    from sqlalchemy.sql import text
    import calendar
    from zoneinfo import ZoneInfo
    from datetime import timedelta

    try:
        # 获取全局时区设置
        global_timezone = await get_global_timezone(db)
        tz = ZoneInfo(global_timezone)

        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算当月的开始和结束日期
        start_date_tz = datetime(year, month_num, 1, 0, 0, 0, tzinfo=tz)
        last_day = calendar.monthrange(year, month_num)[1]
        end_date_tz = datetime(year, month_num, last_day, 23, 59, 59, 999999, tzinfo=tz)

        # 截止到昨天
        now_tz = datetime.now(tz)
        yesterday_tz = now_tz - timedelta(days=1)
        yesterday_end_tz = datetime(yesterday_tz.year, yesterday_tz.month, yesterday_tz.day, 23, 59, 59, 999999, tzinfo=tz)
        if end_date_tz > yesterday_end_tz:
            end_date_tz = yesterday_end_tz

        # 转换为UTC
        start_date = start_date_tz.astimezone(timezone.utc)
        end_date = end_date_tz.astimezone(timezone.utc)

        # 计算上月日期范围
        if month_num == 1:
            prev_year = year - 1
            prev_month = 12
        else:
            prev_year = year
            prev_month = month_num - 1

        prev_start_date_tz = datetime(prev_year, prev_month, 1, 0, 0, 0, tzinfo=tz)
        prev_last_day = calendar.monthrange(prev_year, prev_month)[1]
        prev_end_date_tz = datetime(prev_year, prev_month, prev_last_day, 23, 59, 59, 999999, tzinfo=tz)
        prev_start_date = prev_start_date_tz.astimezone(timezone.utc)
        prev_end_date = prev_end_date_tz.astimezone(timezone.utc)

        # 构建状态过滤条件
        if status_filter == 'delivered':
            status_conditions = [OzonPosting.status == 'delivered']
        elif status_filter == 'placed':
            status_conditions = [OzonPosting.status.in_([
                'awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled'
            ])]
        else:
            status_conditions = []

        # 店铺过滤
        shop_id_list = None
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]

        # ========== 1. 使用 SQL 聚合计算主要统计数据 ==========
        # 销售额使用 order_total_price，取消订单不计销售额
        sales_expr = case(
            (OzonPosting.status != 'cancelled', OzonPosting.order_total_price),
            else_=Decimal('0')
        )

        # 使用 in_process_at 替代 ordered_at，无需 JOIN OzonOrder
        conditions = [
            OzonPosting.in_process_at >= start_date,
            OzonPosting.in_process_at <= end_date,
        ] + status_conditions

        if shop_id_list:
            conditions.append(OzonPosting.shop_id.in_(shop_id_list))

        totals_query = select(
            func.count(OzonPosting.id).label('order_count'),
            func.coalesce(func.sum(sales_expr), Decimal('0')).label('total_sales'),
            func.coalesce(func.sum(OzonPosting.purchase_price), Decimal('0')).label('total_purchase'),
            func.coalesce(func.sum(OzonPosting.ozon_commission_cny), Decimal('0')).label('total_commission'),
            func.coalesce(func.sum(OzonPosting.international_logistics_fee_cny), Decimal('0')).label('total_intl_logistics'),
            func.coalesce(func.sum(OzonPosting.last_mile_delivery_fee_cny), Decimal('0')).label('total_last_mile'),
            func.coalesce(func.sum(OzonPosting.material_cost), Decimal('0')).label('total_material'),
        ).where(and_(*conditions))

        totals_result = await db.execute(totals_query)
        totals = totals_result.first()

        order_count = totals.order_count or 0
        total_sales = totals.total_sales or Decimal('0')
        total_purchase = totals.total_purchase or Decimal('0')
        total_commission = totals.total_commission or Decimal('0')
        total_intl_logistics = totals.total_intl_logistics or Decimal('0')
        total_last_mile = totals.total_last_mile or Decimal('0')
        total_material = totals.total_material or Decimal('0')

        # 计算利润
        total_profit = total_sales - (total_purchase + total_commission + total_intl_logistics + total_last_mile + total_material)
        profit_rate = float((total_profit / total_sales * 100)) if total_sales > 0 else 0.0

        # ========== 2. 上月统计（使用 SQL 聚合，无需 JOIN）==========
        prev_conditions = [
            OzonPosting.in_process_at >= prev_start_date,
            OzonPosting.in_process_at <= prev_end_date,
        ] + status_conditions

        if shop_id_list:
            prev_conditions.append(OzonPosting.shop_id.in_(shop_id_list))

        prev_totals_query = select(
            func.coalesce(func.sum(sales_expr), Decimal('0')).label('total_sales'),
            func.coalesce(func.sum(OzonPosting.purchase_price), Decimal('0')).label('total_purchase'),
            func.coalesce(func.sum(OzonPosting.ozon_commission_cny), Decimal('0')).label('total_commission'),
            func.coalesce(func.sum(OzonPosting.international_logistics_fee_cny), Decimal('0')).label('total_intl_logistics'),
            func.coalesce(func.sum(OzonPosting.last_mile_delivery_fee_cny), Decimal('0')).label('total_last_mile'),
            func.coalesce(func.sum(OzonPosting.material_cost), Decimal('0')).label('total_material'),
        ).where(and_(*prev_conditions))

        prev_totals_result = await db.execute(prev_totals_query)
        prev_totals = prev_totals_result.first()

        prev_total_sales = prev_totals.total_sales or Decimal('0')
        prev_total_purchase = prev_totals.total_purchase or Decimal('0')
        prev_total_commission = prev_totals.total_commission or Decimal('0')
        prev_total_intl_logistics = prev_totals.total_intl_logistics or Decimal('0')
        prev_total_last_mile = prev_totals.total_last_mile or Decimal('0')
        prev_total_material = prev_totals.total_material or Decimal('0')

        prev_total_profit = prev_total_sales - (prev_total_purchase + prev_total_commission + prev_total_intl_logistics + prev_total_last_mile + prev_total_material)
        prev_profit_rate = float((prev_total_profit / prev_total_sales * 100)) if prev_total_sales > 0 else 0.0

        # ========== 3. 店铺维度统计（使用 SQL GROUP BY）==========
        # 计算利润表达式
        profit_expr = sales_expr - (
            func.coalesce(OzonPosting.purchase_price, Decimal('0')) +
            func.coalesce(OzonPosting.ozon_commission_cny, Decimal('0')) +
            func.coalesce(OzonPosting.international_logistics_fee_cny, Decimal('0')) +
            func.coalesce(OzonPosting.last_mile_delivery_fee_cny, Decimal('0')) +
            func.coalesce(OzonPosting.material_cost, Decimal('0'))
        )

        shop_query = select(
            OzonShop.shop_name,
            func.coalesce(func.sum(sales_expr), Decimal('0')).label('sales'),
            func.coalesce(func.sum(profit_expr), Decimal('0')).label('profit'),
        ).select_from(OzonPosting).join(
            OzonShop, OzonPosting.shop_id == OzonShop.id
        ).where(
            and_(*conditions)
        ).group_by(OzonShop.shop_name)

        shop_result = await db.execute(shop_query)
        shop_breakdown = [
            {
                "shop_name": row.shop_name,
                "sales": float(row.sales),
                "profit": float(row.profit)
            }
            for row in shop_result.all()
        ]

        # ========== 4. 每日趋势统计（使用 SQL GROUP BY，无需 JOIN）==========
        # 使用 in_process_at 替代 ordered_at
        date_expr = func.date(OzonPosting.in_process_at.op('AT TIME ZONE')('UTC').op('AT TIME ZONE')(global_timezone))
        daily_query = select(
            date_expr.label('date'),
            func.coalesce(func.sum(sales_expr), Decimal('0')).label('sales'),
            func.coalesce(func.sum(profit_expr), Decimal('0')).label('profit'),
        ).select_from(OzonPosting).where(
            and_(*conditions)
        ).group_by(
            date_expr
        ).order_by(
            date_expr
        )

        daily_result = await db.execute(daily_query)
        daily_trend = [
            {
                "date": str(row.date),
                "sales": float(row.sales),
                "profit": float(row.profit)
            }
            for row in daily_result.all()
        ]

        # ========== 5. TOP10 商品统计（需要解析 raw_payload）==========
        # 这部分仍需要 Python 处理，但只查询必要字段
        # 使用 PostgreSQL jsonb_array_elements 展开商品数组，在数据库层面聚合
        # 注意：shop_ids 需要显式转换为 integer[] 类型，避免 NULL 时 asyncpg 无法推断类型
        top_products_sql = text("""
            WITH product_data AS (
                SELECT
                    p.status,
                    p.order_total_price,
                    p.purchase_price,
                    p.ozon_commission_cny,
                    p.international_logistics_fee_cny,
                    p.last_mile_delivery_fee_cny,
                    p.material_cost,
                    jsonb_array_elements(p.raw_payload->'products') as product
                FROM ozon_postings p
                WHERE p.in_process_at >= :start_date
                  AND p.in_process_at <= :end_date
                  AND p.status = ANY(:statuses)
                  AND (CAST(:shop_ids AS integer[]) IS NULL OR p.shop_id = ANY(CAST(:shop_ids AS integer[])))
            ),
            aggregated AS (
                SELECT
                    product->>'offer_id' as offer_id,
                    product->>'name' as name,
                    product->>'sku' as sku,
                    SUM(CASE WHEN status != 'cancelled'
                        THEN (product->>'price')::numeric * (product->>'quantity')::int
                        ELSE 0 END) as sales,
                    SUM((product->>'quantity')::int) as quantity
                FROM product_data
                WHERE product->>'offer_id' IS NOT NULL
                GROUP BY product->>'offer_id', product->>'name', product->>'sku'
            )
            SELECT offer_id, name, sku, sales, quantity
            FROM aggregated
            ORDER BY sales DESC
            LIMIT 10
        """)

        # 确定状态列表
        if status_filter == 'delivered':
            statuses = ['delivered']
        else:
            statuses = ['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled']

        top_sales_result = await db.execute(
            top_products_sql,
            {
                "start_date": start_date,
                "end_date": end_date,
                "statuses": statuses,
                "shop_ids": shop_id_list
            }
        )
        top_products_by_sales_raw = top_sales_result.fetchall()

        # 按销量排序的 TOP10（无需 JOIN ozon_orders）
        top_quantity_sql = text("""
            WITH product_data AS (
                SELECT
                    p.status,
                    jsonb_array_elements(p.raw_payload->'products') as product
                FROM ozon_postings p
                WHERE p.in_process_at >= :start_date
                  AND p.in_process_at <= :end_date
                  AND p.status = ANY(:statuses)
                  AND (CAST(:shop_ids AS integer[]) IS NULL OR p.shop_id = ANY(CAST(:shop_ids AS integer[])))
            ),
            aggregated AS (
                SELECT
                    product->>'offer_id' as offer_id,
                    product->>'name' as name,
                    product->>'sku' as sku,
                    SUM(CASE WHEN status != 'cancelled'
                        THEN (product->>'price')::numeric * (product->>'quantity')::int
                        ELSE 0 END) as sales,
                    SUM((product->>'quantity')::int) as quantity
                FROM product_data
                WHERE product->>'offer_id' IS NOT NULL
                GROUP BY product->>'offer_id', product->>'name', product->>'sku'
            )
            SELECT offer_id, name, sku, sales, quantity
            FROM aggregated
            ORDER BY quantity DESC
            LIMIT 10
        """)

        top_quantity_result = await db.execute(
            top_quantity_sql,
            {
                "start_date": start_date,
                "end_date": end_date,
                "statuses": statuses,
                "shop_ids": shop_id_list
            }
        )
        top_products_by_quantity_raw = top_quantity_result.fetchall()

        # 收集所有 offer_id 用于批量查询图片
        top_offer_ids = set()
        for row in top_products_by_sales_raw:
            if row.offer_id:
                top_offer_ids.add(row.offer_id)
        for row in top_products_by_quantity_raw:
            if row.offer_id:
                top_offer_ids.add(row.offer_id)

        # 批量查询 TOP10 商品的图片
        offer_id_images = {}
        if top_offer_ids:
            product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
                OzonProduct.offer_id.in_(list(top_offer_ids))
            )
            products_result = await db.execute(product_query)
            for offer_id, images in products_result:
                if offer_id and images:
                    image_url = None
                    if isinstance(images, dict):
                        if images.get("primary"):
                            image_url = images["primary"]
                        elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                            image_url = images["main"][0]
                    elif isinstance(images, list) and images:
                        image_url = images[0]
                    if image_url:
                        offer_id_images[offer_id] = image_url

        # 构建 TOP10 返回数据
        top_products_by_sales = [
            {
                "offer_id": row.offer_id,
                "name": row.name or '',
                "sku": row.sku or '',
                "sales": float(row.sales or 0),
                "quantity": int(row.quantity or 0),
                "profit": 0.0,  # 简化：利润需要复杂计算，暂不在 TOP10 中展示
                "image_url": offer_id_images.get(row.offer_id)
            }
            for row in top_products_by_sales_raw
        ]

        top_products_by_quantity = [
            {
                "offer_id": row.offer_id,
                "name": row.name or '',
                "sku": row.sku or '',
                "sales": float(row.sales or 0),
                "quantity": int(row.quantity or 0),
                "profit": 0.0,
                "image_url": offer_id_images.get(row.offer_id)
            }
            for row in top_products_by_quantity_raw
        ]

        # ========== 6. 构建成本分解数据 ==========
        from ..utils.serialization import format_currency

        cost_breakdown = [
            {"name": "进货金额", "value": float(total_purchase)},
            {"name": "Ozon佣金", "value": float(total_commission)},
            {"name": "国际物流", "value": float(total_intl_logistics)},
            {"name": "尾程派送", "value": float(total_last_mile)},
            {"name": "打包费用", "value": float(total_material)}
        ]
        if total_profit > 0:
            cost_breakdown.append({"name": "利润", "value": float(total_profit)})

        # 返回汇总数据
        return {
            "statistics": {
                "total_sales": format_currency(total_sales),
                "total_purchase": format_currency(total_purchase),
                "total_commission": format_currency(total_commission),
                "total_logistics": format_currency(total_intl_logistics + total_last_mile),
                "total_cost": format_currency(total_material),
                "total_profit": format_currency(total_profit),
                "profit_rate": round(profit_rate, 2),
                "order_count": order_count
            },
            "cost_breakdown": cost_breakdown,
            "shop_breakdown": shop_breakdown,
            "daily_trend": daily_trend,
            "previous_month": {
                "total_sales": format_currency(prev_total_sales),
                "total_profit": format_currency(prev_total_profit),
                "profit_rate": round(prev_profit_rate, 2)
            },
            "top_products_by_sales": top_products_by_sales,
            "top_products_by_quantity": top_products_by_quantity
        }

    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"无效的月份格式: {str(e)}")
    except Exception as e:
        logger.error(f"Failed to get report summary: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"获取报表汇总失败: {str(e)}")


@router.post("/reports/batch-sync-finance")
async def start_batch_finance_sync():
    """
    启动批量财务费用同步任务

    查询所有已签收但 OZON 佣金为 0 的订单，调用财务交易 API 同步费用

    Returns:
        任务ID，用于查询进度
    """
    try:
        import redis
        from ..tasks.batch_finance_sync_task import batch_finance_sync_task

        # 使用 Redis 锁防止并发启动
        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)
        lock_key = "batch_finance_sync:lock"

        # 尝试获取锁（5分钟过期）
        if not redis_client.set(lock_key, "1", ex=300, nx=True):
            # 锁已存在，说明有任务正在运行
            raise HTTPException(status_code=409, detail="批量同步任务已在运行中，请稍后再试")

        # 启动异步任务
        task = batch_finance_sync_task.delay()

        logger.info(f"Started batch finance sync task: {task.id}")

        return {
            "task_id": task.id,
            "message": "批量同步任务已启动"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start batch finance sync: {e}")
        # 发生错误时释放锁
        try:
            redis_client.delete(lock_key)
        except:
            pass
        raise HTTPException(status_code=500, detail=f"启动批量同步失败: {str(e)}")


@router.get("/reports/batch-sync-finance/{task_id}")
async def get_batch_finance_sync_progress(task_id: str):
    """
    查询批量财务同步任务进度

    Args:
        task_id: 任务ID

    Returns:
        任务进度信息
    """
    try:
        import redis
        import ast

        redis_client = redis.Redis(host='localhost', port=6379, db=0, decode_responses=True)

        # 从 Redis 读取进度
        key = f"batch_finance_sync:{task_id}"
        progress_str = redis_client.get(key)

        if not progress_str:
            # 检查任务状态
            from celery.result import AsyncResult
            task_result = AsyncResult(task_id)

            if task_result.state == 'PENDING':
                return {
                    "status": "pending",
                    "message": "任务正在队列中等待..."
                }
            elif task_result.state == 'FAILURE':
                return {
                    "status": "failed",
                    "message": f"任务失败: {str(task_result.info)}"
                }
            else:
                return {
                    "status": "unknown",
                    "message": "未找到任务进度信息"
                }

        # 解析进度信息
        progress = ast.literal_eval(progress_str)

        return progress

    except Exception as e:
        logger.error(f"Failed to get batch finance sync progress: {e}")
        raise HTTPException(status_code=500, detail=f"获取任务进度失败: {str(e)}")


@router.get("/reports/postings/{posting_number}")
async def get_posting_detail(
    posting_number: str,
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取单个货件详情（含商品信息）

    用于在列表中点击货件编号时查看完整商品信息。
    此端点会加载 raw_payload 以获取商品详情。

    Args:
        posting_number: 货件编号

    Returns:
        货件详情，包含商品列表、费用明细等
    """
    from sqlalchemy.orm import selectinload
    from ..utils.serialization import format_currency

    try:
        # 查询 posting 及关联数据（无需 JOIN OzonOrder）
        query = select(
            OzonPosting,
            OzonShop.shop_name
        ).join(
            OzonShop, OzonPosting.shop_id == OzonShop.id
        ).where(
            OzonPosting.posting_number == posting_number
        )

        result = await db.execute(query)
        row = result.first()

        if not row:
            raise HTTPException(status_code=404, detail=f"货件 {posting_number} 不存在")

        posting, shop_name = row

        # 从 raw_payload 提取商品列表
        products_list = []
        all_offer_ids = set()

        if posting.raw_payload and 'products' in posting.raw_payload:
            for product_raw in posting.raw_payload['products']:
                offer_id = product_raw.get('offer_id')
                if offer_id:
                    all_offer_ids.add(offer_id)

                products_list.append({
                    'sku': str(product_raw.get('sku', '')),
                    'offer_id': str(offer_id) if offer_id else None,
                    'name': product_raw.get('name', ''),
                    'quantity': product_raw.get('quantity', 0),
                    'price': format_currency(Decimal(str(product_raw.get('price', '0')))),
                    'image_url': None  # 稍后填充
                })

        # 批量查询商品图片
        if all_offer_ids:
            product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
                OzonProduct.offer_id.in_(list(all_offer_ids))
            )
            products_result = await db.execute(product_query)
            offer_id_images = {}
            for offer_id, images in products_result:
                if offer_id and images:
                    image_url = None
                    if isinstance(images, dict):
                        if images.get("primary"):
                            image_url = images["primary"]
                        elif images.get("main") and isinstance(images["main"], list) and images["main"]:
                            image_url = images["main"][0]
                    elif isinstance(images, list) and images:
                        image_url = images[0]
                    if image_url:
                        offer_id_images[offer_id] = image_url

            # 填充图片 URL
            for product in products_list:
                if product['offer_id']:
                    product['image_url'] = offer_id_images.get(product['offer_id'])

        # 计算订单金额
        real_order_amount = Decimal('0')
        if posting.raw_payload and 'products' in posting.raw_payload:
            for product_raw in posting.raw_payload['products']:
                product_price = Decimal(str(product_raw.get('price', '0')))
                product_quantity = int(product_raw.get('quantity', 0))
                real_order_amount += product_price * product_quantity

        # 取消订单不计销售额
        order_amount = Decimal('0') if posting.status == 'cancelled' else real_order_amount

        # 费用字段
        purchase_price = posting.purchase_price or Decimal('0')
        ozon_commission = posting.ozon_commission_cny or Decimal('0')
        intl_logistics = posting.international_logistics_fee_cny or Decimal('0')
        last_mile = posting.last_mile_delivery_fee_cny or Decimal('0')
        material_cost = posting.material_cost or Decimal('0')

        # 计算利润
        profit = order_amount - (purchase_price + ozon_commission + intl_logistics + last_mile + material_cost)
        profit_rate = float((profit / order_amount * 100)) if order_amount > 0 else 0.0

        return {
            'posting_number': posting.posting_number,
            'shop_name': shop_name,
            'status': posting.status,
            'is_cancelled': posting.status == 'cancelled',
            'created_at': posting.in_process_at.isoformat() if posting.in_process_at else None,
            'in_process_at': posting.in_process_at.isoformat() if posting.in_process_at else None,
            'shipped_at': posting.shipped_at.isoformat() if posting.shipped_at else None,
            'delivered_at': posting.delivered_at.isoformat() if posting.delivered_at else None,
            'products': products_list,
            'product_count': len(products_list),
            'order_amount': format_currency(real_order_amount),
            'purchase_price': format_currency(purchase_price),
            'ozon_commission_cny': format_currency(ozon_commission),
            'international_logistics_fee_cny': format_currency(intl_logistics),
            'last_mile_delivery_fee_cny': format_currency(last_mile),
            'material_cost': format_currency(material_cost),
            'profit': format_currency(profit),
            'profit_rate': round(profit_rate, 2),
            # 额外字段
            'warehouse_name': posting.warehouse_name,
            'delivery_method_name': posting.delivery_method_name,
            'order_notes': posting.order_notes,
            'domestic_tracking_numbers': posting.get_domestic_tracking_numbers(),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get posting detail: {e}")
        import traceback
        logger.error(traceback.format_exc())
        raise HTTPException(status_code=500, detail=f"获取货件详情失败: {str(e)}")
