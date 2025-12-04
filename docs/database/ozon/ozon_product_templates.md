# ozon_product_templates

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/draft_template.py`
- **模型类**: `OzonProductTemplate`
- **用途**: OZON 商品草稿与模板表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| user_id | Integer | NO | - | FK → users.id | 创建用户ID |
| template_type | String(20) | NO | - | draft | template |
| template_name | String(200) | YES | - | 模板名称（草稿可为空） |
| shop_id | Integer | YES | - | 店铺ID（可选，用于筛选） |
| category_id | Integer | YES | - | 类目ID（可选，用于展示） |
| form_data | JSONB | NO | - | 完整表单数据（包括基础信息、特征值、图片、变体等） |
| tags | ARRAY | YES | - | 模板标签（最多10个） |
| used_count | Integer | NO | 0 | 模板使用次数 |
| last_used_at | DateTime | YES | - | 最后使用时间（UTC） |
| created_at | DateTime | NO | utcnow | 创建时间（UTC） |
| updated_at | DateTime | NO | utcnow | 更新时间（UTC） |

## 索引

- `idx_templates_user_type` (user_id, template_type)
- `idx_templates_shop` (shop_id)
- `idx_templates_category` (category_id)
- `idx_templates_updated_at` (updated_at)
- `idx_templates_user_draft` (user_id)

## 外键关系

- `user_id` → `users.id`
