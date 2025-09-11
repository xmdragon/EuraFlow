"""
API 响应模型
"""
from typing import Any, Dict, List, Optional, Generic, TypeVar
from pydantic import BaseModel, Field

T = TypeVar('T')


class ApiResponse(BaseModel, Generic[T]):
    """统一 API 响应格式"""
    ok: bool = Field(description="操作是否成功")
    data: Optional[T] = Field(default=None, description="响应数据")
    error: Optional[Dict[str, Any]] = Field(default=None, description="错误信息（RFC7807 Problem Details）")
    metadata: Optional[Dict[str, Any]] = Field(default=None, description="元数据")
    
    @classmethod
    def success(cls, data: T, metadata: Optional[Dict[str, Any]] = None) -> "ApiResponse[T]":
        """创建成功响应"""
        return cls(ok=True, data=data, metadata=metadata)
    
    @classmethod
    def error(cls, error: Dict[str, Any]) -> "ApiResponse[None]":
        """创建错误响应"""
        return cls(ok=False, error=error)


class PaginatedResponse(BaseModel, Generic[T]):
    """分页响应"""
    items: List[T] = Field(description="数据列表")
    total: Optional[int] = Field(default=None, description="总数量")
    page_size: int = Field(description="每页大小")
    offset: int = Field(description="偏移量")
    has_more: bool = Field(description="是否有更多数据")
    next_cursor: Optional[str] = Field(default=None, description="下一页游标")


# 订单相关模型
class OrderBuyer(BaseModel):
    """订单买家信息"""
    name: str
    phone: Optional[str] = None
    email: Optional[str] = None


class OrderAddress(BaseModel):
    """订单地址信息"""
    country: str
    region: str
    city: str
    street: str
    postal_code: str


class OrderItem(BaseModel):
    """订单项"""
    sku: str
    offer_id: Optional[str] = None
    qty: int
    price_rub: str  # Decimal 序列化为字符串


class OrderResponse(BaseModel):
    """订单响应"""
    id: int
    platform: str
    shop_id: int
    external_id: str
    external_no: str
    status: str
    external_status: str
    is_cod: bool
    payment_method: str
    buyer: OrderBuyer
    address: OrderAddress
    platform_created_ts: str
    platform_updated_ts: str
    items: List[OrderItem]


class CreateOrderRequest(BaseModel):
    """创建订单请求"""
    shop_id: int
    external_id: str
    external_no: str
    status: str
    external_status: str
    payment_method: str
    buyer_name: str
    buyer_phone_raw: Optional[str] = None
    buyer_phone_e164: Optional[str] = None
    buyer_email: Optional[str] = None
    address_country: str = "RU"
    address_region: str
    address_city: str
    address_street: str
    address_postcode: str
    platform_created_ts: str
    platform_updated_ts: str
    fx_rate: str
    items: List[Dict[str, Any]]


# 发货相关模型
class PackageInfo(BaseModel):
    """包裹信息"""
    weight_kg: Optional[str] = None
    dim_l_cm: Optional[str] = None
    dim_w_cm: Optional[str] = None
    dim_h_cm: Optional[str] = None


class CreateShipmentRequest(BaseModel):
    """创建发货请求"""
    order_external_id: str = Field(description="订单外部ID")
    shop_id: int = Field(description="店铺ID")
    carrier_code: str = Field(description="承运商代码")
    tracking_no: str = Field(description="运单号")
    packages: Optional[List[PackageInfo]] = Field(default=None, description="包裹信息")


class ShipmentResponse(BaseModel):
    """发货响应"""
    id: int
    order_id: int
    carrier_code: str
    tracking_no: str
    pushed: bool
    pushed_at: Optional[str] = None
    created_at: str


# 库存相关模型
class InventoryItem(BaseModel):
    """库存项"""
    sku: str
    qty: int
    threshold: Optional[int] = 0


class UpdateInventoryRequest(BaseModel):
    """更新库存请求"""
    shop_id: int
    items: List[InventoryItem]


class InventoryResponse(BaseModel):
    """库存响应"""
    shop_id: int
    sku: str
    qty_available: int
    threshold: int
    updated_at: str


# 价格相关模型
class PriceItem(BaseModel):
    """价格项"""
    sku: str
    price_rub: str
    price_old_rub: Optional[str] = None
    cost_rub: Optional[str] = None  # 用于毛利计算


class UpdatePricesRequest(BaseModel):
    """更新价格请求"""
    shop_id: int
    items: List[PriceItem]
    skip_margin_check: bool = False


class ListingResponse(BaseModel):
    """商品价格响应"""
    shop_id: int
    sku: str
    price_rub: str
    price_old_rub: Optional[str] = None
    updated_at: str