# /v1/finance/realization

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/finance/realization`

## 详细信息

方法 | 变更内容  
---|---  
/v3/product/import | 已从方法请求中移除参数 `items.image_group_id` 和 `items.premium_price`。  
/v1/product/import/info | 已从方法响应中移除参数 `result.items.errors.optional_description_elements`。  
/v1/product/import-by-sku | 已从方法请求中移除参数 `items.premium_price`。  
/v3/posting/fbs/list  
/v3/posting/fbs/unfulfilled/list | 已从方法响应中移除参数 `result.postings.financial_data.products.client_price`，`result.postings.financial_data.products.picking` 和 `result.postings.products.mandatory_mark`。  
/v3/posting/fbs/get  
/v2/posting/fbs/get-by-barcode | 已从方法响应中移除参数 `result.financial_data.products.client_price`，`result.financial_data.products.picking` 和 `result.products.mandatory_mark`。  
/v1/finance/realization | 该方法已过时，已从文档中删除。 请改用 /v2/finance/realization。  
/v1/product/import/stocks | 方法将于2025年5月27日停用。请改用 /v2/products/stocks。
