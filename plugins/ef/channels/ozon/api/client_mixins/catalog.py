"""
Ozon API 类目/属性/商品导入相关方法
"""

from typing import Any, Dict, List, Optional

from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class CatalogMixin:
    """类目/属性/商品导入相关 API 方法"""

    async def get_category_tree(
        self,
        category_id: Optional[int] = None,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        获取类目树
        使用 /v1/description-category/tree 接口

        Args:
            category_id: 父类目ID（可选，不填则获取根类目）
            language: 语言（ZH_HANS/DEFAULT/RU/EN/TR）

        Returns:
            类目树数据
        """
        data = {
            "language": language
        }

        if category_id:
            data["description_category_id"] = category_id

        return await self._request(
            "POST",
            "/v1/description-category/tree",
            data=data,
            resource_type="categories"
        )

    async def get_category_attributes(
        self,
        category_id: int,
        type_id: int,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        获取类目属性列表
        使用 /v1/description-category/attribute 接口

        Args:
            category_id: 类别ID（description_category_id，即父类别ID）
            type_id: 商品类型ID（叶子节点ID）
            language: 语言（DEFAULT/RU/EN/ZH_HANS等）

        Returns:
            类目属性列表
        """
        data = {
            "description_category_id": category_id,
            "type_id": type_id,
            "language": language
        }

        return await self._request(
            "POST",
            "/v1/description-category/attribute",
            data=data,
            resource_type="categories"
        )

    async def get_attribute_values(
        self,
        attribute_id: int,
        category_id: int,
        parent_category_id: Optional[int] = None,
        last_value_id: int = 0,
        limit: int = 2000,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        获取属性字典值列表
        使用 /v1/description-category/attribute/values 接口

        Args:
            attribute_id: 属性ID
            category_id: 叶子类目ID（type_id）
            parent_category_id: 父类目ID（description_category_id），如果不提供则使用category_id
            last_value_id: 上次请求的最后一个value_id（用于分页）
            limit: 每页数量（最大2000）
            language: 语言（默认ZH_HANS中文）

        Returns:
            属性字典值列表
        """
        data = {
            "attribute_id": attribute_id,
            "description_category_id": parent_category_id if parent_category_id else category_id,
            "type_id": category_id,  # 叶子类目的 type_id
            "last_value_id": last_value_id,
            "limit": min(limit, 2000),  # API 最大支持 2000
            "language": language
        }

        return await self._request(
            "POST",
            "/v1/description-category/attribute/values",
            data=data,
            resource_type="categories"
        )

    async def search_attribute_values(
        self,
        attribute_id: int,
        category_id: int,
        parent_category_id: Optional[int] = None,
        query: str = "",
        limit: int = 100,
        language: str = "ZH_HANS"
    ) -> Dict[str, Any]:
        """
        搜索属性字典值
        使用 /v1/description-category/attribute/values/search 接口

        Args:
            attribute_id: 属性ID
            category_id: 叶子类目ID（type_id）
            parent_category_id: 父类目ID（description_category_id），如果不提供则使用category_id
            query: 搜索关键词（至少2个字符，空字符串表示不搜索）
            limit: 返回数量限制（最大1000）
            language: 语言（默认ZH_HANS中文）

        Returns:
            搜索结果列表
        """
        data = {
            "attribute_id": attribute_id,
            "description_category_id": parent_category_id if parent_category_id else category_id,
            "type_id": category_id,  # 叶子类目的 type_id
            "limit": min(limit, 1000),  # API 最大支持 1000
            "language": language,
            "value": query  # 搜索关键词
        }

        return await self._request(
            "POST",
            "/v1/description-category/attribute/values/search",
            data=data,
            resource_type="categories"
        )

    async def import_products(
        self,
        products: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        批量导入商品（新建卡或跟随卡）
        使用 /v3/product/import 接口

        Args:
            products: 商品信息列表（最多100个），每个包含：
                - offer_id: 商家SKU（必需，幂等键）
                - barcode: 条码（可选，跟随卡必需）
                - category_id: 类目ID（必需，必须是叶子类目）
                - name: 商品名称（必需）
                - description: 描述（可选）
                - dimensions: 尺寸重量（必需）
                    {"weight": 克, "height": 毫米, "width": 毫米, "length": 毫米}
                - images: 图片文件名列表（可选，如果已导入图片）
                - attributes: 属性列表（必需）
                    [{"attribute_id": id, "value": "值"} or {"attribute_id": id, "dictionary_value_id": id}]

        Returns:
            导入结果，包含：
            - result: {"task_id": 任务ID}
        """
        if not products:
            raise ValueError("Products list cannot be empty")

        if len(products) > 100:
            raise ValueError("Maximum 100 products per batch")

        data = {
            "items": products
        }

        logger.info(f"[OZON API] Importing {len(products)} products")

        return await self._request(
            "POST",
            "/v3/product/import",
            data=data,
            resource_type="products"
        )

    async def import_products_by_sku(
        self,
        items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        通过SKU批量创建商品（复制现有商品卡片）
        使用 /v1/product/import-by-sku 接口

        Args:
            items: 商品信息列表（最多1000个），每个包含：
                - sku: OZON SKU（必需，正整数）
                - offer_id: 商家SKU（必需，店铺内唯一）
                - price: 售价（必需，字符串格式）
                - name: 商品名称（可选）
                - old_price: 原价（可选）
                - vat: 增值税率（可选，0-1范围）
                - currency_code: 货币代码（可选，默认CNY）

        Returns:
            导入结果，包含：
            - result: {
                "task_id": 任务ID（用于轮询状态）,
                "unmatched_sku_list": 未匹配的商品ID列表
              }
        """
        if not items:
            raise ValueError("Items list cannot be empty")

        if len(items) > 1000:
            raise ValueError("Maximum 1000 products per batch")

        # 自动设置默认货币为 CNY
        for item in items:
            if 'currency_code' not in item:
                item['currency_code'] = 'CNY'

        data = {
            "items": items
        }

        logger.info(f"[OZON API] Importing {len(items)} products by SKU")

        return await self._request(
            "POST",
            "/v1/product/import-by-sku",
            data=data,
            resource_type="products"
        )

    async def get_import_product_info(
        self,
        task_id: str
    ) -> Dict[str, Any]:
        """
        查询商品导入进度和结果
        使用 /v1/product/import/info 接口

        Args:
            task_id: 导入任务ID

        Returns:
            导入状态信息，包含：
            - result: {"items": [商品导入详情列表]}
            每个商品包含：
            - offer_id: 商家SKU
            - product_id: OZON商品ID（导入成功后）
            - status: 状态（imported/failed等）
            - errors: 错误列表（如果失败）
        """
        data = {
            "task_id": task_id
        }

        return await self._request(
            "POST",
            "/v1/product/import/info",
            data=data,
            resource_type="products"
        )
