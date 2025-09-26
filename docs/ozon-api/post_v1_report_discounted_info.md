# /v1/report/discounted/info

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/report/discounted/info`

## 详细信息

方法 | 变更内容  
---|---  
/v3/product/info/stocks | 响应示例已更新。现在，方式将返回所有工作方案（FBO、FBS和Crossborder）的商品库存，哪怕您并未使用其中的某些方案。  
/v1/report/info | 在方式响应中的`status`参数，我们添加了`waiting`和`processing`这两种状态描述。  
/v3/posting/fbs/ship | 该方式将在未来被淘汰并停止使用。请切换到我们在方式描述中提到的新版本。  
/v1/report/warehouse/stock | 新增用于生成仓库库存报告的方法。  
/v1/report/list | 在方法响应中添加了链接，该链接用于获取`report_type="SELLER_RETURNS"`的报告，同时也标明了该链接的有效期。  
/v1/report/returns/create | 在方法相应中添加了可以根据ID获取报告的有效期。  
/v1/report/stock/create | 方法已过时，已从文档中删除。请使用/v1/report/warehouse/stock。  
/v1/report/discounted/info | 方法已过时，已从文档中删除。要获取打折商品的报告，请通过 /v1/report/discounted/create 生成，并通过 /v1/report/info 获取。  
/v1/report/discounted/list | 方法已过时，已从文档中删除。要获取打折商品的报告列表，请将 `report_type="SELLER_PRODUCT_DISCOUNTED"` 作为参数，调用 /v1/report/info 方法。  
/v1/report/products/movement/create | 方法已过时，已从文档中删除。
