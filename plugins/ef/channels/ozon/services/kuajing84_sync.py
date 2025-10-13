"""跨境巴士同步服务

整合 Kuajing84Client 和数据库操作，提供高层次的同步功能。
"""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Optional

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.ozon_shops import OzonShop
from ..models.orders import OzonOrder
from ..models.kuajing84 import Kuajing84SyncLog
from ..models.kuajing84_global_config import Kuajing84GlobalConfig
from .kuajing84_client import Kuajing84Client

logger = logging.getLogger(__name__)


def create_kuajing84_sync_service(db: AsyncSession) -> "Kuajing84SyncService":
    """
    创建 Kuajing84SyncService 实例（统一的工厂函数）

    确保加密密钥生成逻辑在所有地方保持一致

    Args:
        db: 数据库会话

    Returns:
        Kuajing84SyncService 实例
    """
    from ef_core.config import get_settings
    import hashlib
    import base64

    settings = get_settings()
    encryption_key = getattr(settings, "encryption_key", None)

    if not encryption_key:
        secret_key = settings.secret_key
        derived_key = hashlib.sha256(secret_key.encode()).digest()
        encryption_key = base64.urlsafe_b64encode(derived_key)

    return Kuajing84SyncService(db=db, encryption_key=encryption_key)


class Kuajing84SyncService:
    """跨境巴士同步服务"""

    def __init__(self, db: AsyncSession, encryption_key: str):
        """
        初始化服务

        Args:
            db: 数据库会话
            encryption_key: 加密密钥（用于加密/解密密码和Cookie）
        """
        self.db = db
        self.cipher = Fernet(encryption_key.encode() if isinstance(encryption_key, str) else encryption_key)

    def _encrypt(self, data: str) -> str:
        """加密数据"""
        return self.cipher.encrypt(data.encode()).decode()

    def _decrypt(self, encrypted_data: str) -> str:
        """解密数据"""
        return self.cipher.decrypt(encrypted_data.encode()).decode()

    async def save_kuajing84_config(
        self,
        username: str,
        password: str,
        enabled: bool = True
    ) -> Dict[str, any]:
        """
        保存跨境巴士全局配置（单例模式）

        Args:
            username: 跨境巴士用户名
            password: 跨境巴士密码（如果为 '******' 则保留原密码）
            enabled: 是否启用

        Returns:
            保存结果
        """
        logger.info(f"保存跨境巴士全局配置，username: {username}")

        # 查询全局配置（id固定为1）
        result = await self.db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = result.scalar_one_or_none()

        # 检查密码是否为占位符（前端用于保留原密码）
        is_placeholder = password == '******'

        if config:
            # 更新现有配置
            config.username = username

            # 只有在密码不是占位符时才更新密码
            if not is_placeholder:
                config.password = self._encrypt(password)
                # 密码更新时清空旧Cookie（需要重新登录）
                config.cookie = None
                config.cookie_expires_at = None

            config.enabled = enabled
        else:
            # 创建新配置时，密码不能为占位符
            if is_placeholder:
                return {
                    "success": False,
                    "message": "首次配置必须提供真实密码"
                }

            # 创建新配置
            config = Kuajing84GlobalConfig(
                id=1,
                username=username,
                password=self._encrypt(password),
                enabled=enabled,
                base_url="https://www.kuajing84.com",
                cookie=None,
                cookie_expires_at=None
            )
            self.db.add(config)

        await self.db.commit()

        logger.info("跨境巴士全局配置保存成功")

        return {
            "success": True,
            "message": "配置保存成功"
        }

    async def get_kuajing84_config(self) -> Optional[Dict[str, any]]:
        """
        获取跨境巴士全局配置

        Returns:
            配置信息，如果未配置返回 None
        """
        result = await self.db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = result.scalar_one_or_none()

        if not config:
            return None

        return {
            "enabled": config.enabled,
            "username": config.username,
            "base_url": config.base_url,
            "has_cookie": config.cookie is not None,
            "customer_id": config.customer_id,
        }

    async def test_connection(self) -> Dict[str, any]:
        """
        测试跨境巴士连接（使用已保存的配置进行登录测试）

        如果已有有效的 Cookie，则直接返回成功；
        如果 Cookie 过期或不存在，则重新登录并保存。

        Returns:
            测试结果
        """
        logger.info("开始测试跨境巴士连接")

        # 查询全局配置
        result = await self.db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = result.scalar_one_or_none()

        if not config:
            return {
                "success": False,
                "message": "未配置跨境巴士账号，请先保存配置"
            }

        if not config.enabled:
            return {
                "success": False,
                "message": "跨境巴士功能未启用"
            }

        if not config.username or not config.password:
            return {
                "success": False,
                "message": "跨境巴士配置不完整（缺少用户名或密码）"
            }

        # 使用 _get_valid_cookies 方法（会自动检查、复用或重新登录）
        try:
            cookies = await self._get_valid_cookies()

            if not cookies:
                return {
                    "success": False,
                    "message": "无法获取有效的 Cookie，请检查用户名和密码"
                }

            # 刷新配置以获取最新的过期时间和客户ID
            await self.db.refresh(config)

            # 获取客户ID（如果还没有）
            if not config.customer_id:
                logger.info("尝试获取客户ID")
                async with Kuajing84Client(base_url=config.base_url) as client:
                    customer_id = await client.get_customer_id(cookies)
                    if customer_id:
                        config.customer_id = customer_id
                        await self.db.commit()
                        logger.info(f"客户ID已保存: {customer_id}")
                    else:
                        logger.warning("未能获取客户ID，但不影响测试连接")

            logger.info("测试连接成功")

            return {
                "success": True,
                "message": f"连接测试成功！成功获取 {len(cookies)} 个 Cookie" + (f"，客户ID: {config.customer_id}" if config.customer_id else ""),
                "data": {
                    "username": config.username,
                    "cookie_count": len(cookies),
                    "expires_at": config.cookie_expires_at.isoformat() if config.cookie_expires_at else None,
                    "customer_id": config.customer_id
                }
            }

        except Exception as e:
            logger.error(f"测试连接失败: {e}")
            error_message = str(e)

            # 根据错误信息提供更友好的提示
            if "验证码" in error_message or "captcha" in error_message.lower():
                return {
                    "success": False,
                    "message": "登录需要验证码，无法自动测试。请联系管理员。"
                }
            elif "密码错误" in error_message or "用户名错误" in error_message:
                return {
                    "success": False,
                    "message": "用户名或密码错误，请检查配置"
                }
            elif "timeout" in error_message.lower() or "超时" in error_message:
                return {
                    "success": False,
                    "message": "连接超时，请检查网络或稍后重试"
                }
            else:
                return {
                    "success": False,
                    "message": f"连接测试失败: {error_message}"
                }

    async def _get_valid_cookies(self) -> Optional[list]:
        """
        获取有效的 Cookie，如果 Cookie 过期则重新登录

        Returns:
            Cookie 列表，如果获取失败返回 None
        """
        # 查询全局配置
        result = await self.db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = result.scalar_one_or_none()

        if not config or not config.enabled:
            logger.warning("跨境巴士未启用")
            return None

        # 检查 Cookie 是否存在且未过期
        if config.cookie and config.cookie_expires_at:
            if datetime.now(timezone.utc) < config.cookie_expires_at:
                logger.debug("使用缓存的 Cookie")
                return config.cookie

        # Cookie 不存在或已过期，重新登录
        logger.info("Cookie 已过期或不存在，重新登录")

        if not config.username or not config.password:
            logger.error("跨境巴士配置不完整")
            return None

        # 解密密码
        password = self._decrypt(config.password)

        # 登录获取 Cookie
        async with Kuajing84Client(base_url=config.base_url) as client:
            try:
                login_result = await client.login(config.username, password)

                # 更新配置中的 Cookie
                config.cookie = login_result["cookies"]
                config.cookie_expires_at = datetime.fromisoformat(login_result["expires_at"].replace("Z", "+00:00"))

                await self.db.commit()

                logger.info("登录成功并更新 Cookie")

                return login_result["cookies"]

            except Exception as e:
                logger.error(f"登录跨境巴士失败，error: {e}")
                return None

    async def sync_logistics_order(
        self,
        ozon_order_id: int,
        posting_number: str,
        logistics_order: str
    ) -> Dict[str, any]:
        """
        同步物流单号到跨境巴士

        Args:
            ozon_order_id: OZON订单ID
            posting_number: 货件编号（OZON posting number）
            logistics_order: 国内物流单号

        Returns:
            同步结果:
            {
                "success": True/False,
                "message": "结果消息",
                "log_id": 同步日志ID
            }
        """
        logger.info(f"开始同步物流单号，ozon_order_id: {ozon_order_id}, posting_number: {posting_number}, logistics_order: {logistics_order}")

        # 1. 查询订单
        result = await self.db.execute(
            select(OzonOrder).where(OzonOrder.id == ozon_order_id)
        )
        order = result.scalar_one_or_none()

        if not order:
            return {
                "success": False,
                "message": f"订单不存在: {ozon_order_id}"
            }

        # 2. 查询店铺配置
        shop_result = await self.db.execute(
            select(OzonShop).where(OzonShop.id == order.shop_id)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            return {
                "success": False,
                "message": f"店铺不存在: {order.shop_id}"
            }

        # 3. 创建同步日志（使用前端传入的 posting_number）
        sync_log = Kuajing84SyncLog(
            ozon_order_id=ozon_order_id,
            shop_id=order.shop_id,
            order_number=posting_number,  # 直接使用前端传入的货件编号
            logistics_order=logistics_order,
            sync_status="pending",
            attempts=0
        )
        self.db.add(sync_log)
        await self.db.commit()
        await self.db.refresh(sync_log)

        try:
            # 4. 获取有效的 Cookie
            cookies = await self._get_valid_cookies()

            if not cookies:
                sync_log.sync_status = "failed"
                sync_log.error_message = "无法获取有效的 Cookie（登录失败）"
                await self.db.commit()

                return {
                    "success": False,
                    "message": "登录跨境巴士失败，请检查配置",
                    "log_id": sync_log.id
                }

            # 5. 获取全局配置的base_url
            result = await self.db.execute(
                select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
            )
            global_config = result.scalar_one_or_none()
            base_url = global_config.base_url if global_config else "https://www.kuajing84.com"

            # 6. 查找跨境巴士订单 oid
            async with Kuajing84Client(base_url=base_url) as client:
                oid = await client.find_order_oid(
                    order_number=sync_log.order_number,
                    cookies=cookies
                )

                if not oid:
                    sync_log.sync_status = "failed"
                    sync_log.error_message = f"未找到订单: {sync_log.order_number}"
                    sync_log.attempts += 1
                    await self.db.commit()

                    return {
                        "success": False,
                        "message": f"在跨境巴士中未找到订单: {sync_log.order_number}",
                        "log_id": sync_log.id
                    }

                # 保存 oid
                sync_log.kuajing84_oid = oid

                # 6. 提交物流单号
                submit_result = await client.submit_logistics_order(
                    oid=oid,
                    logistics_order=logistics_order,
                    cookies=cookies
                )

                sync_log.attempts += 1

                if submit_result["success"]:
                    sync_log.sync_status = "success"
                    sync_log.synced_at = datetime.now(timezone.utc)
                    await self.db.commit()

                    logger.info(f"物流单号同步成功，log_id: {sync_log.id}")

                    return {
                        "success": True,
                        "message": "同步成功",
                        "log_id": sync_log.id
                    }
                else:
                    sync_log.sync_status = "failed"
                    sync_log.error_message = submit_result["message"]
                    await self.db.commit()

                    return {
                        "success": False,
                        "message": submit_result["message"],
                        "log_id": sync_log.id
                    }

        except Exception as e:
            logger.error(f"同步物流单号异常，log_id: {sync_log.id}, error: {e}")

            sync_log.sync_status = "failed"
            sync_log.error_message = str(e)
            sync_log.attempts += 1
            await self.db.commit()

            return {
                "success": False,
                "message": f"同步异常: {str(e)}",
                "log_id": sync_log.id
            }

    async def get_sync_logs(
        self,
        shop_id: int,
        status: Optional[str] = None,
        limit: int = 50
    ) -> list:
        """
        获取同步日志列表

        Args:
            shop_id: 店铺ID
            status: 状态筛选（可选）
            limit: 返回数量限制

        Returns:
            同步日志列表
        """
        query = select(Kuajing84SyncLog).where(
            Kuajing84SyncLog.shop_id == shop_id
        )

        if status:
            query = query.where(Kuajing84SyncLog.sync_status == status)

        query = query.order_by(Kuajing84SyncLog.created_at.desc()).limit(limit)

        result = await self.db.execute(query)
        logs = result.scalars().all()

        return [
            {
                "id": log.id,
                "order_number": log.order_number,
                "logistics_order": log.logistics_order,
                "kuajing84_oid": log.kuajing84_oid,
                "sync_status": log.sync_status,
                "error_message": log.error_message,
                "attempts": log.attempts,
                "created_at": log.created_at.isoformat() if log.created_at else None,
                "synced_at": log.synced_at.isoformat() if log.synced_at else None,
            }
            for log in logs
        ]
