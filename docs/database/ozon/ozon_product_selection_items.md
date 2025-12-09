# ozon_product_selection_items

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/product_selection.py`
- **模型类**: `ProductSelectionItem`
- **用途**: 选品商品数据模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | - |
| user_id | Integer | NO | - | FK → users.id | 用户ID |
| product_id | String(50) | NO | - | 商品ID |
| product_name_ru | String(500) | YES | - | 俄文名称 |
| product_name_cn | String(500) | YES | - | 中文名称 |
| ozon_link | Text | YES | - | 商品链接 |
| image_url | Text | YES | - | 图片链接 |
| category_link | Text | YES | - | 类目链接 |
| brand | String(200) | YES | - | 品牌 |
| brand_normalized | String(200) | YES | - | 标准化品牌名 |
| current_price | Numeric(18, 2) | YES | - | 当前价格(RMB元) |
| original_price | Numeric(18, 2) | YES | - | 原价(RMB元) |
| rfbs_commission_low | Numeric(5, 2) | YES | - | rFBS(<=1500₽)佣金率 |
| rfbs_commission_mid | Numeric(5, 2) | YES | - | rFBS(1501-5000₽)佣金率 |
| rfbs_commission_high | Numeric(5, 2) | YES | - | rFBS(>5000₽)佣金率 |
| fbp_commission_low | Numeric(5, 2) | YES | - | FBP(<=1500₽)佣金率 |
| fbp_commission_mid | Numeric(5, 2) | YES | - | FBP(1501-5000₽)佣金率 |
| fbp_commission_high | Numeric(5, 2) | YES | - | FBP(>5000₽)佣金率 |
| monthly_sales_volume | Integer | YES | - | 月销量(件) |
| monthly_sales_revenue | Numeric(18, 2) | YES | - | 月销售额(RUB) |
| daily_sales_volume | Numeric(10, 2) | YES | - | 平均日销量(件) |
| daily_sales_revenue | Numeric(18, 2) | YES | - | 平均日销售额(RUB) |
| sales_dynamic_percent | Numeric(10, 2) | YES | - | 销售动态(%) |
| conversion_rate | Numeric(5, 2) | YES | - | 成交率(%) |
| competitor_count | Integer | YES | 0 | 跟卖者数量 |
| competitor_min_price | Numeric(18, 2) | YES | - | 跟卖最低价(RMB元) |
| market_min_price | Numeric(18, 2) | YES | - | 市场最低价(RMB元) |
| price_index | Numeric(10, 2) | YES | - | 价格指数 |
| package_weight | Integer | YES | - | 包装重量(克) |
| package_volume | Numeric(10, 2) | YES | - | 包装体积(升) |
| package_length | Integer | YES | - | 包装长度(mm) |
| package_width | Integer | YES | - | 包装宽度(mm) |
| package_height | Integer | YES | - | 包装高度(mm) |
| rating | Numeric(3, 2) | YES | - | 商品评分 |
| review_count | Integer | YES | - | 评价数量 |
| seller_type | String(50) | YES | - | 卖家类型(FBS/FBO) |
| delivery_days | Integer | YES | - | 配送时间(天) |
| availability_percent | Numeric(5, 2) | YES | - | 商品可用性(%) |
| ad_cost_share | Numeric(5, 2) | YES | - | 广告费用份额(%) |
| card_views | Integer | YES | - | 商品卡片浏览量 |
| card_add_to_cart_rate | Numeric(5, 2) | YES | - | 商品卡片加购率(%) |
| search_views | Integer | YES | - | 搜索和目录浏览量 |
| search_add_to_cart_rate | Numeric(5, 2) | YES | - | 搜索和目录加购率(%) |
| click_through_rate | Numeric(5, 2) | YES | - | 点击率(%) |
| promo_days | Integer | YES | - | 参与促销天数 |
| promo_discount_percent | Numeric(5, 2) | YES | - | 参与促销的折扣(%) |
| promo_conversion_rate | Numeric(5, 2) | YES | - | 促销活动的转化率(%) |
| paid_promo_days | Integer | YES | - | 付费推广天数 |
| return_cancel_rate | Numeric(5, 2) | YES | - | 退货取消率(%) |
| category_path | String(500) | YES | - | 类目路径（完整路径，如：儿童用品 > 小雕塑） |
| category_level_1 | String(200) | YES | - | 一级类目 |
| category_level_2 | String(200) | YES | - | 二级类目 |
| avg_price | Numeric(18, 2) | YES | - | 平均价格(RUB) |
| listing_date | DateTime | YES | - | 上架时间 |
| listing_days | Integer | YES | - | 上架天数 |
| seller_mode | String(20) | YES | - | 发货模式(FBS/FBO) |
| images_data | JSON | YES | - | 商品图片信息列表 |
| images_updated_at | DateTime | YES | - | 图片信息更新时间 |
| batch_id | Integer | YES | - | FK → ozon_product_selection_import_history.id | 导入批次ID |
| is_read | Boolean | NO | False | 是否已读 |
| read_at | DateTime | YES | - | 标记已读时间 |
| created_at | DateTime | NO | - | - |
| updated_at | DateTime | NO | - | - |

## 索引

- `idx_brand_price` (brand_normalized, current_price)
- `idx_sales_weight` (monthly_sales_volume, package_weight)
- `idx_commission` (rfbs_commission_low, rfbs_commission_mid, fbp_commission_low, fbp_commission_mid)
- `idx_batch_read` (batch_id, is_read)

## 外键关系

- `user_id` → `users.id`
- `batch_id` → `ozon_product_selection_import_history.id`
