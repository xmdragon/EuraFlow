"""
财务计算 API 路由
"""

from decimal import Decimal
from typing import List, Optional
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from plugins.ef.finance.calc.models.enums import Platform, ServiceType, FulfillmentModel, CarrierService
from plugins.ef.finance.calc.models.shipping import ShippingRequest, ShippingResult, Dimensions, ShippingFlags
from plugins.ef.finance.calc.models.profit import ProfitRequest, ProfitResult
from plugins.ef.finance.calc.services.shipping_calculator import ShippingCalculator
from plugins.ef.finance.calc.services.profit_calculator import ProfitCalculator
from plugins.ef.finance.calc.services.rate_manager import RateManager

router = APIRouter(prefix="/api/ef/v1/finance", tags=["finance"])

# 初始化服务
rate_manager = RateManager()
shipping_calculator = ShippingCalculator(rate_manager=rate_manager)
profit_calculator = ProfitCalculator(shipping_calculator=shipping_calculator, rate_manager=rate_manager)


class ShippingCalcRequest(BaseModel):
    """运费计算请求"""

    platform: Platform = Field(..., description="平台")
    service_type: ServiceType = Field(ServiceType.STANDARD, description="服务类型")
    weight_g: int = Field(..., gt=0, le=25000, description="重量(克)")
    length_cm: Decimal = Field(..., gt=0, description="长度(厘米)")
    width_cm: Decimal = Field(..., gt=0, description="宽度(厘米)")
    height_cm: Decimal = Field(..., gt=0, description="高度(厘米)")
    declared_value: Decimal = Field(..., ge=0, description="申报价值")
    selling_price: Decimal = Field(..., ge=0, description="售价")
    battery: bool = Field(False, description="含电池")
    fragile: bool = Field(False, description="易碎品")
    liquid: bool = Field(False, description="液体")
    insurance: bool = Field(False, description="需要保险")
    insurance_value: Optional[Decimal] = Field(None, description="保险金额")


class ProfitCalcRequest(BaseModel):
    """利润计算请求"""

    sku: str = Field(..., description="SKU")
    platform: Platform = Field(..., description="平台")
    cost: Decimal = Field(..., ge=0, description="成本")
    selling_price: Decimal = Field(..., ge=0, description="售价")
    weight_g: int = Field(..., gt=0, le=25000, description="重量(克)")
    length_cm: Decimal = Field(..., gt=0, description="长度(厘米)")
    width_cm: Decimal = Field(..., gt=0, description="宽度(厘米)")
    height_cm: Decimal = Field(..., gt=0, description="高度(厘米)")
    fulfillment_model: FulfillmentModel = Field(FulfillmentModel.FBO, description="履约模式")
    category_code: Optional[str] = Field(None, description="类目代码")
    platform_fee_rate: Optional[Decimal] = Field(None, description="平台费率(覆盖默认)")
    compare_shipping: bool = Field(True, description="比较运费方案")
    preferred_service: Optional[str] = Field(None, description="首选服务类型")


class BatchShippingRequest(BaseModel):
    """批量运费计算请求"""

    requests: List[ShippingCalcRequest] = Field(..., max_length=100, description="批量请求")


class BatchProfitRequest(BaseModel):
    """批量利润计算请求"""

    requests: List[ProfitCalcRequest] = Field(..., max_length=100, description="批量请求")


@router.post("/shipping/calculate", response_model=ShippingResult)
async def calculate_shipping(request: ShippingCalcRequest) -> ShippingResult:
    """
    计算运费
    """
    try:
        # 确定承运商
        carrier_map = {
            Platform.OZON: CarrierService.UNI_OZON,
            Platform.WILDBERRIES: CarrierService.UNI_WB,
            Platform.YANDEX: CarrierService.UNI_YANDEX,
        }
        carrier = carrier_map.get(request.platform, CarrierService.UNI_YANDEX)

        # 构造请求
        shipping_req = ShippingRequest(
            platform=request.platform,
            carrier_service=carrier,
            service_type=request.service_type,
            weight_g=request.weight_g,
            dimensions=Dimensions(length_cm=request.length_cm, width_cm=request.width_cm, height_cm=request.height_cm),
            declared_value=request.declared_value,
            selling_price=request.selling_price,
            flags=ShippingFlags(
                battery=request.battery,
                fragile=request.fragile,
                liquid=request.liquid,
                insurance=request.insurance,
                insurance_value=request.insurance_value,
            ),
        )

        # 计算运费
        result = shipping_calculator.calculate(shipping_req)
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"计算失败: {str(e)}")


@router.post("/shipping/calculate-multiple", response_model=List[ShippingResult])
async def calculate_multiple_shipping(
    request: ShippingCalcRequest,
    service_types: Optional[List[ServiceType]] = Query(None, description="要比较的服务类型"),
) -> List[ShippingResult]:
    """
    计算多种服务类型的运费
    """
    try:
        # 确定承运商
        carrier_map = {
            Platform.OZON: CarrierService.UNI_OZON,
            Platform.WILDBERRIES: CarrierService.UNI_WB,
            Platform.YANDEX: CarrierService.UNI_YANDEX,
        }
        carrier = carrier_map.get(request.platform, CarrierService.UNI_YANDEX)

        # 构造基础请求
        shipping_req = ShippingRequest(
            platform=request.platform,
            carrier_service=carrier,
            service_type=request.service_type,
            weight_g=request.weight_g,
            dimensions=Dimensions(length_cm=request.length_cm, width_cm=request.width_cm, height_cm=request.height_cm),
            declared_value=request.declared_value,
            selling_price=request.selling_price,
            flags=ShippingFlags(
                battery=request.battery,
                fragile=request.fragile,
                liquid=request.liquid,
                insurance=request.insurance,
                insurance_value=request.insurance_value,
            ),
        )

        # 计算多种服务
        results = shipping_calculator.calculate_multiple(shipping_req, service_types)
        return results

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"计算失败: {str(e)}")


@router.post("/profit/calculate", response_model=ProfitResult)
async def calculate_profit(request: ProfitCalcRequest) -> ProfitResult:
    """
    计算利润
    """
    try:
        # 构造请求
        profit_req = ProfitRequest(
            sku=request.sku,
            platform=request.platform,
            cost=request.cost,
            selling_price=request.selling_price,
            weight_g=request.weight_g,
            dimensions=Dimensions(length_cm=request.length_cm, width_cm=request.width_cm, height_cm=request.height_cm),
            fulfillment_model=request.fulfillment_model,
            category_code=request.category_code,
            platform_fee_rate=request.platform_fee_rate,
            compare_shipping=request.compare_shipping,
            preferred_service=request.preferred_service,
        )

        # 计算利润
        result = profit_calculator.calculate(profit_req)
        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"计算失败: {str(e)}")


@router.post("/shipping/batch", response_model=List[ShippingResult])
async def batch_calculate_shipping(request: BatchShippingRequest) -> List[ShippingResult]:
    """
    批量计算运费
    """
    results = []
    for calc_request in request.requests:
        try:
            result = await calculate_shipping(calc_request)
            results.append(result)
        except HTTPException:
            # 对于批量请求，记录错误但继续处理
            results.append(None)

    return [r for r in results if r is not None]


@router.post("/profit/batch", response_model=List[ProfitResult])
async def batch_calculate_profit(request: BatchProfitRequest) -> List[ProfitResult]:
    """
    批量计算利润
    """
    results = []
    for calc_request in request.requests:
        try:
            result = await calculate_profit(calc_request)
            results.append(result)
        except HTTPException:
            # 对于批量请求，记录错误但继续处理
            results.append(None)

    return [r for r in results if r is not None]


@router.get("/rates/versions")
async def get_rate_versions():
    """
    获取费率版本信息
    """
    try:
        versions = rate_manager.get_versions()
        return {"ok": True, "data": versions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"获取版本失败: {str(e)}")


@router.get("/rates/reload")
async def reload_rates():
    """
    重新加载费率配置
    """
    try:
        rate_manager.clear_cache()
        return {"ok": True, "message": "费率缓存已清空"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"重载失败: {str(e)}")


@router.get("/health")
async def health_check():
    """
    健康检查
    """
    return {"ok": True, "service": "finance-calc", "version": "1.0.0", "status": "healthy"}
