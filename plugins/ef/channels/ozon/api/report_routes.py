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
from ..models import OzonOrder, OzonPosting, OzonProduct, OzonShop
from ..utils.datetime_utils import utcnow

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
        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算月份的开始和结束日期（UTC timezone-aware）
        start_date = datetime(year, month_num, 1, tzinfo=timezone.utc)
        last_day = calendar.monthrange(year, month_num)[1]
        end_date = datetime(year, month_num, last_day, 23, 59, 59, tzinfo=timezone.utc)

        # 构建查询条件
        conditions = [
            OzonOrder.created_at >= start_date,
            OzonOrder.created_at <= end_date,
            # 只查询已确认或已完成的订单
            or_(
                OzonOrder.status.in_(['confirmed', 'processing', 'shipped', 'delivered']),
                OzonOrder.status == 'awaiting_deliver',
                OzonOrder.status == 'awaiting_packaging'
            )
        ]

        # 如果指定了店铺ID
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]
            conditions.append(OzonOrder.shop_id.in_(shop_id_list))

        # 查询订单数据（添加eager loading避免懒加载）
        from sqlalchemy.orm import selectinload

        orders_query = select(
            OzonOrder,
            OzonShop.shop_name
        ).join(
            OzonShop, OzonOrder.shop_id == OzonShop.id
        ).where(and_(*conditions)).options(
            selectinload(OzonOrder.items),
            selectinload(OzonOrder.postings)  # 预加载postings以读取posting维度的字段
        )

        result = await db.execute(orders_query)
        orders_with_shop = result.all()

        # 计算统计数据
        total_sales = Decimal('0')  # 销售总额
        total_purchase = Decimal('0')  # 进货总额
        total_cost = Decimal('0')  # 费用总额
        order_count = 0

        # 构建详细数据列表
        report_data = []

        for order, shop_name in orders_with_shop:
            # 遍历每个posting（一个订单可能有多个posting）
            postings = order.postings or []

            for posting in postings:
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
                        "date": order.created_at.strftime("%Y-%m-%d"),
                        "shop_name": shop_name,
                        "product_name": product.get('name', product.get('sku', '未知商品')),
                        "posting_number": posting_number,
                        "purchase_price": format_currency(purchase_price),
                        "sale_price": format_currency(sale_price),
                        "tracking_number": order.tracking_number,
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


# Posting级别报表端点（新版）
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
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取Posting级别的订单报表数据（支持分页和排序）

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔（不传则查询所有店铺）
        status_filter: 状态过滤 (delivered=已签收, placed=已下订包含多种状态)
        page: 页码（从1开始）
        page_size: 每页条数（默认50，最大100）

    Returns:
        包含posting列表、分页信息的报表数据
    """
    from sqlalchemy import and_, or_
    from sqlalchemy.orm import selectinload
    from ..models.orders import OzonOrderItem, OzonShipmentPackage
    import calendar

    try:
        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算月份的开始和结束日期（UTC timezone-aware）
        start_date = datetime(year, month_num, 1, tzinfo=timezone.utc)
        last_day = calendar.monthrange(year, month_num)[1]
        end_date = datetime(year, month_num, last_day, 23, 59, 59, tzinfo=timezone.utc)

        # 构建查询条件（使用客户下单时间，与汇总报表保持一致）
        conditions = [
            OzonOrder.ordered_at >= start_date,
            OzonOrder.ordered_at <= end_date,
        ]

        # 状态过滤逻辑
        if status_filter == 'delivered':
            conditions.append(OzonPosting.status == 'delivered')
        elif status_filter == 'placed':
            # 已下订包含多种状态（包括已取消）
            conditions.append(OzonPosting.status.in_([
                'awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled'
            ]))
        else:
            raise HTTPException(status_code=400, detail=f"无效的status_filter: {status_filter}")

        # 如果指定了店铺ID
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]
            conditions.append(OzonOrder.shop_id.in_(shop_id_list))

        # 货件编号过滤（支持通配符）
        if posting_number:
            posting_number_value = posting_number.strip()
            if '%' in posting_number_value:
                conditions.append(OzonPosting.posting_number.like(posting_number_value))
            else:
                conditions.append(OzonPosting.posting_number == posting_number_value)

        # 查询总数（用于分页）- 保持和数据查询一致的JOIN
        count_query = select(func.count(OzonPosting.id)).join(
            OzonOrder, OzonPosting.order_id == OzonOrder.id
        ).join(
            OzonShop, OzonOrder.shop_id == OzonShop.id
        ).where(and_(*conditions))

        count_result = await db.execute(count_query)
        total = count_result.scalar() or 0

        # 计算分页
        offset = (page - 1) * page_size
        total_pages = (total + page_size - 1) // page_size  # 向上取整

        # 确定排序字段和顺序
        if sort_by == 'profit_rate':
            # 使用数据库中的 profit_rate 字段排序
            order_clause = OzonPosting.profit_rate.desc() if sort_order == 'desc' else OzonPosting.profit_rate.asc()
        else:
            # 默认按下单时间降序排序
            order_clause = OzonOrder.ordered_at.desc()

        # 查询posting数据（带分页和排序）
        postings_query = select(
            OzonPosting,
            OzonOrder,
            OzonShop.shop_name
        ).join(
            OzonOrder, OzonPosting.order_id == OzonOrder.id
        ).join(
            OzonShop, OzonOrder.shop_id == OzonShop.id
        ).where(
            and_(*conditions)
        ).order_by(
            order_clause
        ).offset(offset).limit(page_size)

        result = await db.execute(postings_query)
        postings_with_order_shop = result.all()

        # 收集所有 offer_id 用于批量查询图片
        all_offer_ids = set()
        for posting, order, shop_name in postings_with_order_shop:
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product in posting.raw_payload['products']:
                    offer_id = product.get('offer_id')
                    if offer_id:
                        all_offer_ids.add(offer_id)

        # 批量查询商品图片（使用offer_id匹配）
        offer_id_images = {}
        if all_offer_ids:
            product_query = select(OzonProduct.offer_id, OzonProduct.images).where(
                OzonProduct.offer_id.in_(list(all_offer_ids))
            )
            products_result = await db.execute(product_query)
            for offer_id, images in products_result:
                if offer_id and images:
                    # 提取primary图片URL（原始URL，不做转换）
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

        # 构建返回数据
        from ..utils.serialization import format_currency

        report_data = []
        for posting, order, shop_name in postings_with_order_shop:
            # 从 raw_payload 提取商品列表
            products_list = []
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product_raw in posting.raw_payload['products']:
                    offer_id = product_raw.get('offer_id')
                    image_url = offer_id_images.get(offer_id) if offer_id else None

                    products_list.append({
                        'sku': str(product_raw.get('sku', '')),
                        'offer_id': str(offer_id) if offer_id else None,
                        'name': product_raw.get('name', ''),
                        'quantity': product_raw.get('quantity', 0),
                        'price': format_currency(Decimal(str(product_raw.get('price', '0')))),
                        'image_url': image_url  # 原始URL，前端用 optimizeOzonImageUrl 优化
                    })

            # 真实订单金额（用于显示）
            real_order_amount = Decimal(str(order.total_price or '0'))

            # 计算订单金额（取消订单不计销售额，用于统计）
            if posting.status == 'cancelled':
                order_amount = Decimal('0')
            else:
                order_amount = real_order_amount

            # 获取posting维度的费用字段（取消订单仍然计入成本）
            purchase_price = posting.purchase_price or Decimal('0')
            ozon_commission = posting.ozon_commission_cny or Decimal('0')
            intl_logistics = posting.international_logistics_fee_cny or Decimal('0')
            last_mile = posting.last_mile_delivery_fee_cny or Decimal('0')
            material_cost = posting.material_cost or Decimal('0')

            # 计算利润（取消订单会产生负利润）
            profit = order_amount - (purchase_price + ozon_commission + intl_logistics + last_mile + material_cost)

            # 计算利润率（取消订单利润率无意义，显示为0）
            if posting.status == 'cancelled':
                profit_rate = 0.0
            else:
                profit_rate = float((profit / order_amount * 100)) if order_amount > 0 else 0.0

            report_data.append({
                'posting_number': posting.posting_number,
                'shop_name': shop_name,
                'status': posting.status,
                'is_cancelled': posting.status == 'cancelled',
                'created_at': order.ordered_at.isoformat(),
                'in_process_at': posting.in_process_at.isoformat() if posting.in_process_at else None,
                'products': products_list,
                'order_amount': format_currency(real_order_amount),  # 显示真实金额
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


# 报表汇总端点（用于图表数据）
@router.get("/reports/summary")
async def get_report_summary(
    month: str = Query(..., description="月份，格式：YYYY-MM"),
    shop_ids: Optional[str] = Query(None, description="店铺ID列表，逗号分隔"),
    status_filter: str = Query("delivered", description="状态过滤：delivered(已签收) 或 placed(已下订)"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取报表汇总数据（用于图表展示）

    Args:
        month: 月份，格式：YYYY-MM
        shop_ids: 店铺ID列表，逗号分隔（不传则查询所有店铺）
        status_filter: 状态过滤 (delivered=已签收, placed=已下订)

    Returns:
        包含统计汇总、成本分解、店铺分布、每日趋势、TOP10商品的数据
    """
    from sqlalchemy import and_, or_, case
    from sqlalchemy.orm import selectinload
    import calendar

    try:
        # 解析月份
        year, month_num = month.split("-")
        year = int(year)
        month_num = int(month_num)

        # 计算当月的开始和结束日期
        start_date = datetime(year, month_num, 1, tzinfo=timezone.utc)
        last_day = calendar.monthrange(year, month_num)[1]
        end_date = datetime(year, month_num, last_day, 23, 59, 59, tzinfo=timezone.utc)

        # 如果结束日期超过今天，则截止到昨天，避免显示今天未完成的数据
        from datetime import timedelta
        now = datetime.now(timezone.utc)
        yesterday = now - timedelta(days=1)
        yesterday_end = datetime(yesterday.year, yesterday.month, yesterday.day, 23, 59, 59, tzinfo=timezone.utc)
        if end_date > yesterday_end:
            end_date = yesterday_end

        # 计算上月的开始和结束日期
        if month_num == 1:
            prev_year = year - 1
            prev_month = 12
        else:
            prev_year = year
            prev_month = month_num - 1

        prev_start_date = datetime(prev_year, prev_month, 1, tzinfo=timezone.utc)
        prev_last_day = calendar.monthrange(prev_year, prev_month)[1]
        prev_end_date = datetime(prev_year, prev_month, prev_last_day, 23, 59, 59, tzinfo=timezone.utc)

        # 构建查询条件（当月，使用下单时间）
        conditions = [
            OzonOrder.ordered_at >= start_date,
            OzonOrder.ordered_at <= end_date,
        ]

        # 状态过滤
        if status_filter == 'delivered':
            conditions.append(OzonPosting.status == 'delivered')
        elif status_filter == 'placed':
            conditions.append(OzonPosting.status.in_([
                'awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled'
            ]))

        # 店铺过滤
        if shop_ids:
            shop_id_list = [int(sid) for sid in shop_ids.split(",")]
            conditions.append(OzonOrder.shop_id.in_(shop_id_list))

        # 查询当月所有posting数据
        postings_query = select(
            OzonPosting,
            OzonOrder,
            OzonShop.shop_name
        ).join(
            OzonOrder, OzonPosting.order_id == OzonOrder.id
        ).join(
            OzonShop, OzonOrder.shop_id == OzonShop.id
        ).where(and_(*conditions))

        result = await db.execute(postings_query)
        postings_data = result.all()

        # 初始化统计变量
        total_sales = Decimal('0')
        total_purchase = Decimal('0')
        total_commission = Decimal('0')
        total_intl_logistics = Decimal('0')
        total_last_mile = Decimal('0')
        total_material = Decimal('0')
        order_count = len(postings_data)

        # 店铺维度统计（字典）
        shop_stats = {}

        # 每日趋势统计（字典）
        daily_stats = {}

        # 商品销售统计（字典，用于TOP10）
        product_stats = {}

        # 遍历posting数据计算统计
        from ..utils.serialization import format_currency

        for posting, order, shop_name in postings_data:
            # 订单金额（取消订单不计销售额）
            if posting.status == 'cancelled':
                order_amount = Decimal('0')
            else:
                order_amount = Decimal(str(order.total_price or '0'))

            # 费用字段（取消订单仍然计入成本）
            purchase = posting.purchase_price or Decimal('0')
            commission = posting.ozon_commission_cny or Decimal('0')
            intl_log = posting.international_logistics_fee_cny or Decimal('0')
            last_mile = posting.last_mile_delivery_fee_cny or Decimal('0')
            material = posting.material_cost or Decimal('0')

            # 利润（取消订单会产生负利润）
            profit = order_amount - (purchase + commission + intl_log + last_mile + material)

            # 累加总计
            total_sales += order_amount
            total_purchase += purchase
            total_commission += commission
            total_intl_logistics += intl_log
            total_last_mile += last_mile
            total_material += material

            # 店铺维度统计
            if shop_name not in shop_stats:
                shop_stats[shop_name] = {'sales': Decimal('0'), 'profit': Decimal('0')}
            shop_stats[shop_name]['sales'] += order_amount
            shop_stats[shop_name]['profit'] += profit

            # 每日趋势统计（使用下单时间）
            date_str = order.ordered_at.strftime("%Y-%m-%d")
            if date_str not in daily_stats:
                daily_stats[date_str] = {'sales': Decimal('0'), 'profit': Decimal('0')}
            daily_stats[date_str]['sales'] += order_amount
            daily_stats[date_str]['profit'] += profit

            # 商品销售统计（用于TOP10）
            if posting.raw_payload and 'products' in posting.raw_payload:
                for product_raw in posting.raw_payload['products']:
                    offer_id = product_raw.get('offer_id')
                    if not offer_id:
                        continue

                    quantity = product_raw.get('quantity', 0)
                    price = Decimal(str(product_raw.get('price', '0')))
                    # 取消订单不计销售额
                    if posting.status == 'cancelled':
                        product_sales = Decimal('0')
                    else:
                        product_sales = price * quantity

                    if offer_id not in product_stats:
                        product_stats[offer_id] = {
                            'name': product_raw.get('name', ''),
                            'sku': product_raw.get('sku', ''),
                            'sales': Decimal('0'),
                            'quantity': 0,
                            'profit': Decimal('0')  # 简化处理：按比例分配利润
                        }

                    product_stats[offer_id]['sales'] += product_sales
                    product_stats[offer_id]['quantity'] += quantity
                    # 按销售额比例分配利润（取消订单的利润也要分配）
                    if posting.status == 'cancelled':
                        # 取消订单：按数量比例分配负利润
                        total_quantity = sum(p.get('quantity', 0) for p in posting.raw_payload['products'])
                        if total_quantity > 0:
                            # 使用 Decimal 避免类型错误
                            ratio = Decimal(str(quantity)) / Decimal(str(total_quantity))
                            product_profit = profit * ratio
                            product_stats[offer_id]['profit'] += product_profit
                    elif order_amount > 0:
                        # 正常订单：按销售额比例分配利润
                        product_profit = profit * (product_sales / order_amount)
                        product_stats[offer_id]['profit'] += product_profit

        # 计算总利润和利润率
        total_profit = total_sales - (total_purchase + total_commission + total_intl_logistics + total_last_mile + total_material)
        profit_rate = float((total_profit / total_sales * 100)) if total_sales > 0 else 0.0

        # 查询上月数据（用于对比，使用下单时间）
        prev_conditions = [
            OzonOrder.ordered_at >= prev_start_date,
            OzonOrder.ordered_at <= prev_end_date,
        ]
        if status_filter == 'delivered':
            prev_conditions.append(OzonPosting.status == 'delivered')
        elif status_filter == 'placed':
            prev_conditions.append(OzonPosting.status.in_([
                'awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled'
            ]))
        if shop_ids:
            prev_conditions.append(OzonOrder.shop_id.in_(shop_id_list))

        prev_postings_query = select(
            OzonPosting,
            OzonOrder
        ).join(
            OzonOrder, OzonPosting.order_id == OzonOrder.id
        ).where(and_(*prev_conditions))

        prev_result = await db.execute(prev_postings_query)
        prev_postings_data = prev_result.all()

        # 计算上月统计
        prev_total_sales = Decimal('0')
        prev_total_purchase = Decimal('0')
        prev_total_commission = Decimal('0')
        prev_total_intl_logistics = Decimal('0')
        prev_total_last_mile = Decimal('0')
        prev_total_material = Decimal('0')

        for posting, order in prev_postings_data:
            # 取消订单不计销售额
            if posting.status == 'cancelled':
                order_amount = Decimal('0')
            else:
                order_amount = Decimal(str(order.total_price or '0'))

            # 费用仍然计入
            purchase = posting.purchase_price or Decimal('0')
            commission = posting.ozon_commission_cny or Decimal('0')
            intl_log = posting.international_logistics_fee_cny or Decimal('0')
            last_mile = posting.last_mile_delivery_fee_cny or Decimal('0')
            material = posting.material_cost or Decimal('0')

            prev_total_sales += order_amount
            prev_total_purchase += purchase
            prev_total_commission += commission
            prev_total_intl_logistics += intl_log
            prev_total_last_mile += last_mile
            prev_total_material += material

        prev_total_profit = prev_total_sales - (prev_total_purchase + prev_total_commission + prev_total_intl_logistics + prev_total_last_mile + prev_total_material)
        prev_profit_rate = float((prev_total_profit / prev_total_sales * 100)) if prev_total_sales > 0 else 0.0

        # 构建成本分解数据（用于饼图）- 包含利润占比
        cost_breakdown = [
            {"name": "进货金额", "value": float(total_purchase)},
            {"name": "Ozon佣金", "value": float(total_commission)},
            {"name": "国际物流", "value": float(total_intl_logistics)},
            {"name": "尾程派送", "value": float(total_last_mile)},
            {"name": "打包费用", "value": float(total_material)}
        ]
        # 只有利润为正时才加入饼图（饼图不能显示负值）
        if total_profit > 0:
            cost_breakdown.append({"name": "利润", "value": float(total_profit)})

        # 构建店铺分布数据（用于饼图）
        shop_breakdown = [
            {
                "shop_name": shop_name,
                "sales": float(stats['sales']),
                "profit": float(stats['profit'])
            }
            for shop_name, stats in shop_stats.items()
        ]

        # 构建每日趋势数据（用于折线图）
        daily_trend = [
            {
                "date": date_str,
                "sales": float(stats['sales']),
                "profit": float(stats['profit'])
            }
            for date_str, stats in sorted(daily_stats.items())
        ]

        # 构建销售额TOP10商品数据
        top_products_by_sales_list = sorted(
            product_stats.items(),
            key=lambda x: x[1]['sales'],
            reverse=True
        )[:10]

        # 构建销售量TOP10商品数据
        top_products_by_quantity_list = sorted(
            product_stats.items(),
            key=lambda x: x[1]['quantity'],
            reverse=True
        )[:10]

        # 合并两个列表的offer_id用于批量查询图片
        top_offer_ids = set()
        for offer_id, _ in top_products_by_sales_list:
            top_offer_ids.add(offer_id)
        for offer_id, _ in top_products_by_quantity_list:
            top_offer_ids.add(offer_id)

        # 批量查询TOP10商品的图片
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

        # 构建销售额TOP10返回数据
        top_products_by_sales = [
            {
                "offer_id": offer_id,
                "name": stats['name'],
                "sku": stats['sku'],
                "sales": float(stats['sales']),
                "quantity": stats['quantity'],
                "profit": float(stats['profit']),
                "image_url": offer_id_images.get(offer_id)  # 原始URL
            }
            for offer_id, stats in top_products_by_sales_list
        ]

        # 构建销售量TOP10返回数据
        top_products_by_quantity = [
            {
                "offer_id": offer_id,
                "name": stats['name'],
                "sku": stats['sku'],
                "sales": float(stats['sales']),
                "quantity": stats['quantity'],
                "profit": float(stats['profit']),
                "image_url": offer_id_images.get(offer_id)  # 原始URL
            }
            for offer_id, stats in top_products_by_quantity_list
        ]

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
