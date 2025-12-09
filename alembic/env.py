"""
Alembic 环境配置
从 EF__ 环境变量读取数据库配置
"""
import asyncio
from logging.config import fileConfig
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import create_async_engine
from alembic import context

# 导入模型以便自动生成迁移
from ef_core.config import get_settings
from ef_core.models.base import Base

# 显式导入所有插件模型，确保 Alembic 能检测到它们
# noqa: F401 - 这些导入是必需的，即使 IDE 显示未使用
import ef_core.models  # noqa: F401
import plugins.ef.channels.ozon.models  # noqa: F401
import plugins.ef.system.sync_service.models  # noqa: F401

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# 获取 EuraFlow 配置
settings = get_settings()

# 设置数据库 URL（覆盖 alembic.ini 中的配置）
config.set_main_option("sqlalchemy.url", settings.sync_database_url)

# add your model's MetaData object here
# for 'autogenerate' support
target_metadata = Base.metadata

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.
    
    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.
    
    Calls to context.execute() here emit the given string to the
    script output.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # EuraFlow 特定配置
        compare_type=True,
        compare_server_default=True,
        render_as_batch=False,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    """运行迁移的实际函数"""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        # EuraFlow 特定配置
        compare_type=True,
        compare_server_default=True,
        render_as_batch=False,
        # 排除临时表和测试表
        include_schemas=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """在异步模式下运行迁移"""
    connectable = create_async_engine(
        settings.database_url,
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.
    
    In this scenario we need to create an Engine
    and associate a connection with the context.
    """
    # 使用异步方式运行迁移
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()