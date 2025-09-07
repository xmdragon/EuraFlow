"""
Pytest 配置和 fixtures
"""
import asyncio
import pytest
import pytest_asyncio
from typing import AsyncGenerator
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.config import get_settings
from ef_core.database import get_db_manager
from ef_core.models.base import Base


@pytest.fixture(scope="session")
def event_loop():
    """创建事件循环"""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest_asyncio.fixture(scope="session")
async def db_manager():
    """数据库管理器 fixture"""
    # 使用测试数据库
    settings = get_settings()
    original_db_name = settings.db_name
    
    # 切换到测试数据库
    settings.db_name = f"{original_db_name}_test"
    
    manager = get_db_manager()
    
    # 创建测试表
    await manager.create_tables()
    
    yield manager
    
    # 清理
    await manager.drop_tables()
    await manager.close()
    
    # 恢复原始配置
    settings.db_name = original_db_name


@pytest_asyncio.fixture
async def db_session(db_manager) -> AsyncGenerator[AsyncSession, None]:
    """数据库会话 fixture"""
    async with db_manager.get_session() as session:
        yield session
        await session.rollback()  # 测试后回滚


@pytest.fixture
def sample_order_data():
    """示例订单数据"""
    return {
        "platform": "ozon",
        "shop_id": 1001,
        "external_id": "test_order_123",
        "external_no": "test_posting_123",
        "status": "created",
        "external_status": "awaiting_packaging",
        "payment_method": "online",
        "buyer_name": "Test User",
        "buyer_phone_raw": "+7 916 123 4567",
        "buyer_phone_e164": "+79161234567",
        "buyer_email": "test@example.com",
        "address_country": "RU",
        "address_region": "Moscow",
        "address_city": "Moscow",
        "address_street": "Test Street 1",
        "address_postcode": "123456",
        "platform_created_ts": "2025-01-01T00:00:00Z",
        "platform_updated_ts": "2025-01-01T00:00:00Z",
        "fx_rate": "90.0",
        "currency": "RUB"
    }


@pytest.fixture
def sample_order_items():
    """示例订单项数据"""
    return [
        {
            "sku": "TEST_SKU_001",
            "offer_id": "OFFER_001",
            "qty": 2,
            "price_rub": "1500.00"
        },
        {
            "sku": "TEST_SKU_002", 
            "qty": 1,
            "price_rub": "2500.50"
        }
    ]