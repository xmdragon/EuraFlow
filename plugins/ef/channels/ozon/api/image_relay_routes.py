"""
图片中转 API 路由
用于浏览器扩展将 OZON CDN 图片中转上传到图床
"""

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
import logging

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ef_core.database import get_async_session
from ef_core.api.auth import get_current_user_from_api_key
from ef_core.models.users import User

from ..models.global_settings import OzonGlobalSetting
from ..services.image_relay_service import ImageRelayService

router = APIRouter(prefix="/image-relay", tags=["Image Relay"])
logger = logging.getLogger(__name__)


# ========== DTO ==========

class ImageRelayItem(BaseModel):
    """单个图片中转请求项"""
    url: str = Field(..., description="原始图片 URL")
    data: str = Field(..., description="Base64 编码的图片数据（可包含 data URL 前缀）")


class BatchRelayRequest(BaseModel):
    """批量中转请求"""
    shop_id: int = Field(..., description="店铺 ID")
    images: List[ImageRelayItem] = Field(..., min_length=1, max_length=50, description="图片列表（最多50张）")


class RelayResultItem(BaseModel):
    """单个图片中转结果"""
    original_url: str = Field(..., description="原始图片 URL")
    staged_url: Optional[str] = Field(None, description="图床 URL（成功时返回）")
    success: bool = Field(..., description="是否成功")
    error: Optional[str] = Field(None, description="错误信息（失败时返回）")


class BatchRelayResponse(BaseModel):
    """批量中转响应"""
    results: List[RelayResultItem] = Field(..., description="各图片处理结果")
    mapping: Dict[str, str] = Field(..., description="成功的 URL 映射 {原始URL: 图床URL}")
    success_count: int = Field(..., description="成功数量")
    failed_count: int = Field(..., description="失败数量")


class RelayConfigResponse(BaseModel):
    """中转配置响应"""
    enabled: bool = Field(..., description="是否启用图片中转")
    max_size_mb: int = Field(default=10, description="单张图片最大大小（MB）")
    max_batch_size: int = Field(default=50, description="单次批量上传最大数量")


# ========== API 端点 ==========

@router.get("/config", response_model=RelayConfigResponse)
async def get_relay_config(
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    获取图片中转配置

    浏览器扩展调用此接口检查是否需要启用图片中转功能。

    Returns:
        {
            "enabled": true/false,
            "max_size_mb": 10,
            "max_batch_size": 50
        }
    """
    try:
        # 从全局配置获取
        result = await db.execute(
            select(OzonGlobalSetting).where(
                OzonGlobalSetting.setting_key == "image_relay_enabled"
            )
        )
        setting = result.scalar_one_or_none()

        if setting and setting.setting_value:
            config = setting.setting_value
            return RelayConfigResponse(
                enabled=config.get("enabled", False),
                max_size_mb=config.get("max_size_mb", 10),
                max_batch_size=config.get("max_batch_size", 50)
            )

        # 默认关闭
        return RelayConfigResponse(enabled=False, max_size_mb=10, max_batch_size=50)

    except Exception as e:
        logger.error(f"获取图片中转配置失败: {e}", exc_info=True)
        # 出错时返回默认关闭
        return RelayConfigResponse(enabled=False, max_size_mb=10, max_batch_size=50)


@router.post("/batch")
async def batch_relay_images(
    request: BatchRelayRequest,
    db: AsyncSession = Depends(get_async_session),
    user: User = Depends(get_current_user_from_api_key)
):
    """
    批量中转图片

    浏览器扩展下载 OZON CDN 图片后，将 Base64 数据上传到此接口。
    接口会将图片上传到配置的图床（Cloudinary 或 阿里云 OSS），返回图床 URL。

    Request:
    ```json
    {
        "shop_id": 1,
        "images": [
            {
                "url": "https://cdn.ozone.ru/xxx.jpg",
                "data": "data:image/jpeg;base64,/9j/4AAQ..."
            }
        ]
    }
    ```

    Response:
    ```json
    {
        "ok": true,
        "data": {
            "results": [...],
            "mapping": {"原始URL": "图床URL"},
            "success_count": 5,
            "failed_count": 1
        }
    }
    ```
    """
    try:
        logger.info(f"批量中转图片请求: shop_id={request.shop_id}, count={len(request.images)}, user_id={user.id}")

        # 检查是否启用
        config_result = await db.execute(
            select(OzonGlobalSetting).where(
                OzonGlobalSetting.setting_key == "image_relay_enabled"
            )
        )
        config_setting = config_result.scalar_one_or_none()

        if not config_setting or not config_setting.setting_value.get("enabled", False):
            logger.warning("图片中转功能未启用")
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "图片中转未启用",
                    "status": 400,
                    "detail": "图片中转功能未启用，请联系管理员",
                    "code": "IMAGE_RELAY_DISABLED"
                }
            )

        # 检查批量大小
        max_batch_size = config_setting.setting_value.get("max_batch_size", 50)
        if len(request.images) > max_batch_size:
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "批量大小超限",
                    "status": 400,
                    "detail": f"单次最多上传 {max_batch_size} 张图片，当前 {len(request.images)} 张",
                    "code": "BATCH_SIZE_EXCEEDED"
                }
            )

        # 执行中转
        service = ImageRelayService()
        result = await service.batch_relay_images(
            db=db,
            images=[{"url": img.url, "data": img.data} for img in request.images],
            shop_id=request.shop_id
        )

        logger.info(f"批量中转完成: success={result['success_count']}, failed={result['failed_count']}")

        return {
            "ok": True,
            "data": result
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"批量中转图片失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "图片中转失败",
                "status": 500,
                "detail": str(e),
                "code": "IMAGE_RELAY_ERROR"
            }
        )
