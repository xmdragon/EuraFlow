# /v1/products/geo-restrictions-catalog-by-filter

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v1/products/geo-restrictions-catalog-by-filter`

## 详细信息

方法 | 变更内容  
---|---  
/v1/posting/cutoff/set | 已添加用于确认由非集成运输商或卖家配送的货件日期的方法。  
/v3/posting/fbs/unfulfilled/list  
/v3/posting/fbs/list | 新增参数`result.postings.available_actions`至方法的响应中。  
/v3/posting/fbs/get | 新增参数`result.available_actions`至方法的响应中。  
— | 新增关于指定由非集成承运商或卖家配送货件（按rFBS Crossborder模式）的发运日期信息。  
/v1/products/geo-restrictions-catalog-by-filter | 从文档中删除了方法 /v1/products/geo-restrictions-catalog-by-filter。  
/v3/product/import | 更新了该方法请求中参数 `items.geo_names` 的描述。
