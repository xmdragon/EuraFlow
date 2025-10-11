"""跨境巴士同步服务

整合 Kuajing84Client 和数据库操作，提供高层次的同步功能。
"""

import json
import logging
from datetime import datetime, timedelta
from typing import Dict, Optional

from cryptography.fernet import Fernet
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models.ozon_shops import OzonShop
from ..models.orders import OzonOrder
from ..models.kuajing84 import Kuajing84SyncLog
from .kuajing84_client import Kuajing84Client

logger = logging.getLogger(__name__)


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
        shop_id: int,
        username: str,
        password: str,
        enabled: bool = True
    ) -> Dict[str, any]:
        """
        保存跨境巴士配置

        Args:
            shop_id: 店铺ID
            username: 跨境巴士用户名
            password: 跨境巴士密码
            enabled: 是否启用

        Returns:
            保存结果
        """
        logger.info(f"保存跨境巴士配置，shop_id: {shop_id}, username: {username}")

        # 查询店铺
        result = await self.db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = result.scalar_one_or_none()

        if not shop:
            raise ValueError(f"店铺不存在: {shop_id}")

        # 加密密码
        encrypted_password = self._encrypt(password)

        # 更新配置
        shop.kuajing84_config = {
            "enabled": enabled,
            "base_url": "https://www.kuajing84.com",
            "username": username,
            "password": encrypted_password,
            "cookie": None,  # 首次保存不包含 Cookie
            "cookie_expires_at": None
        }

        await self.db.commit()

        logger.info(f"跨境巴士配置保存成功，shop_id: {shop_id}")

        return {
            "success": True,
            "message": "配置保存成功"
        }

    async def get_kuajing84_config(self, shop_id: int) -> Optional[Dict[str, any]]:
        """
        获取跨境巴士配置

        Args:
            shop_id: 店铺ID

        Returns:
            配置信息，如果未配置返回 None
        """
        result = await self.db.execute(
            select(OzonShop).where(OzonShop.id == shop_id)
        )
        shop = result.scalar_one_or_none()

        if not shop or not shop.kuajing84_config:
            return None

        config = shop.kuajing84_config.copy()

        # 解密密码（API返回时不包含密码，仅内部使用）
        return config

    async def _get_valid_cookies(self, shop: OzonShop) -> Optional[list]:
        """
        获取有效的 Cookie，如果 Cookie 过期则重新登录

        Args:
            shop: 店铺对象

        Returns:
            Cookie 列表，如果获取失败返回 None
        """
        config = shop.kuajing84_config

        if not config or not config.get("enabled"):
            logger.warning(f"跨境巴士未启用，shop_id: {shop.id}")
            return None

        # 检查 Cookie 是否存在且未过期
        cookie = config.get("cookie")
        expires_at = config.get("cookie_expires_at")

        if cookie and expires_at:
            expires_time = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
            if datetime.utcnow() < expires_time:
                logger.debug(f"使用缓存的 Cookie，shop_id: {shop.id}")
                return cookie

        # Cookie 不存在或已过期，重新登录
        logger.info(f"Cookie 已过期或不存在，重新登录，shop_id: {shop.id}")

        username = config.get("username")
        encrypted_password = config.get("password")

        if not username or not encrypted_password:
            logger.error(f"跨境巴士配置不完整，shop_id: {shop.id}")
            return None

        # 解密密码
        password = self._decrypt(encrypted_password)

        # 登录获取 Cookie
        async with Kuajing84Client(base_url=config.get("base_url", "https://www.kuajing84.com")) as client:
            try:
                login_result = await client.login(username, password)

                # 更新配置中的 Cookie
                config["cookie"] = login_result["cookies"]
                config["cookie_expires_at"] = login_result["expires_at"]

                shop.kuajing84_config = config
                await self.db.commit()

                logger.info(f"登录成功并更新 Cookie，shop_id: {shop.id}")

                return login_result["cookies"]

            except Exception as e:
                logger.error(f"登录跨境巴士失败，shop_id: {shop.id}, error: {e}")
                return None

    async def sync_logistics_order(
        self,
        ozon_order_id: int,
        logistics_order: str
    ) -> Dict[str, any]:
        """
        同步物流单号到跨境巴士

        Args:
            ozon_order_id: OZON订单ID
            logistics_order: 国内物流单号

        Returns:
            同步结果:
            {
                "success": True/False,
                "message": "结果消息",
                "log_id": 同步日志ID
            }
        """
        logger.info(f"开始同步物流单号，ozon_order_id: {ozon_order_id}, logistics_order: {logistics_order}")

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

        # 3. 创建同步日志
        sync_log = Kuajing84SyncLog(
            ozon_order_id=ozon_order_id,
            shop_id=order.shop_id,
            order_number=order.ozon_order_number or str(order.ozon_order_id),
            logistics_order=logistics_order,
            sync_status="pending",
            attempts=0
        )
        self.db.add(sync_log)
        await self.db.commit()
        await self.db.refresh(sync_log)

        try:
            # 4. 获取有效的 Cookie
            cookies = await self._get_valid_cookies(shop)

            if not cookies:
                sync_log.sync_status = "failed"
                sync_log.error_message = "无法获取有效的 Cookie（登录失败）"
                await self.db.commit()

                return {
                    "success": False,
                    "message": "登录跨境巴士失败，请检查配置",
                    "log_id": sync_log.id
                }

            # 5. 查找跨境巴士订单 oid
            async with Kuajing84Client(
                base_url=shop.kuajing84_config.get("base_url", "https://www.kuajing84.com")
            ) as client:
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
                    sync_log.synced_at = datetime.utcnow()
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
