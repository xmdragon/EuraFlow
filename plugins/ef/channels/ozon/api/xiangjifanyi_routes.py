"""象寄图片API路由"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from datetime import datetime
import logging
import httpx

from ef_core.api.auth import get_current_user
from ef_core.models.users import User
from ef_core.database import get_db_manager
from ..models.xiangjifanyi import XiangjifanyiConfig
from ..services.xiangjifanyi_service import XiangjifanyiService

router = APIRouter(prefix="/xiangjifanyi", tags=["xiangjifanyi"])
logger = logging.getLogger(__name__)


class XiangjifanyiConfigRequest(BaseModel):
    """象寄图片配置请求"""
    phone: Optional[str] = Field(None, description="手机号")
    password: Optional[str] = Field(None, description="密码")
    api_url: Optional[str] = Field(None, description="API地址")
    user_key: Optional[str] = Field(None, description="私人密钥")
    video_trans_key: Optional[str] = Field(None, description="视频翻译密钥")
    fetch_key: Optional[str] = Field(None, description="商品解析密钥")
    img_trans_key_ali: Optional[str] = Field(None, description="图片翻译-阿里标识码")
    img_trans_key_google: Optional[str] = Field(None, description="图片翻译-谷歌标识码")
    img_trans_key_papago: Optional[str] = Field(None, description="图片翻译-Papago标识码")
    img_trans_key_deepl: Optional[str] = Field(None, description="图片翻译-DeepL标识码")
    img_trans_key_chatgpt: Optional[str] = Field(None, description="图片翻译-ChatGPT标识码")
    img_trans_key_baidu: Optional[str] = Field(None, description="图片翻译-百度标识码")
    img_matting_key: Optional[str] = Field(None, description="智能抠图密钥")
    text_trans_key: Optional[str] = Field(None, description="文本翻译密钥")
    aigc_key: Optional[str] = Field(None, description="智能生成密钥")
    enabled: bool = Field(default=False, description="是否启用")


class XiangjifanyiConfigResponse(BaseModel):
    """象寄图片配置响应"""
    id: int
    phone: Optional[str]
    api_url: Optional[str]
    enabled: bool
    last_test_at: Optional[datetime]
    last_test_success: Optional[bool]
    created_at: datetime
    updated_at: datetime


@router.get("/config")
async def get_xiangjifanyi_config(
    user: User = Depends(get_current_user)
) -> dict:
    """获取象寄图片配置"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        stmt = select(XiangjifanyiConfig).where(XiangjifanyiConfig.id == 1)
        config = await session.scalar(stmt)

        if not config:
            return {"ok": True, "data": None}

        return {
            "ok": True,
            "data": {
                "id": config.id,
                "phone": config.phone,
                "api_url": config.api_url,
                "enabled": config.enabled,
                "last_test_at": config.last_test_at,
                "last_test_success": config.last_test_success,
                "created_at": config.created_at,
                "updated_at": config.updated_at
            }
        }


@router.post("/config")
async def save_xiangjifanyi_config(
    request: XiangjifanyiConfigRequest,
    user: User = Depends(get_current_user)
) -> dict:
    """保存或更新象寄图片配置"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        stmt = select(XiangjifanyiConfig).where(XiangjifanyiConfig.id == 1)
        config = await session.scalar(stmt)

        if config:
            # 更新现有配置
            if request.phone is not None:
                config.phone = request.phone
            if request.password:  # 只在提供了新密码时才更新
                config.password = request.password  # TODO: 加密
            if request.api_url is not None:
                config.api_url = request.api_url
            if request.user_key:  # 只在提供了新密钥时才更新
                config.user_key = request.user_key  # TODO: 加密
            if request.video_trans_key:
                config.video_trans_key = request.video_trans_key  # TODO: 加密
            if request.fetch_key:
                config.fetch_key = request.fetch_key  # TODO: 加密
            if request.img_trans_key_ali:
                config.img_trans_key_ali = request.img_trans_key_ali  # TODO: 加密
            if request.img_trans_key_google:
                config.img_trans_key_google = request.img_trans_key_google  # TODO: 加密
            if request.img_trans_key_papago:
                config.img_trans_key_papago = request.img_trans_key_papago  # TODO: 加密
            if request.img_trans_key_deepl:
                config.img_trans_key_deepl = request.img_trans_key_deepl  # TODO: 加密
            if request.img_trans_key_chatgpt:
                config.img_trans_key_chatgpt = request.img_trans_key_chatgpt  # TODO: 加密
            if request.img_trans_key_baidu:
                config.img_trans_key_baidu = request.img_trans_key_baidu  # TODO: 加密
            if request.img_matting_key:
                config.img_matting_key = request.img_matting_key  # TODO: 加密
            if request.text_trans_key:
                config.text_trans_key = request.text_trans_key  # TODO: 加密
            if request.aigc_key:
                config.aigc_key = request.aigc_key  # TODO: 加密
            config.enabled = request.enabled
        else:
            # 创建新配置
            config = XiangjifanyiConfig(
                id=1,
                phone=request.phone,
                password=request.password,  # TODO: 加密
                api_url=request.api_url,
                user_key=request.user_key,  # TODO: 加密
                video_trans_key=request.video_trans_key,  # TODO: 加密
                fetch_key=request.fetch_key,  # TODO: 加密
                img_trans_key_ali=request.img_trans_key_ali,  # TODO: 加密
                img_trans_key_google=request.img_trans_key_google,  # TODO: 加密
                img_trans_key_papago=request.img_trans_key_papago,  # TODO: 加密
                img_trans_key_deepl=request.img_trans_key_deepl,  # TODO: 加密
                img_trans_key_chatgpt=request.img_trans_key_chatgpt,  # TODO: 加密
                img_trans_key_baidu=request.img_trans_key_baidu,  # TODO: 加密
                img_matting_key=request.img_matting_key,  # TODO: 加密
                text_trans_key=request.text_trans_key,  # TODO: 加密
                aigc_key=request.aigc_key,  # TODO: 加密
                enabled=request.enabled
            )
            session.add(config)

        await session.commit()
        await session.refresh(config)

        return {
            "ok": True,
            "data": {
                "id": config.id,
                "phone": config.phone,
                "api_url": config.api_url,
                "enabled": config.enabled
            }
        }


@router.post("/config/test")
async def test_xiangjifanyi_connection(
    user: User = Depends(get_current_user)
) -> dict:
    """测试象寄图片服务连接"""
    try:
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(XiangjifanyiConfig).where(XiangjifanyiConfig.id == 1)
            config = await session.scalar(stmt)

            if not config:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "type": "about:blank",
                        "title": "Configuration Not Found",
                        "status": 400,
                        "detail": "请先配置象寄图片服务",
                        "code": "CONFIG_NOT_FOUND"
                    }
                )

            if not config.phone or not config.password:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "type": "about:blank",
                        "title": "Invalid Configuration",
                        "status": 400,
                        "detail": "请先配置手机号和密码",
                        "code": "INVALID_CONFIG"
                    }
                )

            # 调用登录 API 测试连接
            success = False
            error_message = None

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    response = await client.post(
                        "https://www.xiangjifanyi.com/open/user/login",
                        json={
                            "phone": config.phone,
                            "passwd": config.password
                        }
                    )

                    result = response.json()

                    # 检查返回的 code 是否为 0 或 "0"（成功）
                    code = result.get("code")
                    if code == 0 or code == "0":
                        success = True
                    else:
                        error_message = result.get("msg", "登录失败")

            except httpx.TimeoutException:
                error_message = "连接超时"
            except httpx.RequestError as e:
                error_message = f"请求失败: {str(e)}"
            except Exception as e:
                error_message = f"未知错误: {str(e)}"

            # 更新测试结果
            from ..utils.datetime_utils import utcnow
            config.last_test_at = utcnow()
            config.last_test_success = success
            await session.commit()

            if success:
                return {"ok": True, "data": {"message": "连接测试成功"}}
            else:
                raise HTTPException(
                    status_code=500,
                    detail={
                        "type": "about:blank",
                        "title": "Connection Test Failed",
                        "status": 500,
                        "detail": f"连接测试失败: {error_message}",
                        "code": "CONNECTION_TEST_FAILED"
                    }
                )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"测试象寄图片服务连接失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


class TranslateSingleImageRequest(BaseModel):
    """单张图片翻译请求"""
    image_url: str = Field(..., description="图片URL（Cloudinary地址）")
    engine_type: Optional[int] = Field(None, description="翻译引擎（None=阿里，5=ChatGPT）")
    source_language: str = Field("CHS", description="源语言")
    target_language: str = Field("RUS", description="目标语言")


class TranslateBatchImagesRequest(BaseModel):
    """批量图片翻译请求"""
    image_urls: List[str] = Field(..., description="图片URL列表")
    engine_type: Optional[int] = Field(None, description="翻译引擎（None=阿里，5=ChatGPT）")
    source_language: str = Field("CHS", description="源语言")
    target_language: str = Field("RUS", description="目标语言")


@router.post("/translate-single")
async def translate_single_image(
    request: TranslateSingleImageRequest,
    user: User = Depends(get_current_user)
) -> dict:
    """单张图片翻译"""
    print(f"🔍 [BACKEND] translate_single_image 被调用: image_url={request.image_url}, engine_type={request.engine_type}")
    logger.info(f"translate_single_image 被调用: image_url={request.image_url}, engine_type={request.engine_type}")
    try:
        service = XiangjifanyiService()
        result = await service.translate_single_image(
            image_url=request.image_url,
            source_lang=request.source_language,
            target_lang=request.target_language,
            engine_type=request.engine_type,
            need_watermark=0,
            need_rm_url=0,
            qos="BestQuality",
            product_text_protect=1
        )

        if result["success"]:
            return {
                "ok": True,
                "data": {
                    "url": result["url"],
                    "request_id": result.get("request_id"),
                    "original_url": request.image_url
                }
            }
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "Translation Failed",
                    "status": 400,
                    "detail": result.get("error", "翻译失败"),
                    "code": "TRANSLATION_FAILED"
                }
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"单张图片翻译失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.post("/translate-batch")
async def translate_batch_images(
    request: TranslateBatchImagesRequest,
    user: User = Depends(get_current_user)
) -> dict:
    """批量图片翻译（异步模式）"""
    try:
        service = XiangjifanyiService()
        result = await service.translate_batch_images(
            image_urls=request.image_urls,
            source_lang=request.source_language,
            target_lang=request.target_language,
            engine_type=request.engine_type,
            need_watermark=0,
            need_rm_url=0,
            qos="BestQuality",
            sync=2  # 异步模式
        )

        if result["success"]:
            return {
                "ok": True,
                "data": {
                    "request_id": result["request_id"],
                    "message": result.get("message", "翻译任务已提交"),
                    "total": len(request.image_urls)
                }
            }
        else:
            raise HTTPException(
                status_code=400,
                detail={
                    "type": "about:blank",
                    "title": "Translation Failed",
                    "status": 400,
                    "detail": result.get("error", "翻译失败"),
                    "code": "TRANSLATION_FAILED"
                }
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"批量图片翻译失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )


@router.get("/translate-result/{request_id}")
async def get_translation_result(
    request_id: str,
    user: User = Depends(get_current_user)
) -> dict:
    """查询翻译结果（用于前端轮询）"""
    try:
        service = XiangjifanyiService()
        result = await service.get_translation_result(
            request_id=request_id,
            max_retries=1,  # 单次查询，不重试
            interval=0
        )

        if result["success"]:
            return {
                "ok": True,
                "data": {
                    "completed": result.get("completed", False),
                    "results": result.get("results", [])
                }
            }
        else:
            # 查询失败不抛异常，返回未完成状态
            return {
                "ok": True,
                "data": {
                    "completed": False,
                    "error": result.get("error")
                }
            }

    except Exception as e:
        logger.error(f"查询翻译结果失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "type": "about:blank",
                "title": "Internal Server Error",
                "status": 500,
                "detail": str(e),
                "code": "INTERNAL_ERROR"
            }
        )
