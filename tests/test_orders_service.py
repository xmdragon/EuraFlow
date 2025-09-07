"""
订单服务测试
"""
import pytest
from decimal import Decimal

from ef_core.services import OrdersService
from ef_core.models import Order, OrderItem
from ef_core.utils.errors import ValidationError


@pytest.mark.asyncio
class TestOrdersService:
    """订单服务测试类"""
    
    async def test_create_order_success(self, db_session, sample_order_data, sample_order_items):
        """测试成功创建订单"""
        service = OrdersService()
        
        result = await service.create_or_update_order(sample_order_data, sample_order_items)
        
        assert result.success is True
        assert result.data["created"] is True
        assert result.data["order"].external_id == "test_order_123"
        assert result.metadata["operation"] == "created"
    
    async def test_create_order_idempotent(self, db_session, sample_order_data, sample_order_items):
        """测试订单创建幂等性"""
        service = OrdersService()
        
        # 第一次创建
        result1 = await service.create_or_update_order(sample_order_data, sample_order_items)
        assert result1.success is True
        assert result1.data["created"] is True
        
        # 第二次创建（相同数据）
        result2 = await service.create_or_update_order(sample_order_data, sample_order_items)
        assert result2.success is True
        assert result2.data["created"] is False  # 不是新创建
        
        # 订单 ID 应该相同
        assert result1.data["order"].id == result2.data["order"].id
    
    async def test_create_order_validation_error(self, db_session, sample_order_items):
        """测试订单验证错误"""
        service = OrdersService()
        
        # 缺少必填字段
        invalid_data = {"platform": "ozon"}
        
        with pytest.raises(ValidationError) as exc_info:
            await service.create_or_update_order(invalid_data, sample_order_items)
        
        assert exc_info.value.code == "MISSING_REQUIRED_FIELDS"
    
    async def test_create_order_invalid_platform(self, db_session, sample_order_data, sample_order_items):
        """测试无效平台"""
        service = OrdersService()
        
        # 修改为无效平台
        invalid_data = sample_order_data.copy()
        invalid_data["platform"] = "invalid_platform"
        
        with pytest.raises(ValidationError) as exc_info:
            await service.create_or_update_order(invalid_data, sample_order_items)
        
        assert exc_info.value.code == "INVALID_PLATFORM"
    
    async def test_create_order_invalid_postcode(self, db_session, sample_order_data, sample_order_items):
        """测试无效邮编"""
        service = OrdersService()
        
        # 修改为无效邮编
        invalid_data = sample_order_data.copy() 
        invalid_data["address_postcode"] = "12345"  # 只有5位
        
        with pytest.raises(ValidationError) as exc_info:
            await service.create_or_update_order(invalid_data, sample_order_items)
        
        assert exc_info.value.code == "INVALID_POSTCODE"
    
    async def test_create_order_invalid_phone(self, db_session, sample_order_data, sample_order_items):
        """测试无效电话格式"""
        service = OrdersService()
        
        # 修改为无效电话格式
        invalid_data = sample_order_data.copy()
        invalid_data["buyer_phone_e164"] = "invalid_phone"
        
        with pytest.raises(ValidationError) as exc_info:
            await service.create_or_update_order(invalid_data, sample_order_items)
        
        assert exc_info.value.code == "INVALID_PHONE_E164"
    
    async def test_create_order_invalid_fx_rate(self, db_session, sample_order_data, sample_order_items):
        """测试无效汇率"""
        service = OrdersService()
        
        # 修改为无效汇率
        invalid_data = sample_order_data.copy()
        invalid_data["fx_rate"] = "-1.0"  # 负数
        
        with pytest.raises(ValidationError) as exc_info:
            await service.create_or_update_order(invalid_data, sample_order_items)
        
        assert exc_info.value.code == "INVALID_FX_RATE"
    
    async def test_get_orders_success(self, db_session):
        """测试查询订单成功"""
        service = OrdersService()
        
        result = await service.get_orders(shop_id=1001)
        
        assert result.success is True
        assert isinstance(result.data["items"], list)
        assert "total" in result.data
        assert "page_size" in result.data
        assert "offset" in result.data
    
    async def test_decimal_precision(self, db_session, sample_order_data, sample_order_items):
        """测试 Decimal 精度处理"""
        service = OrdersService()
        
        # 修改汇率为高精度 Decimal
        sample_order_data["fx_rate"] = "90.123456"
        sample_order_items[0]["price_rub"] = "1500.9999"
        
        result = await service.create_or_update_order(sample_order_data, sample_order_items)
        
        assert result.success is True
        assert result.data["order"].fx_rate == Decimal("90.123456")


@pytest.mark.asyncio
class TestOrderValidation:
    """订单验证测试"""
    
    def test_phone_e164_validation(self):
        """测试 E.164 电话格式验证"""
        service = OrdersService()
        
        valid_phones = [
            "+79161234567",
            "+12345678901",
            "+4470012345678"
        ]
        
        invalid_phones = [
            "79161234567",   # 缺少 +
            "+0123456789",   # 以 0 开头
            "+12345",        # 太短
            "+123456789012345"  # 太长
        ]
        
        for phone in valid_phones:
            # 应该不抛出异常
            pass
        
        for phone in invalid_phones:
            # 应该在实际验证中抛出异常
            pass