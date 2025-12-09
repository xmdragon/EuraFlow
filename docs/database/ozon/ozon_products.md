# ozon_products

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/products.py`
- **模型类**: `OzonProduct`
- **用途**: Ozon 商品映射表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| offer_id | String(100) | NO | - | 卖家SKU（商品货号） |
| ozon_product_id | BigInteger | YES | - | Ozon商品ID |
| ozon_sku | BigInteger | YES | - | Ozon SKU |
| title | String(500) | NO | - | 商品标题(俄文) |
| title_cn | String(500) | YES | - | 中文名称(用于商品创建和管理) |
| description | String(5000) | YES | - | - |
| barcode | String(50) | YES | - | 主条形码 |
| barcodes | JSONB | YES | - | 所有条形码数组 |
| category_id | Integer | YES | - | - |
| brand | String(200) | YES | - | - |
| status | String(50) | YES | - | - |
| visibility | Boolean | YES | True | - |
| is_archived | Boolean | YES | False | - |
| ozon_archived | Boolean | YES | False | OZON归档状态 |
| ozon_has_fbo_stocks | Boolean | YES | False | 是否有FBO库存 |
| ozon_has_fbs_stocks | Boolean | YES | False | 是否有FBS库存 |
| ozon_is_discounted | Boolean | YES | False | 是否打折 |
| ozon_visibility_status | String(100) | YES | - | OZON可见性状态 |
| price | Numeric(18, 4) | YES | - | 售价 |
| old_price | Numeric(18, 4) | YES | - | 原价 |
| premium_price | Numeric(18, 4) | YES | - | 会员价 |
| cost | Numeric(18, 4) | YES | - | 成本 |
| min_price | Numeric(18, 4) | YES | - | 最低价 |
| currency_code | String(10) | YES | - | 货币代码(CNY/RUB/USD等) |
| vat | String(10) | YES | '0' | 增值税率 |
| purchase_url | String(1000) | YES | - | 采购地址 |
| suggested_purchase_price | Numeric(18, 4) | YES | - | 建议采购价 |
| purchase_note | String(500) | YES | - | 采购备注 |
| stock | Integer | YES | 0 | - |
| reserved | Integer | YES | 0 | - |
| available | Integer | YES | 0 | - |
| warehouse_stocks | JSONB | YES | - | 按仓库分组的库存详情: [{warehouse_id, warehouse_name, present, reserved}] |
| weight | Numeric(10, 3) | YES | - | 重量(kg) |
| width | Numeric(10, 2) | YES | - | 宽度(cm) |
| height | Numeric(10, 2) | YES | - | 高度(cm) |
| depth | Numeric(10, 2) | YES | - | 深度(cm) |
| dimension_unit | String(10) | YES | - | 尺寸单位(mm/cm/in) |
| weight_unit | String(10) | YES | - | 重量单位 |
| description_category_id | BigInteger | YES | - | 类目标识符 |
| type_id | BigInteger | YES | - | 商品类型标识符 |
| color_image | String(200) | YES | - | 市场营销色彩 |
| primary_image | String(500) | YES | - | 主图链接 |
| attributes | JSON | YES | - | 商品属性 |
| ozon_attributes | JSONB | YES | - | 商品特征数组 |
| complex_attributes | JSONB | YES | - | 嵌套特征列表 |
| model_info | JSONB | YES | - | 型号信息 |
| pdf_list | JSONB | YES | - | PDF文件列表 |
| attributes_with_defaults | JSONB | YES | - | 具有默认值的特征ID列表 |
| raw_payload | JSONB | YES | - | Ozon原始数据 |
| images | JSONB | YES | - | 商品图片数据 |
| images360 | JSONB | YES | - | 360度全景图URL数组 |
| videos | JSONB | YES | - | 商品视频数据 [{url, name, is_cover}] |
| ozon_visibility_details | JSONB | YES | - | OZON可见性详情 |
| ozon_status | String(50) | YES | - | OZON原始状态 |
| status_reason | String(200) | YES | - | 状态原因说明 |
| promotions | JSONB | YES | - | 关联的促销活动ID数组 |
| ozon_variants | JSONB | YES | - | OZON原始变体数据(完整JSON) |
| last_sync_at | DateTime | YES | - | - |
| sync_status | String(50) | YES | 'pending' | - |
| sync_error | String(1000) | YES | - | - |
| listing_status | String(50) | YES | - | 上架状态: draft/media_ready/import_submitted/created/priced/live/ready_for_sale/error |
| listing_mode | String(20) | YES | - | 上架模式: NEW_CARD/FOLLOW_PDP |
| listing_error_code | String(100) | YES | - | 上架错误代码 |
| listing_error_message | String(1000) | YES | - | 上架错误消息 |
| media_ready_at | DateTime | YES | - | 媒体准备完成时间 |
| import_submitted_at | DateTime | YES | - | 导入提交时间 |
| sales_count | Integer | YES | 0 | 累计销量 |
| last_sale_at | DateTime | YES | - | 最后销售时间 |
| ozon_created_at | DateTime | YES | - | OZON平台创建时间 |
| created_at | DateTime | YES | utcnow | - |
| updated_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_products_ozon_product_id` (ozon_product_id)
- `idx_ozon_products_status` (status)
- `idx_ozon_products_ozon_archived` (ozon_archived)
- `idx_ozon_products_ozon_visibility` (ozon_visibility_status)
- `idx_ozon_products_sync` (shop_id, sync_status, last_sync_at)
- `idx_ozon_products_title_cn` (title_cn)
- `idx_ozon_products_shop_status` (shop_id, status)
- `idx_ozon_products_shop_created` (shop_id, created_at)
- `idx_ozon_products_shop_updated` (shop_id, updated_at)

## 唯一约束

- uq_ozon_products_shop_offer: (shop_id, offer_id)
