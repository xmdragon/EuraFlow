"""
汇率管理 API 路由
遵循约束：API前缀 /api/ef/v1、Problem Details 错误格式
"""
from decimal import Decimal
from typing import Optional
from fastapi import APIRouter, Depends, Query, Body, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.services.exchange_rate_service import ExchangeRateService
from ef_core.services.audit_service import AuditService
from ef_core.utils.logger import get_logger
from ef_core.middleware.auth import require_role
from ef_core.models.users import User

router = APIRouter(prefix="/exchange-rates", tags=["exchange-rates"])
logger = get_logger(__name__)


# ==================== 请求/响应模型 ====================

class ConfigureAPIRequest(BaseModel):
    """配置API请求"""
    api_key: str = Field(..., description="API密钥")
    api_provider: str = Field(default="exchangerate-api", description="服务商")
    base_currency: str = Field(default="CNY", description="基准货币")
    is_enabled: bool = Field(default=True, description="是否启用")


class ConfigureAPIResponse(BaseModel):
    """配置API响应"""
    id: int
    api_provider: str
    is_enabled: bool
    base_currency: str


class GetRateResponse(BaseModel):
    """获取汇率响应"""
    from_currency: str
    to_currency: str
    rate: str  # Decimal转字符串
    cached: bool


class ConvertRequest(BaseModel):
    """货币转换请求"""
    amount: str = Field(..., description="金额（Decimal字符串）")
    from_currency: str = Field(default="CNY", description="源货币")
    to_currency: str = Field(default="RUB", description="目标货币")


class ConvertResponse(BaseModel):
    """货币转换响应"""
    amount: str
    from_currency: str
    to_currency: str
    rate: str
    converted_amount: str


class RateHistoryPoint(BaseModel):
    """汇率历史数据点"""
    time: str
    rate: float


class RateHistoryResponse(BaseModel):
    """汇率历史响应"""
    from_currency: str
    to_currency: str
    time_range: str
    data: list[RateHistoryPoint]


class TestConnectionRequest(BaseModel):
    """测试连接请求"""
    api_key: str = Field(..., description="API密钥")


# ==================== API端点 ====================

@router.post("/config", response_model=ConfigureAPIResponse)
async def configure_api(
    http_request: Request,
    config_data: ConfigureAPIRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    配置汇率API密钥
    """
    service = ExchangeRateService()

    config = await service.configure_api(
        db=db,
        api_key=config_data.api_key,
        api_provider=config_data.api_provider,
        base_currency=config_data.base_currency,
        is_enabled=config_data.is_enabled
    )

    # 记录配置汇率API审计日志
    await AuditService.log_action(
        db=db,
        user_id=current_user.id,
        username=current_user.username,
        module="system",
        action="update",
        action_display="配置汇率API",
        table_name="exchange_rate_configs",
        record_id=str(config.id),
        changes={
            "api_provider": {"new": config_data.api_provider},
            "base_currency": {"new": config_data.base_currency},
            "is_enabled": {"new": config_data.is_enabled},
            "api_key": {"new": "[已脱敏]"},
        },
        ip_address=http_request.client.host if http_request.client else None,
        user_agent=http_request.headers.get("user-agent"),
        request_id=getattr(http_request.state, 'trace_id', None)
    )

    return ConfigureAPIResponse(
        id=config.id,
        api_provider=config.api_provider,
        is_enabled=config.is_enabled,
        base_currency=config.base_currency
    )


@router.get("/config")
async def get_config(db: AsyncSession = Depends(get_async_session)):
    """
    获取汇率API配置（不返回API密钥）
    """
    service = ExchangeRateService()
    config = await service.get_config(db)

    if not config:
        return {
            "configured": False,
            "message": "尚未配置汇率API"
        }

    return {
        "configured": True,
        "api_provider": config.api_provider,
        "is_enabled": config.is_enabled,
        "base_currency": config.base_currency
    }


@router.get("/rate", response_model=GetRateResponse)
async def get_rate(
    from_currency: str = Query(default="CNY", description="源货币"),
    to_currency: str = Query(default="RUB", description="目标货币"),
    force_refresh: bool = Query(default=False, description="是否强制刷新"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取汇率（供其他模块调用）
    """
    service = ExchangeRateService()

    # 先尝试从缓存获取
    cached_rate = await service.get_cached_rate(from_currency, to_currency)
    cached = cached_rate is not None and not force_refresh

    rate = await service.get_rate(db, from_currency, to_currency, force_refresh)

    return GetRateResponse(
        from_currency=from_currency,
        to_currency=to_currency,
        rate=str(rate),
        cached=cached
    )


@router.post("/convert", response_model=ConvertResponse)
async def convert(
    request: ConvertRequest,
    db: AsyncSession = Depends(get_async_session)
):
    """
    货币转换（供其他模块调用）
    """
    service = ExchangeRateService()

    amount = Decimal(request.amount)
    rate = await service.get_rate(db, request.from_currency, request.to_currency)
    converted = await service.convert(db, amount, request.from_currency, request.to_currency)

    return ConvertResponse(
        amount=request.amount,
        from_currency=request.from_currency,
        to_currency=request.to_currency,
        rate=str(rate),
        converted_amount=str(converted)
    )


@router.post("/refresh")
async def refresh_rate(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(require_role("operator"))
):
    """
    手动刷新汇率
    """
    service = ExchangeRateService()
    result = await service.refresh_rates()

    # 记录刷新汇率审计日志
    await AuditService.log_action(
        db=db,
        user_id=current_user.id,
        username=current_user.username,
        module="system",
        action="update",
        action_display="刷新汇率",
        table_name="exchange_rates",
        record_id="manual_refresh",
        changes={
            "success": {"new": result.get("success", False)},
            "rates_count": {"new": len(result.get("rates", {}))},
        },
        ip_address=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
        request_id=getattr(request.state, 'trace_id', None)
    )

    return result


@router.get("/history", response_model=RateHistoryResponse)
async def get_rate_history(
    from_currency: str = Query(default="CNY", description="源货币"),
    to_currency: str = Query(default="RUB", description="目标货币"),
    range: str = Query(default="today", description="时间范围 (today|week|month)"),
    db: AsyncSession = Depends(get_async_session)
):
    """
    获取汇率历史数据（用于趋势图）
    """
    service = ExchangeRateService()
    data = await service.get_rate_history(db, from_currency, to_currency, range)

    return RateHistoryResponse(
        from_currency=from_currency,
        to_currency=to_currency,
        time_range=range,
        data=[RateHistoryPoint(**point) for point in data]
    )


@router.post("/test-connection")
async def test_connection(
    request: TestConnectionRequest,
    current_user: User = Depends(require_role("operator"))
):
    """
    测试API连接
    """
    service = ExchangeRateService()
    result = await service.test_connection(request.api_key)
    return result
