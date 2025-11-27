"""
商品状态计算器

负责计算商品的5种状态：
- on_sale: 在售
- ready_to_sell: 准备出售
- error: 错误
- pending_modification: 待修改
- inactive: 已下架/未激活
- archived: 已归档
"""

from typing import Dict, Any, Optional, Tuple
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)


class ProductStatusCalculator:
    """商品状态计算器"""

    # 状态常量
    STATUS_ON_SALE = "on_sale"
    STATUS_READY_TO_SELL = "ready_to_sell"
    STATUS_ERROR = "error"
    STATUS_PENDING_MODIFICATION = "pending_modification"
    STATUS_INACTIVE = "inactive"
    STATUS_ARCHIVED = "archived"

    def calculate_status(
        self,
        visibility_type: str,
        sync_is_archived: bool,
        ozon_archived: bool,
        is_archived: bool,
        product_details: Optional[Dict[str, Any]],
        visibility_details: Dict[str, Any],
        price: Optional[Decimal],
        has_fbo_stocks: bool,
        has_fbs_stocks: bool,
    ) -> Tuple[str, str, str]:
        """
        计算商品状态

        Args:
            visibility_type: API 返回的可见性类型 (VISIBLE, INVISIBLE, ARCHIVED)
            sync_is_archived: 是否来自归档过滤器
            ozon_archived: OZON 平台归档状态
            is_archived: 本地归档状态
            product_details: 商品详情
            visibility_details: 可见性详情
            price: 商品价格
            has_fbo_stocks: 是否有 FBO 库存
            has_fbs_stocks: 是否有 FBS 库存

        Returns:
            (status, ozon_status, status_reason) 元组
        """
        # ===== 优先级1: 归档状态（最高优先级）=====
        is_archived_final = self._check_archived(
            sync_is_archived, ozon_archived, is_archived, product_details
        )

        if is_archived_final:
            return self.STATUS_ARCHIVED, self.STATUS_ARCHIVED, "商品已归档"

        # ===== 优先级2: INVISIBLE 商品细分 =====
        if visibility_type == "INVISIBLE":
            return self._calculate_invisible_status(product_details)

        # ===== 优先级3: VISIBLE 商品细分 =====
        return self._calculate_visible_status(
            visibility_details, price, has_fbo_stocks, has_fbs_stocks
        )

    def _check_archived(
        self,
        sync_is_archived: bool,
        ozon_archived: bool,
        is_archived: bool,
        product_details: Optional[Dict[str, Any]],
    ) -> bool:
        """检查是否为归档状态"""
        # 检查多个归档字段，任一为真即判定为归档
        return (
            sync_is_archived or
            ozon_archived or
            is_archived or
            (product_details and (
                product_details.get("is_archived", False) or
                product_details.get("is_autoarchived", False)
            ))
        )

    def _calculate_invisible_status(
        self,
        product_details: Optional[Dict[str, Any]],
    ) -> Tuple[str, str, str]:
        """计算 INVISIBLE 商品的状态"""
        # 检查是否有错误信息（如违规、审核不通过）
        if product_details and (product_details.get("errors") or product_details.get("warnings")):
            return self.STATUS_ERROR, self.STATUS_ERROR, "商品信息有误或违规"

        # 检查是否需要修改（如待审核、待补充信息）
        if product_details and product_details.get("moderation_status") == "PENDING":
            return (
                self.STATUS_PENDING_MODIFICATION,
                self.STATUS_PENDING_MODIFICATION,
                "商品待修改或审核中"
            )

        # 默认为已下架
        return self.STATUS_INACTIVE, self.STATUS_INACTIVE, "商品已下架"

    def _calculate_visible_status(
        self,
        visibility_details: Dict[str, Any],
        price: Optional[Decimal],
        has_fbo_stocks: bool,
        has_fbs_stocks: bool,
    ) -> Tuple[str, str, str]:
        """计算 VISIBLE 商品的状态"""
        has_price = visibility_details.get("has_price", True)
        has_stock = visibility_details.get("has_stock", True)

        # 既有价格又有库存，商品在售
        if has_price and has_stock:
            return self.STATUS_ON_SALE, self.STATUS_ON_SALE, "商品正常销售中"

        # 缺少价格或库存，准备销售状态
        if not has_price:
            return self.STATUS_READY_TO_SELL, self.STATUS_READY_TO_SELL, "商品缺少价格信息"

        if not has_stock:
            return self.STATUS_READY_TO_SELL, self.STATUS_READY_TO_SELL, "商品缺少库存"

        # 价格为0
        if not price or price == Decimal("0"):
            return self.STATUS_READY_TO_SELL, self.STATUS_READY_TO_SELL, "商品价格为0"

        # 无任何库存
        if not has_fbo_stocks and not has_fbs_stocks:
            return self.STATUS_READY_TO_SELL, self.STATUS_READY_TO_SELL, "商品无任何库存"

        # 默认在售
        return self.STATUS_ON_SALE, self.STATUS_ON_SALE, "商品正常销售中"

    def has_sync_errors(self, product_details: Optional[Dict[str, Any]]) -> bool:
        """检查商品是否有同步错误"""
        if not product_details:
            return False
        return bool(product_details.get("errors") or product_details.get("warnings"))

    def get_error_list(self, product_details: Optional[Dict[str, Any]]) -> list:
        """获取错误列表"""
        if not product_details:
            return []

        error_list = []
        if product_details.get("errors"):
            error_list.extend(product_details["errors"])
        if product_details.get("warnings"):
            error_list.extend(product_details["warnings"])
        return error_list
