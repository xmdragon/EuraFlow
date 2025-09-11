"""
EuraFlow 数据库连接和会话管理
"""
import asyncio
from contextlib import asynccontextmanager
from typing import AsyncGenerator, Optional

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    async_sessionmaker,
    AsyncSession,
    AsyncEngine
)
from sqlalchemy.orm import sessionmaker
from sqlalchemy import create_engine, text

from ef_core.config import get_settings
from ef_core.utils.logging import get_logger
from ef_core.models.base import Base

logger = get_logger(__name__)


class DatabaseManager:
    """数据库管理器"""
    
    def __init__(self):
        self.settings = get_settings()
        self._async_engine: Optional[AsyncEngine] = None
        self._async_session_factory: Optional[async_sessionmaker] = None
        self._sync_engine = None  # 用于 Alembic
    
    def create_async_engine(self) -> AsyncEngine:
        """创建异步数据库引擎"""
        if self._async_engine is None:
            self._async_engine = create_async_engine(
                self.settings.database_url,
                # 连接池配置
                pool_size=self.settings.db_pool_size,
                max_overflow=self.settings.db_max_overflow,
                pool_pre_ping=True,  # 连接前检查有效性
                pool_recycle=3600,   # 1小时回收连接
                # 日志配置
                echo=self.settings.api_debug,
                # 异步配置
                future=True,
            )
            logger.info("Created async database engine")
        
        return self._async_engine
    
    def create_sync_engine(self):
        """创建同步数据库引擎（用于 Alembic）"""
        if self._sync_engine is None:
            self._sync_engine = create_engine(
                self.settings.sync_database_url,
                pool_size=self.settings.db_pool_size,
                max_overflow=self.settings.db_max_overflow,
                pool_pre_ping=True,
                pool_recycle=3600,
                echo=self.settings.api_debug,
                future=True,
            )
            logger.info("Created sync database engine")
        
        return self._sync_engine
    
    def get_async_session_factory(self) -> async_sessionmaker:
        """获取异步会话工厂"""
        if self._async_session_factory is None:
            engine = self.create_async_engine()
            self._async_session_factory = async_sessionmaker(
                engine,
                class_=AsyncSession,
                expire_on_commit=False,
                autoflush=False,  # 手动控制刷新时机
                autocommit=False,
            )
        
        return self._async_session_factory
    
    @asynccontextmanager
    async def get_session(self) -> AsyncGenerator[AsyncSession, None]:
        """获取数据库会话上下文管理器"""
        session_factory = self.get_async_session_factory()
        async with session_factory() as session:
            try:
                yield session
            except Exception:
                await session.rollback()
                raise
            finally:
                await session.close()
    
    @asynccontextmanager
    async def get_transaction(self) -> AsyncGenerator[AsyncSession, None]:
        """获取事务上下文管理器"""
        session_factory = self.get_async_session_factory()
        async with session_factory() as session:
            async with session.begin():
                try:
                    yield session
                except Exception:
                    await session.rollback()
                    raise
    
    async def create_tables(self) -> None:
        """创建所有表（仅用于测试）"""
        engine = self.create_async_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Created all database tables")
    
    async def drop_tables(self) -> None:
        """删除所有表（仅用于测试）"""
        engine = self.create_async_engine()
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.drop_all)
        logger.info("Dropped all database tables")
    
    async def check_connection(self) -> bool:
        """检查数据库连接"""
        try:
            engine = self.create_async_engine()
            async with engine.begin() as conn:
                await conn.execute(text("SELECT 1"))
            logger.info("Database connection check passed")
            return True
        except Exception as e:
            logger.error("Database connection check failed", exc_info=True)
            return False
    
    async def close(self) -> None:
        """关闭数据库连接"""
        if self._async_engine:
            await self._async_engine.dispose()
            logger.info("Closed async database engine")
        
        if self._sync_engine:
            self._sync_engine.dispose()
            logger.info("Closed sync database engine")


# 全局数据库管理器实例
_db_manager: Optional[DatabaseManager] = None


def get_db_manager() -> DatabaseManager:
    """获取数据库管理器单例"""
    global _db_manager
    if _db_manager is None:
        _db_manager = DatabaseManager()
    return _db_manager


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """依赖注入：获取异步数据库会话"""
    db_manager = get_db_manager()
    async with db_manager.get_session() as session:
        yield session


# Alembic 需要的同步会话
def get_sync_session():
    """获取同步数据库会话（用于 Alembic）"""
    db_manager = get_db_manager()
    engine = db_manager.create_sync_engine()
    Session = sessionmaker(bind=engine)
    return Session()