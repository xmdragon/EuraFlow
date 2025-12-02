"""
自动采集地址管理路由
"""
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, case, func, and_, or_
from typing import Optional
from pydantic import BaseModel, Field, field_validator
import logging
import re

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from ..models.collection_source import OzonCollectionSource

router = APIRouter(prefix="/collection-sources", tags=["Collection Sources"])
logger = logging.getLogger(__name__)


def problem(status: int, code: str, title: str, detail: str | None = None):
    """抛出 Problem Details 格式的错误"""
    raise HTTPException(status_code=status, detail={
        "type": "about:blank",
        "title": title,
        "status": status,
        "detail": detail,
        "code": code
    })


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


def parse_ozon_url(url: str) -> tuple[str, str]:
    """解析 OZON URL，返回 (source_type, source_path)

    Args:
        url: OZON URL

    Returns:
        (source_type, source_path) 元组

    Raises:
        ValueError: 如果 URL 格式不正确
    """
    parsed = urlparse(url)

    # 验证域名
    if not parsed.netloc.endswith('ozon.ru'):
        raise ValueError("URL 必须是 ozon.ru 域名")

    path = parsed.path.rstrip('/')

    # 禁止单个商品页面
    if '/product/' in path:
        raise ValueError("不支持单个商品页面，请使用类目、店铺或专题页面")

    # 判断类型
    if '/category/' in path:
        source_type = 'category'
        # 提取类目路径，例如 /category/elektronika-15500
        match = re.search(r'(/category/[^/]+)', path)
        if match:
            source_path = match.group(1)
        else:
            source_path = path
    elif '/seller/' in path:
        source_type = 'seller'
        # 提取店铺路径，例如 /seller/store-123456
        match = re.search(r'(/seller/[^/]+)', path)
        if match:
            source_path = match.group(1)
        else:
            source_path = path
    elif '/highlight/' in path:
        source_type = 'highlight'
        # 提取专题路径，例如 /highlight/tovary-iz-kitaya-935133
        match = re.search(r'(/highlight/[^/]+)', path)
        if match:
            source_path = match.group(1)
        else:
            source_path = path
    else:
        # 其他页面类型（如搜索结果等）
        source_type = 'other'
        source_path = path if path else '/'

    return source_type, source_path


# ============================
# Pydantic Schema 定义
# ============================

class CreateSourceRequest(BaseModel):
    """创建采集地址请求"""
    source_url: str = Field(..., description="OZON 类目或店铺 URL")
    display_name: Optional[str] = Field(None, description="显示名称（可选）")
    priority: int = Field(0, description="优先级（数值越高越优先）")
    target_count: int = Field(100, ge=1, le=1000, description="目标采集数量")
    is_enabled: bool = Field(True, description="是否启用")

    @field_validator('source_url')
    @classmethod
    def validate_url(cls, v):
        try:
            parse_ozon_url(v)
        except ValueError as e:
            raise ValueError(str(e))
        return v


class UpdateSourceRequest(BaseModel):
    """更新采集地址请求"""
    source_url: Optional[str] = Field(None, description="OZON 类目或店铺 URL")
    display_name: Optional[str] = Field(None, description="显示名称")
    priority: Optional[int] = Field(None, description="优先级")
    target_count: Optional[int] = Field(None, ge=1, le=1000, description="目标采集数量")
    is_enabled: Optional[bool] = Field(None, description="是否启用")

    @field_validator('source_url')
    @classmethod
    def validate_url(cls, v):
        if v is not None:
            try:
                parse_ozon_url(v)
            except ValueError as e:
                raise ValueError(str(e))
        return v


class UpdateStatusRequest(BaseModel):
    """更新采集状态请求（插件调用）"""
    status: str = Field(..., description="状态：collecting | completed | failed")
    product_count: Optional[int] = Field(None, ge=0, description="采集的商品数量")
    error_message: Optional[str] = Field(None, description="错误信息")

    @field_validator('status')
    @classmethod
    def validate_status(cls, v):
        if v not in ('collecting', 'completed', 'failed'):
            raise ValueError("状态必须是 collecting、completed 或 failed")
        return v


class BatchDeleteRequest(BaseModel):
    """批量删除请求"""
    ids: list[int] = Field(..., description="ID 列表")


class SourceResponse(BaseModel):
    """采集地址响应"""
    id: int
    source_type: str
    source_url: str
    source_path: str
    display_name: Optional[str]
    is_enabled: bool
    priority: int
    target_count: int
    status: str
    last_collected_at: Optional[str]
    last_product_count: int
    total_collected_count: int
    last_error: Optional[str]
    error_count: int
    created_at: str
    updated_at: str


# ============================
# API 端点
# ============================

@router.get("")
async def get_sources(
    page: int = Query(1, ge=1, description="页码"),
    page_size: int = Query(20, ge=1, le=100, description="每页数量"),
    is_enabled: Optional[bool] = Query(None, description="是否启用"),
    status: Optional[str] = Query(None, description="状态筛选"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """获取采集地址列表"""
    # 构建查询条件
    conditions = [OzonCollectionSource.user_id == current_user.id]

    if is_enabled is not None:
        conditions.append(OzonCollectionSource.is_enabled == is_enabled)

    if status:
        conditions.append(OzonCollectionSource.status == status)

    # 查询总数
    count_query = select(func.count()).select_from(OzonCollectionSource).where(and_(*conditions))
    total = (await db.execute(count_query)).scalar() or 0

    # 查询数据
    query = (
        select(OzonCollectionSource)
        .where(and_(*conditions))
        .order_by(
            OzonCollectionSource.priority.desc(),
            OzonCollectionSource.created_at.desc()
        )
        .offset((page - 1) * page_size)
        .limit(page_size)
    )

    result = await db.execute(query)
    sources = result.scalars().all()

    items = [
        {
            "id": s.id,
            "source_type": s.source_type,
            "source_url": s.source_url,
            "source_path": s.source_path,
            "display_name": s.display_name,
            "is_enabled": s.is_enabled,
            "priority": s.priority,
            "target_count": s.target_count,
            "status": s.status,
            "last_collected_at": s.last_collected_at.isoformat() if s.last_collected_at else None,
            "last_product_count": s.last_product_count,
            "total_collected_count": s.total_collected_count,
            "last_error": s.last_error,
            "error_count": s.error_count,
            "created_at": s.created_at.isoformat(),
            "updated_at": s.updated_at.isoformat()
        }
        for s in sources
    ]

    return {
        "ok": True,
        "data": {
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size
        }
    }


@router.post("")
async def create_source(
    request: CreateSourceRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """创建采集地址"""
    # 解析 URL
    source_type, source_path = parse_ozon_url(request.source_url)

    # 检查是否已存在
    existing = await db.execute(
        select(OzonCollectionSource).where(
            OzonCollectionSource.user_id == current_user.id,
            OzonCollectionSource.source_path == source_path
        )
    )
    if existing.scalar_one_or_none():
        problem(
            status=409,
            code="SOURCE_EXISTS",
            title="Source Already Exists",
            detail=f"该采集地址已存在: {source_path}"
        )

    # 创建记录
    source = OzonCollectionSource(
        user_id=current_user.id,
        source_type=source_type,
        source_url=request.source_url,
        source_path=source_path,
        display_name=request.display_name,
        is_enabled=request.is_enabled,
        priority=request.priority,
        target_count=request.target_count,
        status='pending'
    )

    db.add(source)
    await db.commit()
    await db.refresh(source)

    logger.info(f"Created collection source: {source.id} ({source_path})")

    return {
        "ok": True,
        "data": {
            "id": source.id,
            "source_type": source_type,
            "source_path": source_path,
            "message": "采集地址创建成功"
        }
    }


@router.put("/{source_id}")
async def update_source(
    source_id: int,
    request: UpdateSourceRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """更新采集地址"""
    # 查询记录
    result = await db.execute(
        select(OzonCollectionSource).where(
            OzonCollectionSource.id == source_id,
            OzonCollectionSource.user_id == current_user.id
        )
    )
    source = result.scalar_one_or_none()

    if not source:
        problem(
            status=404,
            code="SOURCE_NOT_FOUND",
            title="Source Not Found",
            detail=f"采集地址不存在: {source_id}"
        )

    # 更新字段
    if request.source_url is not None:
        source_type, source_path = parse_ozon_url(request.source_url)
        source.source_url = request.source_url
        source.source_type = source_type
        source.source_path = source_path

    if request.display_name is not None:
        source.display_name = request.display_name

    if request.priority is not None:
        source.priority = request.priority

    if request.target_count is not None:
        source.target_count = request.target_count

    if request.is_enabled is not None:
        source.is_enabled = request.is_enabled

    await db.commit()
    await db.refresh(source)

    return {
        "ok": True,
        "data": {
            "id": source.id,
            "message": "采集地址更新成功"
        }
    }


@router.delete("/{source_id}")
async def delete_source(
    source_id: int,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """删除采集地址"""
    result = await db.execute(
        select(OzonCollectionSource).where(
            OzonCollectionSource.id == source_id,
            OzonCollectionSource.user_id == current_user.id
        )
    )
    source = result.scalar_one_or_none()

    if not source:
        problem(
            status=404,
            code="SOURCE_NOT_FOUND",
            title="Source Not Found",
            detail=f"采集地址不存在: {source_id}"
        )

    await db.delete(source)
    await db.commit()

    return {
        "ok": True,
        "data": {
            "message": "采集地址删除成功"
        }
    }


@router.post("/batch-delete")
async def batch_delete_sources(
    request: BatchDeleteRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """批量删除采集地址"""
    deleted_count = 0
    failed_ids = []

    for source_id in request.ids:
        result = await db.execute(
            select(OzonCollectionSource).where(
                OzonCollectionSource.id == source_id,
                OzonCollectionSource.user_id == current_user.id
            )
        )
        source = result.scalar_one_or_none()

        if source:
            await db.delete(source)
            deleted_count += 1
        else:
            failed_ids.append(source_id)

    await db.commit()

    return {
        "ok": True,
        "data": {
            "deleted_count": deleted_count,
            "failed_count": len(failed_ids),
            "failed_ids": failed_ids
        }
    }


@router.get("/queue")
async def get_collection_queue(
    limit: int = Query(10, ge=1, le=50, description="获取数量"),
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """获取待采集地址队列（插件专用）

    排序规则：
    1. 优先级高的排前面
    2. 超过7天未采集的优先
    3. 从未采集的最优先
    4. 上次采集时间升序
    """
    one_week_ago = utcnow() - timedelta(days=7)

    query = (
        select(OzonCollectionSource)
        .where(
            OzonCollectionSource.user_id == current_user.id,
            OzonCollectionSource.is_enabled == True,  # noqa: E712
            OzonCollectionSource.status.in_(['pending', 'completed', 'failed'])
        )
        .order_by(
            # 优先级降序
            OzonCollectionSource.priority.desc(),
            # 超过7天未采集的优先（NULL 视为从未采集，最优先）
            case(
                (OzonCollectionSource.last_collected_at == None, 0),  # noqa: E711
                (OzonCollectionSource.last_collected_at < one_week_ago, 1),
                else_=2
            ),
            # 上次采集时间升序（从未采集的排前面）
            OzonCollectionSource.last_collected_at.asc().nullsfirst()
        )
        .limit(limit)
    )

    result = await db.execute(query)
    sources = result.scalars().all()

    items = [
        {
            "id": s.id,
            "source_type": s.source_type,
            "source_url": s.source_url,
            "source_path": s.source_path,
            "display_name": s.display_name,
            "priority": s.priority,
            "target_count": s.target_count,
            "last_collected_at": s.last_collected_at.isoformat() if s.last_collected_at else None
        }
        for s in sources
    ]

    return {
        "ok": True,
        "data": {
            "items": items,
            "count": len(items)
        }
    }


@router.get("/queue/next")
async def get_next_collection_source(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """获取下一个待采集地址（插件专用）

    返回优先级最高的一个待采集地址
    规则：
    1. 排除一周内采集过的（last_collected_at >= 7天前）
    2. 从未采集的优先（last_collected_at IS NULL）
    3. 按优先级降序
    4. 按上次采集时间升序（越久没采集越优先）
    """
    one_week_ago = utcnow() - timedelta(days=7)

    query = (
        select(OzonCollectionSource)
        .where(
            OzonCollectionSource.user_id == current_user.id,
            OzonCollectionSource.is_enabled == True,  # noqa: E712
            OzonCollectionSource.status.in_(['pending', 'completed', 'failed']),
            # 排除一周内采集过的记录（从未采集的 NULL 会通过）
            or_(
                OzonCollectionSource.last_collected_at == None,  # noqa: E711
                OzonCollectionSource.last_collected_at < one_week_ago
            )
        )
        .order_by(
            # 优先级降序
            OzonCollectionSource.priority.desc(),
            # 从未采集的优先（NULL 排最前）
            case(
                (OzonCollectionSource.last_collected_at == None, 0),  # noqa: E711
                else_=1
            ),
            # 上次采集时间升序（越久没采集越优先）
            OzonCollectionSource.last_collected_at.asc().nullsfirst()
        )
        .limit(1)
    )

    result = await db.execute(query)
    source = result.scalar_one_or_none()

    if not source:
        return {
            "ok": True,
            "data": None
        }

    return {
        "ok": True,
        "data": {
            "id": source.id,
            "source_type": source.source_type,
            "source_url": source.source_url,
            "source_path": source.source_path,
            "display_name": source.display_name,
            "priority": source.priority,
            "target_count": source.target_count,
            "last_collected_at": source.last_collected_at.isoformat() if source.last_collected_at else None
        }
    }


@router.put("/{source_id}/status")
async def update_source_status(
    source_id: int,
    request: UpdateStatusRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible)
):
    """更新采集状态（插件调用）"""
    result = await db.execute(
        select(OzonCollectionSource).where(
            OzonCollectionSource.id == source_id,
            OzonCollectionSource.user_id == current_user.id
        )
    )
    source = result.scalar_one_or_none()

    if not source:
        problem(
            status=404,
            code="SOURCE_NOT_FOUND",
            title="Source Not Found",
            detail=f"采集地址不存在: {source_id}"
        )

    # 更新状态
    source.status = request.status

    if request.status == 'collecting':
        # 开始采集：清除错误信息
        source.last_error = None

    elif request.status == 'completed':
        # 采集完成：更新统计
        source.last_collected_at = utcnow()
        if request.product_count is not None:
            source.last_product_count = request.product_count
            source.total_collected_count += request.product_count
        source.error_count = 0
        source.last_error = None

    elif request.status == 'failed':
        # 采集失败：记录错误
        source.error_count += 1
        if request.error_message:
            source.last_error = request.error_message

    await db.commit()
    await db.refresh(source)

    return {
        "ok": True,
        "data": {
            "id": source.id,
            "status": source.status,
            "message": "状态更新成功"
        }
    }
