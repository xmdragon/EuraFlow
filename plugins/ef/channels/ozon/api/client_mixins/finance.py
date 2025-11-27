"""
Ozon API 财务相关方法
"""

from typing import Any, Dict, List, Optional


class FinanceMixin:
    """财务相关 API 方法"""

    async def get_finance_transaction_totals(
        self,
        posting_number: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        transaction_type: str = "all"
    ) -> Dict[str, Any]:
        """
        获取财务清单数目（费用汇总）
        使用 /v3/finance/transaction/totals 接口

        Args:
            posting_number: 发货号（可选，与date参数二选一）
            date_from: 开始日期，格式YYYY-MM-DD或RFC3339（可选）
            date_to: 结束日期，格式YYYY-MM-DD或RFC3339（可选）
            transaction_type: 操作类型，默认"all"
                - all: 所有
                - orders: 订单
                - returns: 退货和取消
                - services: 服务费
                - compensation: 补贴
                - transferDelivery: 快递费用
                - other: 其他

        Returns:
            财务清单汇总数据，包含：
            - accruals_for_sale: 商品总成本和退货
            - sale_commission: 销售佣金
            - processing_and_delivery: 运输处理和配送费
            - refunds_and_cancellations: 退货和取消费用
            - compensation_amount: 补贴
            - money_transfer: 交货和退货费用
            - services_amount: 附加服务成本
            - others_amount: 其他应计费用
        """
        data = {
            "transaction_type": transaction_type
        }

        # 根据参数选择过滤方式（posting_number 或 date）
        if posting_number:
            # 按发货号查询
            data["posting_number"] = posting_number
        elif date_from and date_to:
            # 按日期范围查询
            # 如果是简单日期格式（YYYY-MM-DD），转换为RFC3339格式
            from_date = date_from if 'T' in date_from else f"{date_from}T00:00:00Z"
            to_date = date_to if 'T' in date_to else f"{date_to}T23:59:59Z"

            data["date"] = {
                "from": from_date,
                "to": to_date
            }
        else:
            raise ValueError("Either posting_number or both date_from and date_to must be provided")

        return await self._request(
            "POST",
            "/v3/finance/transaction/totals",
            data=data,
            resource_type="default"
        )

    async def get_finance_transaction_list(
        self,
        posting_number: Optional[str] = None,
        date_from: Optional[str] = None,
        date_to: Optional[str] = None,
        operation_type: Optional[List[str]] = None,
        transaction_type: str = "all",
        page: int = 1,
        page_size: int = 1000
    ) -> Dict[str, Any]:
        """
        获取财务交易明细列表
        使用 /v3/finance/transaction/list 接口

        Args:
            posting_number: 发货号（可选，与date参数二选一）
            date_from: 开始日期，格式YYYY-MM-DD（可选）
            date_to: 结束日期，格式YYYY-MM-DD（可选）
            operation_type: 交易类型列表（可选），如：
                - ClientReturnAgentOperation: 收到买家退货、取消订单
                - MarketplaceMarketingActionCostOperation: 商品促销服务
                - OperationAgentDeliveredToCustomer: 交付给买家
                - OperationClaim: 索赔应计
                - OperationItemReturn: 处理退货费用
                - OperationMarketplaceServiceStorage: 仓储费用
                等（完整列表见API文档）
            transaction_type: 收费类型，默认"all"
                - all: 所有
                - orders: 订单
                - returns: 退货和取消
                - services: 服务费
                - compensation: 补贴
                - transferDelivery: 运费
                - other: 其他
            page: 页码（必须大于0）
            page_size: 每页数量（最大1000）

        Returns:
            财务交易明细列表，包含：
            - operations: 交易操作列表
            - page_count: 总页数
            - row_count: 总交易数
        """
        data = {
            "transaction_type": transaction_type,
            "page": page,
            "page_size": min(page_size, 1000)
        }

        # 构建filter参数
        filter_data = {}

        # 根据参数选择过滤方式（posting_number 或 date）
        if posting_number:
            # 按发货号查询
            filter_data["posting_number"] = posting_number
        elif date_from and date_to:
            # 按日期范围查询
            # 转换为RFC3339格式
            from_date = f"{date_from}T00:00:00Z" if 'T' not in date_from else date_from
            to_date = f"{date_to}T23:59:59Z" if 'T' not in date_to else date_to

            filter_data["date"] = {
                "from": from_date,
                "to": to_date
            }
        else:
            raise ValueError("Either posting_number or both date_from and date_to must be provided")

        # 添加操作类型过滤（可选）
        if operation_type:
            filter_data["operation_type"] = operation_type

        data["filter"] = filter_data

        return await self._request(
            "POST",
            "/v3/finance/transaction/list",
            data=data,
            resource_type="default"
        )
