"""
Ozon全局设置API路由
"""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional
import logging
import re

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.api.auth import get_current_user_flexible
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, desc

from plugins.ef.channels.ozon.models.global_settings import OzonGlobalSetting
from plugins.ef.channels.ozon.models.ozon_shops import OzonShop
from plugins.ef.channels.ozon.models.orders import OzonPosting
from plugins.ef.channels.ozon.models.products import OzonProduct

router = APIRouter(prefix="/global-settings", tags=["Ozon Global Settings"])
logger = logging.getLogger(__name__)


# === DTO ===

class GlobalSettingResponse(BaseModel):
    """全局设置响应"""
    setting_key: str
    setting_value: Dict[str, Any]
    description: str | None = None

    model_config = {
        "json_schema_extra": {
            "example": {
                "setting_key": "api_rate_limit",
                "setting_value": {"value": 50, "unit": "req/s"},
                "description": "API限流：每秒发送API请求上限"
            }
        }
    }


class GlobalSettingUpdateRequest(BaseModel):
    """更新全局设置请求"""
    setting_value: Dict[str, Any] = Field(..., description="设置值（JSONB格式）")

    model_config = {
        "json_schema_extra": {
            "example": {
                "setting_value": {"value": 100, "unit": "req/s"}
            }
        }
    }


class GlobalSettingsListResponse(BaseModel):
    """全局设置列表响应"""
    settings: Dict[str, GlobalSettingResponse]


class TestImageResponse(BaseModel):
    """测试图片响应"""
    image_url: Optional[str] = None
    original_cdn: Optional[str] = None
    error: Optional[str] = None


# === API端点 ===

@router.get(
    "",
    response_model=GlobalSettingsListResponse,
    summary="获取所有全局设置"
)
async def get_global_settings(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取所有全局设置

    权限：所有登录用户
    """
    # 查询所有全局设置
    result = await db.execute(select(OzonGlobalSetting))
    settings = result.scalars().all()

    # 转换为字典格式
    settings_dict = {}
    for setting in settings:
        settings_dict[setting.setting_key] = GlobalSettingResponse(
            setting_key=setting.setting_key,
            setting_value=setting.setting_value,
            description=setting.description
        )

    return GlobalSettingsListResponse(settings=settings_dict)


@router.get(
    "/test-image",
    response_model=TestImageResponse,
    summary="获取测试图片URL"
)
async def get_test_image(
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取测试图片URL（用于CDN速度测试）

    从最新订单的商品SKU关联商品表获取图片，确保图片有效

    权限：所有登录用户
    """
    # 1. 获取第一个店铺
    shop_result = await db.execute(
        select(OzonShop).where(OzonShop.status == "active").limit(1)
    )
    shop = shop_result.scalar_one_or_none()

    if not shop:
        return TestImageResponse(error="没有可用的店铺")

    # 2. 获取该店铺最新订单
    posting_result = await db.execute(
        select(OzonPosting)
        .where(OzonPosting.shop_id == shop.id)
        .where(OzonPosting.raw_payload.isnot(None))
        .order_by(desc(OzonPosting.created_at))
        .limit(20)
    )
    postings = posting_result.scalars().all()

    if not postings:
        return TestImageResponse(error="该店铺没有订单数据")

    # 3. 遍历订单，通过SKU关联商品表获取有效图片
    image_url = None
    for posting in postings:
        raw_payload = posting.raw_payload
        if not raw_payload:
            continue

        products = raw_payload.get("products", [])
        for product in products:
            sku = product.get("sku")
            if not sku:
                continue

            # 通过SKU查询商品表获取图片
            product_result = await db.execute(
                select(OzonProduct)
                .where(OzonProduct.ozon_sku == int(sku))
                .where(OzonProduct.primary_image.isnot(None))
            )
            ozon_product = product_result.scalar_one_or_none()

            if ozon_product and ozon_product.primary_image:
                img = ozon_product.primary_image
                if "/s3/multimedia-" in img:
                    image_url = img
                    break

        if image_url:
            break

    if not image_url:
        return TestImageResponse(error="未找到包含图片的商品")

    # 4. 提取原始 CDN 域名
    original_cdn = None
    cdn_match = re.search(r"https?://([^/]+)", image_url)
    if cdn_match:
        original_cdn = cdn_match.group(1)

    return TestImageResponse(
        image_url=image_url,
        original_cdn=original_cdn
    )


@router.get(
    "/{setting_key}",
    response_model=GlobalSettingResponse,
    summary="获取指定全局设置"
)
async def get_global_setting(
    setting_key: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    获取指定的全局设置

    参数：
    - setting_key: 设置键（如：api_rate_limit）

    权限：所有登录用户
    """
    # 查询指定设置
    result = await db.execute(
        select(OzonGlobalSetting).where(OzonGlobalSetting.setting_key == setting_key)
    )
    setting = result.scalar_one_or_none()

    if not setting:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "type": "about:blank",
                "title": "Setting not found",
                "status": 404,
                "detail": f"Global setting '{setting_key}' does not exist",
                "code": "SETTING_NOT_FOUND"
            }
        )

    return GlobalSettingResponse(
        setting_key=setting.setting_key,
        setting_value=setting.setting_value,
        description=setting.description
    )


@router.put(
    "/{setting_key}",
    response_model=GlobalSettingResponse,
    summary="更新全局设置（仅管理员）"
)
async def update_global_setting(
    setting_key: str,
    request: GlobalSettingUpdateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: User = Depends(get_current_user_flexible),
):
    """
    更新指定的全局设置

    参数：
    - setting_key: 设置键（如：api_rate_limit）
    - request: 更新请求（包含新的设置值）

    权限：仅管理员
    """
    # 权限检查：仅管理员可修改
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "type": "about:blank",
                "title": "Permission denied",
                "status": 403,
                "detail": "Only administrators can modify global settings",
                "code": "PERMISSION_DENIED"
            }
        )

    # 查询指定设置
    result = await db.execute(
        select(OzonGlobalSetting).where(OzonGlobalSetting.setting_key == setting_key)
    )
    setting = result.scalar_one_or_none()

    # 如果设置不存在，自动创建（upsert 模式）
    if not setting:
        setting = OzonGlobalSetting(
            setting_key=setting_key,
            setting_value=request.setting_value,
            description=f"Auto-created setting: {setting_key}",
        )
        db.add(setting)
        await db.commit()
        await db.refresh(setting)

        logger.info(
            f"Global setting created",
            extra={
                "setting_key": setting_key,
                "new_value": request.setting_value,
                "user_id": current_user.id
            }
        )

        return GlobalSettingResponse(
            setting_key=setting.setting_key,
            setting_value=setting.setting_value,
            description=setting.description
        )

    # 更新设置值
    setting.setting_value = request.setting_value

    # 提交事务
    await db.commit()
    await db.refresh(setting)

    # 如果更新的是时区设置，清除时区缓存
    if setting_key == "default_timezone":
        from plugins.ef.channels.ozon.utils.datetime_utils import invalidate_timezone_cache
        invalidate_timezone_cache()

    logger.info(
        f"Global setting updated",
        extra={
            "setting_key": setting_key,
            "new_value": request.setting_value,
            "user_id": current_user.id
        }
    )

    return GlobalSettingResponse(
        setting_key=setting.setting_key,
        setting_value=setting.setting_value,
        description=setting.description
    )
