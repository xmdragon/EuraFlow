"""
汇率服务 - 管理汇率配置、获取和缓存
遵循约束：UTC时间、Decimal金额、Redis缓存、外部API超时和重试
"""
import httpx
import redis.asyncio as aioredis
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Optional, Dict, Any, List
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models.exchange_rate import ExchangeRateConfig, ExchangeRate
from ef_core.database import get_db_manager
from ef_core.config import get_settings
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)
settings = get_settings()


class ExchangeRateService:
    """汇率服务"""

    def __init__(self):
        self.redis_client: Optional[aioredis.Redis] = None
        self.cache_ttl = 86400  # 24小时缓存

    async def _get_redis(self) -> aioredis.Redis:
        """获取Redis连接"""
        if self.redis_client is None:
            self.redis_client = await aioredis.from_url(
                settings.redis_url,
                encoding="utf-8",
                decode_responses=True
            )
        return self.redis_client

    async def configure_api(
        self,
        db: AsyncSession,
        api_key: str,
        api_provider: str = "exchangerate-api",
        base_currency: str = "CNY",
        is_enabled: bool = True
    ) -> ExchangeRateConfig:
        """
        配置API密钥

        Args:
            db: 数据库会话
            api_key: API密钥
            api_provider: 服务商
            base_currency: 基准货币
            is_enabled: 是否启用

        Returns:
            ExchangeRateConfig: 配置对象
        """
        # 检查是否已存在配置
        result = await db.execute(select(ExchangeRateConfig).limit(1))
        config = result.scalar_one_or_none()

        if config:
            # 更新现有配置
            config.api_key = api_key
            config.api_provider = api_provider
            config.base_currency = base_currency
            config.is_enabled = is_enabled
            config.updated_at = datetime.now(timezone.utc)
        else:
            # 创建新配置
            config = ExchangeRateConfig(
                api_key=api_key,
                api_provider=api_provider,
                base_currency=base_currency,
                is_enabled=is_enabled
            )
            db.add(config)

        await db.commit()
        await db.refresh(config)

        # 清除Redis缓存的配置
        redis = await self._get_redis()
        await redis.delete("ef:exchange_rate:config")

        logger.info(f"Exchange rate API configured: provider={api_provider}, enabled={is_enabled}")
        return config

    async def get_config(self, db: AsyncSession) -> Optional[ExchangeRateConfig]:
        """
        获取API配置

        Args:
            db: 数据库会话

        Returns:
            Optional[ExchangeRateConfig]: 配置对象，不存在返回None
        """
        result = await db.execute(select(ExchangeRateConfig).limit(1))
        return result.scalar_one_or_none()

    async def fetch_rate_from_api(self, api_key: str, from_currency: str = "CNY", to_currency: str = "RUB") -> Decimal:
        """
        从exchangerate-api获取汇率

        Args:
            api_key: API密钥
            from_currency: 源货币
            to_currency: 目标货币

        Returns:
            Decimal: 汇率

        Raises:
            Exception: API调用失败
        """
        url = f"https://v6.exchangerate-api.com/v6/{api_key}/latest/{from_currency}"

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(url)
                response.raise_for_status()
                data = response.json()

                if data.get("result") != "success":
                    raise Exception(f"API返回错误: {data.get('error-type')}")

                rate = data["conversion_rates"].get(to_currency)
                if rate is None:
                    raise Exception(f"目标货币 {to_currency} 不存在")

                return Decimal(str(rate))

            except httpx.TimeoutException:
                logger.error("Exchange rate API timeout")
                raise Exception("API调用超时")
            except httpx.HTTPStatusError as e:
                logger.error(f"Exchange rate API HTTP error: {e.response.status_code}")
                raise Exception(f"API返回错误: {e.response.status_code}")
            except Exception as e:
                logger.error(f"Exchange rate API error: {e}", exc_info=True)
                raise

    async def get_cached_rate(self, from_currency: str = "CNY", to_currency: str = "RUB") -> Optional[Decimal]:
        """
        从Redis获取缓存的汇率

        Args:
            from_currency: 源货币
            to_currency: 目标货币

        Returns:
            Optional[Decimal]: 汇率，不存在返回None
        """
        redis = await self._get_redis()
        redis_key = f"ef:exchange_rate:{from_currency}:{to_currency}"
        cached = await redis.get(redis_key)

        if cached:
            logger.debug(f"Cache hit for exchange rate {from_currency}->{to_currency}")
            return Decimal(cached)

        return None

    async def cache_rate(self, from_currency: str, to_currency: str, rate: Decimal):
        """
        将汇率缓存到Redis

        Args:
            from_currency: 源货币
            to_currency: 目标货币
            rate: 汇率
        """
        redis = await self._get_redis()
        redis_key = f"ef:exchange_rate:{from_currency}:{to_currency}"
        await redis.setex(redis_key, self.cache_ttl, str(rate))
        logger.debug(f"Cached exchange rate {from_currency}->{to_currency}={rate}")

    async def get_rate(
        self,
        db: AsyncSession,
        from_currency: str = "CNY",
        to_currency: str = "RUB",
        force_refresh: bool = False
    ) -> Decimal:
        """
        获取汇率（优先从缓存，缓存失效则从数据库，都没有则调用API）

        Args:
            db: 数据库会话
            from_currency: 源货币
            to_currency: 目标货币
            force_refresh: 是否强制刷新

        Returns:
            Decimal: 汇率

        Raises:
            Exception: 获取失败
        """
        # 1. 尝试从Redis缓存获取
        if not force_refresh:
            cached_rate = await self.get_cached_rate(from_currency, to_currency)
            if cached_rate:
                return cached_rate

        # 2. 从数据库获取最新的未过期汇率
        now = datetime.now(timezone.utc)
        result = await db.execute(
            select(ExchangeRate).where(
                and_(
                    ExchangeRate.from_currency == from_currency,
                    ExchangeRate.to_currency == to_currency,
                    ExchangeRate.expires_at > now
                )
            ).order_by(ExchangeRate.fetched_at.desc()).limit(1)
        )
        db_rate = result.scalar_one_or_none()

        if db_rate:
            # 更新Redis缓存
            await self.cache_rate(from_currency, to_currency, db_rate.rate)
            logger.info(f"Loaded exchange rate from database: {from_currency}->{to_currency}={db_rate.rate}")
            return db_rate.rate

        # 3. 调用API获取最新汇率
        config = await self.get_config(db)
        if not config or not config.is_enabled:
            raise Exception("汇率服务未配置或已禁用")

        rate = await self.fetch_rate_from_api(config.api_key, from_currency, to_currency)

        # 4. 保存到数据库
        now = datetime.now(timezone.utc)
        exchange_rate = ExchangeRate(
            from_currency=from_currency,
            to_currency=to_currency,
            rate=rate,
            fetched_at=now,
            expires_at=now + timedelta(hours=24),
            source=config.api_provider
        )
        db.add(exchange_rate)
        await db.commit()

        # 5. 更新Redis缓存
        await self.cache_rate(from_currency, to_currency, rate)

        logger.info(f"Fetched new exchange rate from API: {from_currency}->{to_currency}={rate}")
        return rate

    async def convert(
        self,
        db: AsyncSession,
        amount: Decimal,
        from_currency: str = "CNY",
        to_currency: str = "RUB"
    ) -> Decimal:
        """
        货币转换

        Args:
            db: 数据库会话
            amount: 金额
            from_currency: 源货币
            to_currency: 目标货币

        Returns:
            Decimal: 转换后的金额（保留2位小数）
        """
        rate = await self.get_rate(db, from_currency, to_currency)
        result = amount * rate
        return result.quantize(Decimal("0.01"))  # 保留2位小数

    async def refresh_rates(self, config: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        刷新汇率（定时任务调用）

        Args:
            config: 调度器传递的配置参数（可选，暂未使用）

        Returns:
            Dict: 执行结果
        """
        db_manager = get_db_manager()
        async with db_manager.get_session() as db:
            try:
                # 获取配置
                config = await self.get_config(db)
                if not config or not config.is_enabled:
                    logger.warning("Exchange rate service not configured or disabled, skipping refresh")
                    return {
                        "status": "skipped",
                        "message": "汇率服务未配置或已禁用"
                    }

                # 刷新CNY->RUB汇率
                rate = await self.fetch_rate_from_api(config.api_key, "CNY", "RUB")

                # 保存到数据库
                now = datetime.now(timezone.utc)
                exchange_rate = ExchangeRate(
                    from_currency="CNY",
                    to_currency="RUB",
                    rate=rate,
                    fetched_at=now,
                    expires_at=now + timedelta(hours=24),
                    source=config.api_provider
                )
                db.add(exchange_rate)
                await db.commit()

                # 更新Redis缓存
                await self.cache_rate("CNY", "RUB", rate)

                logger.info(f"Exchange rate refreshed successfully: CNY->RUB={rate}")
                return {
                    "status": "success",
                    "message": f"汇率刷新成功: CNY->RUB={rate}",
                    "rate": str(rate),
                    "fetched_at": now.isoformat()
                }

            except Exception as e:
                logger.error(f"Failed to refresh exchange rate: {e}", exc_info=True)
                return {
                    "status": "failed",
                    "message": f"汇率刷新失败: {str(e)}"
                }

    async def get_rate_history(
        self,
        db: AsyncSession,
        from_currency: str = "CNY",
        to_currency: str = "RUB",
        time_range: str = "today"
    ) -> List[Dict[str, Any]]:
        """
        获取汇率历史数据

        Args:
            db: 数据库会话
            from_currency: 源货币
            to_currency: 目标货币
            time_range: 时间范围 ("today" | "week" | "month")

        Returns:
            List[Dict]: 历史数据列表
        """
        now = datetime.now(timezone.utc)

        if time_range == "today":
            start_time = now.replace(hour=0, minute=0, second=0, microsecond=0)
        elif time_range == "week":
            start_time = now - timedelta(days=7)
        elif time_range == "month":
            start_time = now - timedelta(days=30)
        else:
            raise ValueError(f"Invalid time_range: {time_range}")

        result = await db.execute(
            select(ExchangeRate).where(
                and_(
                    ExchangeRate.from_currency == from_currency,
                    ExchangeRate.to_currency == to_currency,
                    ExchangeRate.fetched_at >= start_time
                )
            ).order_by(ExchangeRate.fetched_at)
        )
        records = result.scalars().all()

        return [
            {
                "time": record.fetched_at.isoformat(),
                "rate": float(record.rate)
            }
            for record in records
        ]

    async def test_connection(self, api_key: str) -> Dict[str, Any]:
        """
        测试API连接

        Args:
            api_key: API密钥

        Returns:
            Dict: 测试结果
        """
        try:
            rate = await self.fetch_rate_from_api(api_key, "CNY", "RUB")
            return {
                "success": True,
                "message": "API连接成功",
                "rate": str(rate)
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"API连接失败: {str(e)}"
            }
