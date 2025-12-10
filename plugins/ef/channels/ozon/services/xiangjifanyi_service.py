"""象寄图片翻译服务"""
import hashlib
import time
import logging
from typing import Optional, List, Dict, Any
from urllib.parse import quote
import httpx
import asyncio

from sqlalchemy import select
from ef_core.database import get_db_manager
from ..models.xiangjifanyi import XiangjifanyiConfig

logger = logging.getLogger(__name__)


class XiangjifanyiService:
    """象寄图片翻译服务类"""

    def __init__(self):
        self.default_api_base = "https://api.tosoiot.com"
        self.timeout = 60.0

    async def get_config(self) -> Optional[XiangjifanyiConfig]:
        """获取象寄配置"""
        db_manager = get_db_manager()
        async with db_manager.get_session() as session:
            stmt = select(XiangjifanyiConfig).where(XiangjifanyiConfig.id == 1)
            config = await session.scalar(stmt)
            return config

    def generate_sign(self, commit_time: str, user_key: str, img_trans_key: str) -> str:
        """
        生成签名
        签名方法: md5( CommitTime + '_' + UserKey + '_' + ImgTransKey ) 小写
        """
        sign_str = f"{commit_time}_{user_key}_{img_trans_key}"
        return hashlib.md5(sign_str.encode('utf-8')).hexdigest().lower()

    def get_img_trans_key_and_engine(self, config: XiangjifanyiConfig, engine_type: int = 1) -> tuple[str, str, int | None]:
        """
        根据引擎类型获取对应的翻译密钥和引擎参数

        根据象寄 API 文档：
        - 默认使用阿里云标识码（img_trans_key_ali）
        - 当需要使用 ChatGPT 时，传递 EngineType=5 参数
        - 其他引擎需要使用对应的标识码

        Returns:
            (img_trans_key, engine_name, engine_type_param): 密钥、引擎名称、EngineType参数（None表示不传）
        """
        if engine_type == 5:  # ChatGPT
            key = config.img_trans_key_chatgpt or ""
            return (key, "ChatGPT", 5)
        elif engine_type == 1:  # 阿里云（默认）
            key = config.img_trans_key_ali or ""
            return (key, "阿里云", None)  # 不传 EngineType，默认使用阿里云
        else:
            # 未知引擎，使用阿里云兜底
            key = config.img_trans_key_ali or ""
            return (key, "阿里云", None)

    async def translate_single_image(
        self,
        image_url: str,
        source_lang: str = "CHS",
        target_lang: str = "RUS",
        engine_type: Optional[int] = None,
        need_watermark: int = 0,
        need_rm_url: int = 0,
        qos: str = "BestQuality",
        product_text_protect: int = 1
    ) -> Dict[str, Any]:
        """
        单张图片翻译

        Args:
            image_url: 图片URL（Cloudinary地址）
            source_lang: 源语言（默认中文简体）
            target_lang: 目标语言（默认俄语）
            engine_type: 翻译引擎（1=阿里云，5=ChatGPT，用于选择对应的ImgTransKey）
            need_watermark: 是否添加水印（0=不添加，1=添加）
            need_rm_url: 是否返回去文字图片（0=不返回，1=返回）
            qos: 质量偏好（LowLatency=速度优先，BestQuality=质量优先）
            product_text_protect: 商品文字保护（1=启用）

        Returns:
            {
                "success": True/False,
                "url": "翻译后的图片URL",
                "request_id": "请求ID（用于精修）",
                "error": "错误信息"
            }
        """
        try:
            # 获取配置
            config = await self.get_config()
            if not config or not config.user_key:
                return {"success": False, "error": "象寄服务未配置"}

            # 获取翻译引擎密钥、名称和 EngineType 参数
            img_trans_key, engine_name, engine_type_param = self.get_img_trans_key_and_engine(config, engine_type)
            if not img_trans_key:
                return {"success": False, "error": f"图片翻译服务标识码未配置，请在系统配置中填写"}

            # 使用配置的 API URL，如果没有则使用默认值
            api_base = config.api_url or self.default_api_base
            logger.info(f"使用翻译引擎: {engine_name}, EngineType: {engine_type_param}, API URL: {api_base}")

            # 生成签名
            commit_time = str(int(time.time()))
            sign = self.generate_sign(commit_time, config.user_key, img_trans_key)

            # 构建请求参数
            params = {
                "Action": "GetImageTranslate",
                "SourceLanguage": source_lang,
                "TargetLanguage": target_lang,
                "Url": quote(image_url, safe=''),
                "ImgTransKey": img_trans_key,
                "CommitTime": commit_time,
                "Sign": sign,
                "NeedWatermark": need_watermark,
                "NeedRmUrl": need_rm_url,
                "Qos": qos,
            }

            # 如果需要使用 ChatGPT 引擎，添加 EngineType 参数
            if engine_type_param is not None:
                params["EngineType"] = engine_type_param

            # 打印完整的请求信息
            logger.info(f"🔍 象寄API请求 URL: {api_base}")
            logger.info(f"🔍 象寄API请求参数: {params}")

            # 发送请求
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(api_base, params=params)

                # 调试：打印响应状态码和原始内容
                logger.info(f"象寄API响应状态码: {response.status_code}")
                logger.info(f"象寄API响应头: {dict(response.headers)}")
                logger.info(f"象寄API原始响应（前500字符）: {response.text[:500]}")

                # 检查HTTP状态码
                if response.status_code != 200:
                    logger.error(f"象寄API返回非200状态码: {response.status_code}, 响应: {response.text}")
                    return {
                        "success": False,
                        "error": f"API请求失败（HTTP {response.status_code}）: {response.text[:200]}"
                    }

                # 尝试解析JSON
                try:
                    result = response.json()
                except Exception as json_error:
                    logger.error(f"象寄API响应不是有效JSON: {json_error}, 响应内容: {response.text[:500]}")
                    return {
                        "success": False,
                        "error": f"API响应格式错误: {response.text[:200]}"
                    }

            logger.info(f"象寄单张翻译响应: {result}")

            # 检查响应
            if result.get("Code") == 200:
                data = result.get("Data", {})
                return {
                    "success": True,
                    "url": data.get("SslUrl") or data.get("Url"),
                    "request_id": result.get("RequestId"),
                    "original_result": data
                }
            else:
                error_msg = result.get("Message", "翻译失败")
                return {"success": False, "error": error_msg, "code": result.get("Code")}

        except httpx.TimeoutException:
            logger.error("象寄单张翻译请求超时")
            return {"success": False, "error": "请求超时"}
        except Exception as e:
            logger.error(f"象寄单张翻译失败: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def translate_batch_images(
        self,
        image_urls: List[str],
        source_lang: str = "CHS",
        target_lang: str = "RUS",
        engine_type: Optional[int] = None,
        need_watermark: int = 0,
        need_rm_url: int = 0,
        qos: str = "BestQuality",
        sync: int = 2  # 1=同步，2=异步（建议异步）
    ) -> Dict[str, Any]:
        """
        批量图片翻译（异步模式）

        Args:
            image_urls: 图片URL列表
            source_lang: 源语言
            target_lang: 目标语言
            engine_type: 翻译引擎
            need_watermark: 是否添加水印
            need_rm_url: 是否返回去文字图片
            qos: 质量偏好
            sync: 同步/异步模式（1=同步，2=异步）

        Returns:
            {
                "success": True/False,
                "request_id": "请求ID（用于轮询结果）",
                "message": "提示信息",
                "error": "错误信息"
            }
        """
        try:
            # 获取配置
            config = await self.get_config()
            if not config or not config.user_key:
                return {"success": False, "error": "象寄服务未配置"}

            # 获取翻译引擎密钥、名称和 EngineType 参数
            img_trans_key, engine_name, engine_type_param = self.get_img_trans_key_and_engine(config, engine_type)
            if not img_trans_key:
                return {"success": False, "error": f"图片翻译服务标识码未配置，请在系统配置中填写"}

            # 使用配置的 API URL，如果没有则使用默认值
            api_base = config.api_url or self.default_api_base
            logger.info(f"批量翻译使用引擎: {engine_name}, EngineType: {engine_type_param}, API URL: {api_base}")

            # 生成签名
            commit_time = str(int(time.time()))
            sign = self.generate_sign(commit_time, config.user_key, img_trans_key)

            # URL编码并用逗号连接
            encoded_urls = ",".join([quote(url, safe='') for url in image_urls])

            # 构建请求参数
            params = {
                "Action": "GetImageTranslateBatch",
                "SourceLanguage": source_lang,
                "TargetLanguage": target_lang,
                "Urls": encoded_urls,
                "ImgTransKey": img_trans_key,
                "CommitTime": commit_time,
                "Sign": sign,
                "Sync": sync,
                "NeedWatermark": need_watermark,
                "NeedRmUrl": need_rm_url,
                "Qos": qos,
            }

            # 如果需要使用 ChatGPT 引擎，添加 EngineType 参数
            if engine_type_param is not None:
                params["EngineType"] = engine_type_param

            logger.info(f"🚀 [批量翻译请求] API URL: {api_base}")
            logger.info(f"🚀 [批量翻译请求] 图片数量: {len(image_urls)}")
            logger.info(f"🚀 [批量翻译请求] 原始URLs: {image_urls}")
            logger.info(f"🚀 [批量翻译请求] 请求参数: {params}")

            # 发送请求
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.get(api_base, params=params)
                result = response.json()

            logger.info(f"🚀 [批量翻译响应] 状态码: {response.status_code}")
            logger.info(f"🚀 [批量翻译响应] 完整响应: {result}")

            # 检查响应
            if result.get("Code") == 200:
                # 批量翻译返回的 Content 是一个数组，包含每张图片的 requestId
                data = result.get("Data", {})
                content = data.get("Content", [])

                # 将单张图片的 requestId 用逗号连接，用于后续查询
                if isinstance(content, list) and len(content) > 0:
                    request_ids = ",".join(content)
                else:
                    # 兜底：使用批量任务的 RequestId
                    request_ids = result.get("RequestId")

                logger.info(f"✅ 批量翻译任务提交成功，单张图片RequestIds: {request_ids}")

                return {
                    "success": True,
                    "request_id": request_ids,  # 返回单张图片的requestId（逗号分隔）
                    "message": result.get("Message", "翻译任务已提交"),
                    "sync": sync
                }
            else:
                error_msg = result.get("Message", "翻译失败")
                return {"success": False, "error": error_msg, "code": result.get("Code")}

        except httpx.TimeoutException:
            logger.error("象寄批量翻译请求超时")
            return {"success": False, "error": "请求超时"}
        except Exception as e:
            logger.error(f"象寄批量翻译失败: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def get_translation_result(self, request_id: str, max_retries: int = 30, interval: float = 2.0) -> Dict[str, Any]:
        """
        轮询获取异步翻译结果

        Args:
            request_id: 翻译请求ID
            max_retries: 最大重试次数（默认30次）
            interval: 重试间隔（秒，默认2秒）

        Returns:
            {
                "success": True/False,
                "completed": True/False,  # 是否完成
                "results": [{
                    "url": "原图URL",
                    "translated_url": "翻译后URL",
                    "success": True/False,
                    "error": "错误信息"
                }],
                "error": "错误信息"
            }
        """
        try:
            # 获取配置
            config = await self.get_config()
            if not config or not config.user_key:
                return {"success": False, "error": "象寄服务未配置"}

            # 使用配置的 API URL，如果没有则使用默认值
            api_base = config.api_url or self.default_api_base

            # 轮询获取结果
            results = []  # 提前初始化 results
            for attempt in range(max_retries):
                commit_time = str(int(time.time()))

                # 使用"查询批量图片翻译结果明细"API
                params = {
                    "Action": "GetImageTranslateBatchQuery",
                    "RequestIds": request_id,  # 批量翻译返回的RequestId
                    "CommitTime": commit_time,
                    "Sign": self.generate_sign(commit_time, config.user_key, config.img_trans_key_ali or "")
                }

                logger.info(f"🔍 [第{attempt+1}次查询] 请求参数: {params}")
                logger.info(f"🔍 [第{attempt+1}次查询] API URL: {api_base}")

                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    response = await client.post(api_base, params=params)
                    result = response.json()

                logger.info(f"🔍 [第{attempt+1}次查询] 响应: {result}")

                # 检查是否完成
                if result.get("Code") == 200:
                    data = result.get("Data", {})
                    content = data.get("Content", {})

                    # Content 可能是字典或数组，需要兼容两种格式
                    # 字典格式：{'requestId1': {...}, 'requestId2': {...}}
                    # 数组格式：[{...}, {...}]（文档描述，但实际可能不是）

                    logger.info(f"Content类型: {type(content)}, 内容: {content}")

                    results = []
                    all_completed = True

                    # 处理字典格式（实际API返回格式）
                    if isinstance(content, dict):
                        for req_id, item in content.items():
                            # 检查 item 是否是字典
                            if not isinstance(item, dict):
                                # 如果是字符串，可能是错误消息
                                if isinstance(item, str):
                                    results.append({
                                        "url": None,
                                        "success": False,
                                        "error": item
                                    })
                                else:
                                    logger.warning(f"RequestId {req_id} 的内容不是字典: {type(item)}, 内容: {item}")
                                continue

                            # 检查是否有错误码
                            item_code = item.get("Code")
                            if item_code == 200:
                                # 翻译成功
                                results.append({
                                    "url": item.get("OriginUrl") or item.get("OriginalUrl"),
                                    "translated_url": item.get("SslUrl") or item.get("Url"),
                                    "request_id": req_id,
                                    "success": True
                                })
                            elif item_code == 114:
                                # 任务尚未处理完成
                                all_completed = False
                            else:
                                # 翻译失败
                                results.append({
                                    "url": item.get("OriginUrl") or item.get("OriginalUrl"),
                                    "success": False,
                                    "error": item.get("Message", f"翻译失败(Code: {item_code})")
                                })

                    # 处理数组格式（API文档描述格式）
                    elif isinstance(content, list):
                        for item in content:
                            if not isinstance(item, dict):
                                logger.warning(f"Content中的元素不是字典: {type(item)}, 内容: {item}")
                                continue

                            item_code = item.get("Code")
                            if item_code == 200:
                                results.append({
                                    "url": item.get("OriginUrl") or item.get("OriginalUrl"),
                                    "translated_url": item.get("SslUrl") or item.get("Url"),
                                    "request_id": item.get("RequestId"),
                                    "success": True
                                })
                            elif item_code == 114:
                                all_completed = False
                            else:
                                results.append({
                                    "url": item.get("OriginUrl") or item.get("OriginalUrl"),
                                    "success": False,
                                    "error": item.get("Message", f"翻译失败(Code: {item_code})")
                                })
                    else:
                        logger.warning(f"象寄API返回的Content格式未知: {type(content)}, 内容: {content}")
                        return {
                            "success": False,
                            "completed": False,
                            "error": f"API返回数据格式错误: Content类型未知 {type(content).__name__}"
                        }

                    if all_completed and len(results) > 0:
                        # 所有图片都翻译完成
                        return {
                            "success": True,
                            "completed": True,
                            "results": results
                        }
                    elif not all_completed:
                        # 有图片还在处理中（Code 114）
                        # 如果是前端轮询（max_retries=1），直接返回未完成状态
                        if max_retries == 1:
                            logger.info(f"翻译任务处理中，已完成 {len(results)} 张，继续等待...")
                            return {
                                "success": True,
                                "completed": False,
                                "results": results  # 返回已完成的部分
                            }
                        # 否则继续重试
                    elif len(results) > 0:
                        # 所有结果都是失败的
                        return {
                            "success": True,
                            "completed": True,
                            "results": results
                        }

                # 如果未完成，等待后重试
                if attempt < max_retries - 1:
                    await asyncio.sleep(interval)

            # 重试次数用尽，仍未完成
            return {
                "success": True,
                "completed": False,
                "error": "查询超时，请稍后重试",
                "results": results  # 返回已有的部分结果
            }

        except Exception as e:
            logger.error(f"查询翻译结果失败: {e}", exc_info=True)
            return {"success": False, "error": str(e)}

    async def upload_to_cloudinary(self, translated_url: str, shop_id: int) -> Optional[str]:
        """
        将翻译后的图片上传到Cloudinary

        Args:
            translated_url: 象寄翻译后的图片URL
            shop_id: 店铺ID

        Returns:
            Cloudinary图片URL，失败返回None
        """
        # TODO: 实现完整的图床上传逻辑
        # 目前先返回翻译后的URL作为占位
        logger.info(f"图片准备上传到图床（TODO）: {translated_url}")
        return translated_url
