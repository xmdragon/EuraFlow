"""
订单 API 路由
"""
from typing import List, Optional
from datetime import datetime

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse

from ef_core.services import OrdersService
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import EuraFlowException
from .models import ApiResponse, PaginatedResponse, OrderResponse, CreateOrderRequest

router = APIRouter()
logger = get_logger(__name__)


async def get_orders_service() -> OrdersService:
    """依赖注入：获取订单服务"""
    return OrdersService()


@router.get("", response_model=ApiResponse[PaginatedResponse[OrderResponse]])
async def get_orders(
    request: Request,
    platform: str = Query("ozon", description="平台标识"),
    shop_id: Optional[int] = Query(None, description="店铺ID"),
    status: Optional[List[str]] = Query(None, description="订单状态列表"),
    from_date: Optional[str] = Query(None, description="开始时间 (ISO8601)"),
    to_date: Optional[str] = Query(None, description="结束时间 (ISO8601)"),
    q: Optional[str] = Query(None, description="搜索关键词"),
    page_size: int = Query(50, ge=1, le=200, description="每页大小"),
    offset: int = Query(0, ge=0, description="偏移量"),
    orders_service: OrdersService = Depends(get_orders_service)
):
    """查询订单列表"""
    try:
        # 从请求状态获取用户信息
        user_shop_id = getattr(request.state, 'shop_id', None)
        
        # 如果没有指定 shop_id，使用用户的 shop_id
        if shop_id is None:
            shop_id = user_shop_id
        
        # 权限检查：用户只能查看自己店铺的订单
        if shop_id != user_shop_id:
            from ef_core.utils.errors import ForbiddenError
            raise ForbiddenError(
                code="SHOP_ACCESS_DENIED",
                detail="Cannot access orders from other shops"
            )
        
        # 解析时间参数
        from_datetime = None
        to_datetime = None
        
        if from_date:
            try:
                from_datetime = datetime.fromisoformat(from_date.replace("Z", "+00:00"))
            except ValueError:
                from ef_core.utils.errors import ValidationError
                raise ValidationError(
                    code="INVALID_FROM_DATE",
                    detail="Invalid from_date format, expected ISO8601"
                )
        
        if to_date:
            try:
                to_datetime = datetime.fromisoformat(to_date.replace("Z", "+00:00"))
            except ValueError:
                from ef_core.utils.errors import ValidationError
                raise ValidationError(
                    code="INVALID_TO_DATE", 
                    detail="Invalid to_date format, expected ISO8601"
                )
        
        # 调用服务
        result = await orders_service.get_orders(
            shop_id=shop_id,
            platform=platform,
            status=status,
            from_date=from_datetime,
            to_date=to_datetime,
            search_query=q,
            page_size=page_size,
            offset=offset
        )
        
        if not result.success:
            from ef_core.utils.errors import InternalServerError
            raise InternalServerError(
                code=result.error_code or "GET_ORDERS_FAILED",
                detail=result.error or "Failed to get orders"
            )
        
        # 转换为响应格式
        orders_data = []
        for order_dict in result.data["items"]:
            # 构建买家信息
            buyer = {
                "name": order_dict["buyer_name"],
                "phone": order_dict.get("buyer_phone_e164"),
                "email": order_dict.get("buyer_email")
            }
            
            # 构建地址信息
            address = {
                "country": order_dict["address_country"],
                "region": order_dict["address_region"], 
                "city": order_dict["address_city"],
                "street": order_dict["address_street"],
                "postal_code": order_dict["address_postcode"]
            }
            
            # 构建订单项
            items = []
            for item in order_dict.get("items", []):
                items.append({
                    "sku": item["sku"],
                    "offer_id": item.get("offer_id"),
                    "qty": item["qty"],
                    "price_rub": str(item["price_rub"])
                })
            
            order_response = OrderResponse(
                id=order_dict["id"],
                platform=order_dict["platform"],
                shop_id=order_dict["shop_id"],
                external_id=order_dict["external_id"],
                external_no=order_dict["external_no"],
                status=order_dict["status"],
                external_status=order_dict["external_status"],
                is_cod=order_dict["is_cod"],
                payment_method=order_dict["payment_method"],
                buyer=buyer,
                address=address,
                platform_created_ts=order_dict["platform_created_ts"],
                platform_updated_ts=order_dict["platform_updated_ts"],
                items=items
            )
            
            orders_data.append(order_response)
        
        # 构建分页响应
        paginated_data = PaginatedResponse(
            items=orders_data,
            total=result.data.get("total"),
            page_size=page_size,
            offset=offset,
            has_more=result.data.get("has_more", False)
        )
        
        return ApiResponse.success(paginated_data)
        
    except EuraFlowException:
        raise
    except Exception as e:
        logger.error("Get orders API failed", exc_info=True)
        from ef_core.utils.errors import InternalServerError
        raise InternalServerError(
            code="API_ERROR",
            detail=f"Unexpected error: {str(e)}"
        )


@router.post("", response_model=ApiResponse[dict])
async def create_order(
    request: Request,
    order_data: CreateOrderRequest,
    orders_service: OrdersService = Depends(get_orders_service)
):
    """创建订单"""
    try:
        # 权限检查
        user_shop_id = getattr(request.state, 'shop_id', None)
        if order_data.shop_id != user_shop_id:
            from ef_core.utils.errors import ForbiddenError
            raise ForbiddenError(
                code="SHOP_ACCESS_DENIED", 
                detail="Cannot create orders for other shops"
            )
        
        # 转换为服务层数据格式
        order_dict = order_data.model_dump()
        items_data = order_dict.pop("items")
        
        # 调用服务
        result = await orders_service.create_or_update_order(order_dict, items_data)
        
        if not result.success:
            from ef_core.utils.errors import InternalServerError
            raise InternalServerError(
                code=result.error_code or "CREATE_ORDER_FAILED",
                detail=result.error or "Failed to create order"
            )
        
        # 返回简化的响应
        response_data = {
            "order_id": result.data["order"].id,
            "external_id": result.data["order"].external_id,
            "created": result.metadata.get("operation") == "created"
        }
        
        return ApiResponse.success(response_data, metadata=result.metadata)
        
    except EuraFlowException:
        raise
    except Exception as e:
        logger.error("Create order API failed", exc_info=True)
        from ef_core.utils.errors import InternalServerError
        raise InternalServerError(
            code="API_ERROR",
            detail=f"Unexpected error: {str(e)}"
        )