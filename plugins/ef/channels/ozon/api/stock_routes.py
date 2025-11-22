"""
库存管理 API 路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc, func, String
from decimal import Decimal
from datetime import datetime
import logging

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.models.inventory import Inventory
from ef_core.middleware.auth import require_role
from ef_core.services.audit_service import AuditService
from ..models import OzonProduct, OzonShop
from .permissions import filter_by_shop_permission

router = APIRouter(tags=["ozon-stock"])
logger = logging.getLogger(__name__)


# DTO 模型
class AddStockRequest(BaseModel):
    """添加库存请求"""
    shop_id: int = Field(..., description="店铺ID")
    sku: str = Field(..., description="商品SKU")
    quantity: int = Field(..., gt=0, description="库存数量（必须>0）")
    notes: Optional[str] = Field(None, max_length=500, description="备注")


class UpdateStockRequest(BaseModel):
    """更新库存请求"""
    quantity: int = Field(..., ge=0, description="库存数量（≥0，0表示删除）")
    notes: Optional[str] = Field(None, max_length=500, description="备注")


class StockItemResponse(BaseModel):
    """库存列表项响应"""
    id: int
    shop_id: int
    shop_name: Optional[str]
    sku: str
    product_title: Optional[str]
    product_image: Optional[str]
    product_price: Optional[Decimal]
    qty_available: int
    threshold: int
    notes: Optional[str]
    updated_at: datetime

    class Config:
        from_attributes = True


class StockCheckResponse(BaseModel):
    """备货时库存检查响应"""
    sku: str
    product_title: Optional[str]
    product_image: Optional[str]
    stock_available: int
    order_quantity: int
    is_sufficient: bool


@router.get("/stock")
async def get_stock_list(
    shop_id: Optional[int] = Query(None, description="店铺ID（不传=全部店铺）"),
    sku: Optional[str] = Query(None, description="商品SKU（模糊搜索）"),
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(50, ge=1, le=200, description="每页数量"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    查询库存列表（带店铺权限过滤）

    权限：
    - admin: 可查询所有店铺
    - operator/viewer: 仅查询授权店铺
    """
    # 构建查询条件
    filters = []

    # 店铺筛选
    if shop_id:
        filters.append(Inventory.shop_id == shop_id)

    # SKU 模糊搜索
    if sku:
        filters.append(Inventory.sku.ilike(f"%{sku}%"))

    # 店铺权限过滤（仅返回用户有权限的店铺库存）
    shop_ids = await filter_by_shop_permission(current_user, db)
    if shop_ids is not None:  # None = admin（所有店铺），list = 授权店铺
        filters.append(Inventory.shop_id.in_(shop_ids))

    # 查询总数
    count_query = select(func.count()).select_from(Inventory)
    if filters:
        count_query = count_query.where(and_(*filters))
    total_result = await db.execute(count_query)
    total = total_result.scalar_one()

    # 查询列表（JOIN 店铺表和商品表获取信息）
    from ..models.products import OzonProduct

    query = (
        select(
            Inventory,
            OzonShop.shop_name_cn.label("shop_name"),
            OzonProduct.title_cn,
            OzonProduct.title,
            OzonProduct.images,
            OzonProduct.price
        )
        .outerjoin(OzonShop, Inventory.shop_id == OzonShop.id)
        .outerjoin(
            OzonProduct,
            and_(
                OzonProduct.shop_id == Inventory.shop_id,
                func.cast(OzonProduct.ozon_sku, String) == Inventory.sku
            )
        )
        .order_by(desc(Inventory.updated_at))
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    if filters:
        query = query.where(and_(*filters))

    result = await db.execute(query)
    rows = result.all()

    # 构造响应
    items = []
    for inventory, shop_name, title_cn, title, images, price in rows:
        # 获取商品图片
        product_image = None
        if images and isinstance(images, dict):
            product_image = images.get("primary")

        # 商品名称优先用中文
        product_title = title_cn or title

        items.append(StockItemResponse(
            id=inventory.id,
            shop_id=inventory.shop_id,
            shop_name=shop_name,
            sku=inventory.sku,
            product_title=product_title,
            product_image=product_image,
            product_price=price,
            qty_available=inventory.qty_available,
            threshold=inventory.threshold,
            notes=inventory.notes,
            updated_at=inventory.updated_at
        ))

    return {
        "ok": True,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size
        }
    }


@router.post("/stock")
async def add_stock(
    request: Request,
    data: AddStockRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    添加库存（需要操作员权限）

    流程：
    1. 查询商品信息（验证 SKU 存在）
    2. 创建库存记录
    3. 记录审计日志
    """
    # 验证店铺权限
    shop_ids = await filter_by_shop_permission(current_user, db)
    if shop_ids is not None and data.shop_id not in shop_ids:
        raise HTTPException(status_code=403, detail="无权限操作该店铺")

    # 1. 查询商品信息（通过 ozon_sku 查询）
    product_query = select(OzonProduct).where(
        and_(
            OzonProduct.shop_id == data.shop_id,
            OzonProduct.ozon_sku == int(data.sku)
        )
    )
    product_result = await db.execute(product_query)
    product = product_result.scalar_one_or_none()

    if not product:
        raise HTTPException(
            status_code=404,
            detail=f"商品不存在，请核对SKU: {data.sku}"
        )

    # 2. 检查是否已存在库存记录（统一使用 ozon_sku）
    existing_query = select(Inventory).where(
        and_(
            Inventory.shop_id == data.shop_id,
            Inventory.sku == data.sku  # 直接用 ozon_sku
        )
    )
    existing_result = await db.execute(existing_query)
    existing = existing_result.scalar_one_or_none()

    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"该商品库存记录已存在，请使用编辑功能"
        )

    # 3. 创建库存记录（只存储核心字段）
    inventory = Inventory(
        shop_id=data.shop_id,
        sku=data.sku,  # 使用 ozon_sku
        qty_available=data.quantity,
        threshold=0,
        notes=data.notes
    )
    db.add(inventory)
    await db.flush()

    # 4. 记录审计日志
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    await AuditService.log_action(
        db=db,
        user_id=current_user.id,
        username=current_user.username,
        module="ozon",
        action="create",
        action_display="添加库存",
        table_name="inventories",
        record_id=f"{data.shop_id}:{data.sku}",
        changes={
            "qty_available": {"new": data.quantity},
            "sku": data.sku
        },
        ip_address=request_ip,
        user_agent=user_agent,
        request_id=request_id,
        notes=data.notes
    )

    await db.commit()

    return {
        "ok": True,
        "data": {
            "id": inventory.id,
            "message": "库存添加成功"
        }
    }


@router.put("/stock/{stock_id}")
async def update_stock(
    stock_id: int,
    request: Request,
    data: UpdateStockRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    更新库存（需要操作员权限）

    流程：
    1. 查询旧值
    2. 如果 quantity = 0，删除记录
    3. 否则，更新库存
    4. 记录审计日志
    """
    # 1. 查询库存记录
    query = select(Inventory).where(Inventory.id == stock_id)
    result = await db.execute(query)
    inventory = result.scalar_one_or_none()

    if not inventory:
        raise HTTPException(status_code=404, detail="库存记录不存在")

    # 验证店铺权限
    shop_ids = await filter_by_shop_permission(current_user, db)
    if shop_ids is not None and inventory.shop_id not in shop_ids:
        raise HTTPException(status_code=403, detail="无权限操作该店铺库存")

    # 保存旧值（用于审计日志）
    old_quantity = inventory.qty_available
    old_notes = inventory.notes

    # 获取请求上下文
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    # 2. 如果数量为 0，删除记录
    if data.quantity == 0:
        await db.delete(inventory)

        # 记录删除日志
        await AuditService.log_action(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            module="ozon",
            action="delete",
            action_display="删除库存",
            table_name="inventories",
            record_id=f"{inventory.shop_id}:{inventory.sku}",
            changes={
                "qty_available": {"old": old_quantity, "new": 0},
                "deleted": True
            },
            ip_address=request_ip,
            user_agent=user_agent,
            request_id=request_id,
            notes="库存数量编辑为0，自动删除"
        )

        await db.commit()

        return {
            "ok": True,
            "data": {"message": "库存记录已删除"}
        }

    # 3. 更新库存
    inventory.qty_available = data.quantity
    if data.notes is not None:
        inventory.notes = data.notes

    # 4. 记录修改日志
    changes = {
        "qty_available": {
            "old": old_quantity,
            "new": data.quantity,
            "change": data.quantity - old_quantity
        }
    }

    if data.notes is not None and data.notes != old_notes:
        changes["notes"] = {"old": old_notes, "new": data.notes}

    await AuditService.log_action(
        db=db,
        user_id=current_user.id,
        username=current_user.username,
        module="ozon",
        action="update",
        action_display="修改库存数量",
        table_name="inventories",
        record_id=f"{inventory.shop_id}:{inventory.sku}",
        changes=changes,
        ip_address=request_ip,
        user_agent=user_agent,
        request_id=request_id
    )

    await db.commit()

    return {
        "ok": True,
        "data": {"message": "库存更新成功"}
    }


@router.delete("/stock/{stock_id}")
async def delete_stock(
    stock_id: int,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    删除库存（需要操作员权限）
    """
    # 查询库存记录
    query = select(Inventory).where(Inventory.id == stock_id)
    result = await db.execute(query)
    inventory = result.scalar_one_or_none()

    if not inventory:
        raise HTTPException(status_code=404, detail="库存记录不存在")

    # 验证店铺权限
    shop_ids = await filter_by_shop_permission(current_user, db)
    if shop_ids is not None and inventory.shop_id not in shop_ids:
        raise HTTPException(status_code=403, detail="无权限操作该店铺库存")

    # 获取请求上下文
    request_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    request_id = request.headers.get("x-request-id")

    # 删除记录
    await db.delete(inventory)

    # 记录审计日志
    await AuditService.log_action(
        db=db,
        user_id=current_user.id,
        username=current_user.username,
        module="ozon",
        action="delete",
        action_display="删除库存",
        table_name="inventories",
        record_id=f"{inventory.shop_id}:{inventory.sku}",
        changes={
            "qty_available": {"old": inventory.qty_available, "new": 0},
            "deleted": True
        },
        ip_address=request_ip,
        user_agent=user_agent,
        request_id=request_id
    )

    await db.commit()

    return {
        "ok": True,
        "data": {"message": "库存删除成功"}
    }


@router.get("/stock/check/{posting_number}")
async def check_stock_for_posting(
    posting_number: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    检查订单商品的库存情况（备货时使用）

    返回：
    - 订单中每个商品的库存信息
    - 是否库存充足
    """
    from ..models import OzonPosting, OzonOrderItem

    # 1. 查询订单信息
    posting_query = select(OzonPosting).where(
        OzonPosting.posting_number == posting_number
    )
    posting_result = await db.execute(posting_query)
    posting = posting_result.scalar_one_or_none()

    if not posting:
        raise HTTPException(status_code=404, detail=f"订单不存在: {posting_number}")

    # 验证店铺权限
    shop_ids = await filter_by_shop_permission(current_user, db)
    if shop_ids is not None and posting.shop_id not in shop_ids:
        raise HTTPException(status_code=403, detail="无权限查看该订单")

    # 2. 查询订单商品
    items_query = select(OzonOrderItem).where(
        OzonOrderItem.order_id == posting.order_id
    )
    items_result = await db.execute(items_query)
    items = items_result.scalars().all()

    # 3. 检查每个商品的库存
    stock_info = []
    for item in items:
        # 查询库存
        inventory_query = select(Inventory).where(
            and_(
                Inventory.shop_id == posting.shop_id,
                Inventory.sku == item.offer_id
            )
        )
        inventory_result = await db.execute(inventory_query)
        inventory = inventory_result.scalar_one_or_none()

        stock_available = inventory.qty_available if inventory else 0

        stock_info.append(StockCheckResponse(
            sku=item.offer_id,
            product_title=item.name,
            product_image=None,  # 可以从 OzonProduct 查询
            stock_available=stock_available,
            order_quantity=item.quantity,
            is_sufficient=stock_available >= item.quantity
        ))

    return {
        "ok": True,
        "data": {
            "posting_number": posting_number,
            "items": stock_info
        }
    }
