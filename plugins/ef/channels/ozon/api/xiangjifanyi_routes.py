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
    logger.info(f"translate_single_image called: image_url={request.image_url}, engine_type={request.engine_type}")
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
                    "code": "TRANSLATION_FAILED",
                    "message": result.get("error", "翻译失败")
                }
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"单张图片翻译失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_ERROR",
                "message": str(e)
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
                    "code": "TRANSLATION_FAILED",
                    "message": result.get("error", "翻译失败")
                }
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"批量图片翻译失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={
                "code": "INTERNAL_ERROR",
                "message": str(e)
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


@router.post("/matting-token")
async def get_matting_token(
    user: User = Depends(get_current_user)
) -> dict:
    """获取象寄智能抠图token和配置"""
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

            if not config.img_matting_key or not config.aigc_key or not config.user_key:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "type": "about:blank",
                        "title": "Invalid Configuration",
                        "status": 400,
                        "detail": "请先配置智能抠图密钥(img_matting_key)、AIGC密钥(aigc_key)和用户密钥(user_key)",
                        "code": "INVALID_CONFIG"
                    }
                )

            # 调用象寄登录API获取token
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

                    # 检查返回的code是否为0（成功）
                    code = result.get("code")
                    if code != 0 and code != "0":
                        error_msg = result.get("msg", "登录失败")
                        raise HTTPException(
                            status_code=400,
                            detail={
                                "type": "about:blank",
                                "title": "Login Failed",
                                "status": 400,
                                "detail": f"象寄登录失败: {error_msg}",
                                "code": "LOGIN_FAILED"
                            }
                        )

                    token = result.get("data", {}).get("token")
                    if not token:
                        raise HTTPException(
                            status_code=500,
                            detail={
                                "type": "about:blank",
                                "title": "Token Not Found",
                                "status": 500,
                                "detail": "登录成功但未返回token",
                                "code": "TOKEN_NOT_FOUND"
                            }
                        )

                    return {
                        "ok": True,
                        "data": {
                            "token": token,
                            "user_key": config.user_key,
                            "aigc_key": config.aigc_key,
                            "img_matting_key": config.img_matting_key
                        }
                    }

            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail={
                        "type": "about:blank",
                        "title": "Timeout",
                        "status": 504,
                        "detail": "连接象寄服务超时",
                        "code": "TIMEOUT"
                    }
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=500,
                    detail={
                        "type": "about:blank",
                        "title": "Request Error",
                        "status": 500,
                        "detail": f"请求失败: {str(e)}",
                        "code": "REQUEST_ERROR"
                    }
                )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"获取抠图token失败: {e}", exc_info=True)
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


class MattingSingleImageRequest(BaseModel):
    """单张图片智能抠图请求"""
    image_url: str = Field(..., description="图片URL")
    bg_color: str = Field(default="255,255,255", description="背景颜色（RGB，逗号分隔）")
    sync: int = Field(default=1, description="1=同步返回，2=异步返回")


@router.post("/matting-single")
async def matting_single_image(
    request: MattingSingleImageRequest,
    user: User = Depends(get_current_user)
) -> dict:
    """
    单张图片智能抠图（直接调用象寄API）

    直接调用象寄智能抠图API，返回抠图后的图片URL和requestId
    """
    try:
        import hashlib
        from urllib.parse import urlencode, quote

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

            if not config.user_key or not config.img_matting_key:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "type": "about:blank",
                        "title": "Invalid Configuration",
                        "status": 400,
                        "detail": "请先配置用户密钥(user_key)和智能抠图密钥(img_matting_key)",
                        "code": "INVALID_CONFIG"
                    }
                )

            # 生成时间戳和签名
            timestamp = str(int(datetime.now(timezone.utc).timestamp()))
            sign_str = f"{timestamp}_{config.user_key}_{config.img_matting_key}"
            sign = hashlib.md5(sign_str.encode()).hexdigest()

            # 构建请求URL（Query参数）
            # 注意：Url参数需要进行urlencode
            params = {
                "Action": "GetImageMatting",
                "ImgMattingKey": config.img_matting_key,
                "CommitTime": timestamp,
                "Url": request.image_url,  # urlencode会自动处理
                "Sign": sign,
                "Sync": str(request.sync),
                "BgColor": request.bg_color
            }

            api_url = f"https://api.tosoiot.com/?{urlencode(params)}"

            logger.info(f"调用象寄智能抠图API: {api_url}")

            # 调用象寄抠图API
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:  # 抠图可能较慢，超时30秒
                    response = await client.post(api_url)
                    response.raise_for_status()
                    result = response.json()

                    logger.info(f"象寄抠图API响应: {result}")

                    # 检查返回的code是否为0（成功）
                    code = result.get("code")
                    if code != 0 and code != "0":
                        error_msg = result.get("msg", "抠图失败")
                        raise HTTPException(
                            status_code=400,
                            detail={
                                "type": "about:blank",
                                "title": "Matting Failed",
                                "status": 400,
                                "detail": f"象寄抠图失败: {error_msg}",
                                "code": "MATTING_FAILED"
                            }
                        )

                    # 提取抠图后的URL和requestId
                    data = result.get("data", {})
                    matted_url = data.get("url")
                    request_id = data.get("requestId")

                    if not matted_url:
                        raise HTTPException(
                            status_code=500,
                            detail={
                                "type": "about:blank",
                                "title": "No Result URL",
                                "status": 500,
                                "detail": "抠图成功但未返回图片URL",
                                "code": "NO_RESULT_URL"
                            }
                        )

                    return {
                        "ok": True,
                        "data": {
                            "url": matted_url,
                            "request_id": request_id,
                            "original_url": request.image_url
                        }
                    }

            except httpx.TimeoutException:
                raise HTTPException(
                    status_code=504,
                    detail={
                        "type": "about:blank",
                        "title": "Timeout",
                        "status": 504,
                        "detail": "连接象寄服务超时（抠图处理时间较长）",
                        "code": "TIMEOUT"
                    }
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=500,
                    detail={
                        "type": "about:blank",
                        "title": "Request Error",
                        "status": 500,
                        "detail": f"请求失败: {str(e)}",
                        "code": "REQUEST_ERROR"
                    }
                )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"智能抠图失败: {e}", exc_info=True)
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


class MattingSignRequest(BaseModel):
    """抠图签名请求"""
    timestamp: int = Field(..., description="秒级时间戳")


@router.post("/matting-sign")
async def generate_matting_sign(
    request: MattingSignRequest,
    user: User = Depends(get_current_user)
) -> dict:
    """生成智能抠图签名"""
    try:
        import hashlib

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

            if not config.user_key or not config.img_matting_key:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "type": "about:blank",
                        "title": "Invalid Configuration",
                        "status": 400,
                        "detail": "请先配置用户密钥(user_key)和智能抠图密钥(img_matting_key)",
                        "code": "INVALID_CONFIG"
                    }
                )

            # 生成签名: md5(CommitTime_userKey_imgMattingKey)
            sign_str = f"{request.timestamp}_{config.user_key}_{config.img_matting_key}"
            sign = hashlib.md5(sign_str.encode()).hexdigest()

            return {
                "ok": True,
                "data": {
                    "sign": sign,
                    "timestamp": request.timestamp
                }
            }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"生成抠图签名失败: {e}", exc_info=True)
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
