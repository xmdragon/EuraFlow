"""
草稿与模板管理路由
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional, Any
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ..services.draft_template_service import DraftTemplateService

router = APIRouter(prefix="/listings", tags=["Draft & Template"])


def problem(status: int, code: str, title: str, detail: str | None = None):
    """抛出 Problem Details 格式的错误

    Args:
        status: HTTP 状态码
        code: 错误代码
        title: 错误标题
        detail: 错误详情（可选）
    """
    raise HTTPException(status_code=status, detail={
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code
    })


# ============================
# Pydantic Schema 定义
# ============================

class FormDataSchema(BaseModel):
    """表单数据结构（JSONB）"""
    shop_id: Optional[int] = None
    category_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    offer_id: Optional[str] = None
    price: Optional[float] = None
    old_price: Optional[float] = None
    premium_price: Optional[float] = None
    width: Optional[float] = None
    height: Optional[float] = None
    depth: Optional[float] = None
    weight: Optional[float] = None
    dimension_unit: Optional[str] = "mm"
    weight_unit: Optional[str] = "g"
    barcode: Optional[str] = None
    vat: Optional[str] = None
    attributes: Optional[dict[str, Any]] = None
    images: Optional[list[str]] = None
    videos: Optional[list[dict]] = None
    images360: Optional[str] = None
    color_image: Optional[str] = None
    pdf_list: Optional[str] = None
    promotions: Optional[list[int]] = None
    variantDimensions: Optional[list[dict]] = None
    variants: Optional[list[dict]] = None
    hiddenFields: Optional[list[str]] = None
    variantSectionExpanded: Optional[bool] = None
    variantTableCollapsed: Optional[bool] = None
    optionalFieldsExpanded: Optional[bool] = None
    autoColorSample: Optional[bool] = None


class SaveDraftRequest(BaseModel):
    """保存草稿请求"""
    shop_id: Optional[int] = None
    category_id: Optional[int] = None
    form_data: FormDataSchema


class CreateTemplateRequest(BaseModel):
    """创建模板请求"""
    template_name: str = Field(..., min_length=1, max_length=200)
    shop_id: Optional[int] = None
    category_id: Optional[int] = None
    form_data: FormDataSchema
    tags: Optional[list[str]] = Field(None, max_length=10)

    @field_validator('form_data')
    def validate_form_data_not_empty(cls, v):
        if not v or not v.model_dump(exclude_none=True):
            raise ValueError("表单数据不能为空")
        return v

    @field_validator('tags')
    def validate_tags(cls, v):
        if v is not None:
            if len(v) > 10:
                raise ValueError("标签数量不能超过10个")
            for tag in v:
                if len(tag) > 50:
                    raise ValueError("单个标签长度不能超过50个字符")
        return v


class UpdateTemplateRequest(BaseModel):
    """更新模板请求"""
    template_name: Optional[str] = Field(None, min_length=1, max_length=200)
    form_data: Optional[FormDataSchema] = None
    tags: Optional[list[str]] = Field(None, max_length=10)

    @field_validator('tags')
    def validate_tags(cls, v):
        if v is not None:
            if len(v) > 10:
                raise ValueError("标签数量不能超过10个")
            for tag in v:
                if len(tag) > 50:
                    raise ValueError("单个标签长度不能超过50个字符")
        return v


class TemplateListItem(BaseModel):
    """模板列表项"""
    id: int
    template_name: str
    shop_id: Optional[int]
    category_id: Optional[int]
    tags: Optional[list[str]]
    used_count: int
    last_used_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class TemplateDetail(BaseModel):
    """模板详情"""
    id: int
    template_name: str
    shop_id: Optional[int]
    category_id: Optional[int]
    form_data: dict
    tags: Optional[list[str]]
    used_count: int
    last_used_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime


class DraftDetail(BaseModel):
    """草稿详情"""
    id: int
    shop_id: Optional[int]
    category_id: Optional[int]
    form_data: dict
    updated_at: datetime


# ============================
# 草稿相关 API
# ============================

@router.post("/drafts")
async def save_draft(
    request: SaveDraftRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """保存或更新草稿（幂等）"""
    draft = await DraftTemplateService.save_or_update_draft(
        db=db,
        user_id=current_user.id,
        form_data=request.form_data.model_dump(),
        shop_id=request.shop_id,
        category_id=request.category_id
    )
    return {
        "success": True,
        "data": {
            "id": draft.id,
            "updated_at": draft.updated_at.isoformat()
        }
    }


@router.get("/drafts/latest")
async def get_latest_draft(
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """获取最新草稿"""
    draft = await DraftTemplateService.get_latest_draft(db, current_user.id)

    if not draft:
        return {"success": True, "data": None}

    return {
        "success": True,
        "data": DraftDetail(
            id=draft.id,
            shop_id=draft.shop_id,
            category_id=draft.category_id,
            form_data=draft.form_data,
            updated_at=draft.updated_at
        ).model_dump()
    }


@router.delete("/drafts/{draft_id}")
async def delete_draft(
    draft_id: int,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """删除草稿"""
    deleted = await DraftTemplateService.delete_draft(db, current_user.id, draft_id)

    if not deleted:
        problem(404, "DRAFT_NOT_FOUND", "Draft not found", "草稿不存在或无权访问")

    return {"success": True}


# ============================
# 模板相关 API
# ============================

@router.post("/templates")
async def create_template(
    request: CreateTemplateRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """创建模板"""
    template = await DraftTemplateService.create_template(
        db=db,
        user_id=current_user.id,
        template_name=request.template_name,
        form_data=request.form_data.model_dump(),
        shop_id=request.shop_id,
        category_id=request.category_id,
        tags=request.tags
    )
    return {
        "success": True,
        "data": {
            "id": template.id,
            "created_at": template.created_at.isoformat()
        }
    }


@router.get("/templates")
async def get_templates(
    shop_id: Optional[int] = Query(None),
    category_id: Optional[int] = Query(None),
    tag: Optional[str] = Query(None, description="筛选包含该标签的模板"),
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """获取模板列表"""
    templates = await DraftTemplateService.get_templates(
        db, current_user.id, shop_id, category_id, tag
    )

    return {
        "success": True,
        "data": [
            TemplateListItem(
                id=t.id,
                template_name=t.template_name,
                shop_id=t.shop_id,
                category_id=t.category_id,
                tags=t.tags,
                used_count=t.used_count or 0,
                last_used_at=t.last_used_at,
                created_at=t.created_at,
                updated_at=t.updated_at
            ).model_dump()
            for t in templates
        ]
    }


@router.get("/templates/{template_id}")
async def get_template(
    template_id: int,
    record_usage: bool = Query(True, description="是否记录使用统计"),
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """获取模板详情"""
    template = await DraftTemplateService.get_template_by_id(
        db, current_user.id, template_id
    )

    if not template:
        problem(404, "TEMPLATE_NOT_FOUND", "Template not found", "模板不存在或无权访问")

    # 记录模板使用（如果启用）
    if record_usage:
        await DraftTemplateService.record_template_usage(db, current_user.id, template_id)
        # 刷新模板对象以获取最新的使用统计
        await db.refresh(template)

    return {
        "success": True,
        "data": TemplateDetail(
            id=template.id,
            template_name=template.template_name,
            shop_id=template.shop_id,
            category_id=template.category_id,
            form_data=template.form_data,
            tags=template.tags,
            used_count=template.used_count or 0,
            last_used_at=template.last_used_at,
            created_at=template.created_at,
            updated_at=template.updated_at
        ).model_dump()
    }


@router.put("/templates/{template_id}")
async def update_template(
    template_id: int,
    request: UpdateTemplateRequest,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """更新模板"""
    template = await DraftTemplateService.update_template(
        db=db,
        user_id=current_user.id,
        template_id=template_id,
        template_name=request.template_name,
        form_data=request.form_data.model_dump() if request.form_data else None,
        tags=request.tags
    )

    if not template:
        problem(404, "TEMPLATE_NOT_FOUND", "Template not found", "模板不存在或无权访问")

    return {
        "success": True,
        "data": {
            "updated_at": template.updated_at.isoformat()
        }
    }


@router.delete("/templates/{template_id}")
async def delete_template(
    template_id: int,
    current_user: User = Depends(get_current_user_flexible),
    db: AsyncSession = Depends(get_async_session)
):
    """删除模板"""
    deleted = await DraftTemplateService.delete_template(
        db, current_user.id, template_id
    )

    if not deleted:
        problem(404, "TEMPLATE_NOT_FOUND", "Template not found", "模板不存在或无权访问")

    return {"success": True}
