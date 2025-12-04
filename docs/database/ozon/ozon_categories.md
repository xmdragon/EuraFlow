# ozon_categories

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonCategory`
- **用途**: OZON类目缓存表

注意：OZON的类目树设计允许同一个子类目（type_id）出现在多个父类目下，
因此使用 (category_id, parent_id) 的组合作为唯一标识

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | 自增主键 |
| category_id | Integer | NO | - | OZON类目ID |
| parent_id | Integer | YES | - | 父类目ID |
| name | String(500) | NO | - | 主显示名称（优先中文） |
| name_zh | String(500) | YES | - | 类目中文名称 |
| name_ru | String(500) | YES | - | 类目俄文名称 |
| is_leaf | Boolean | YES | False | 是否叶子类目(只有叶子类目可建品) |
| is_disabled | Boolean | YES | False | - |
| is_deprecated | Boolean | YES | False | 是否已废弃(不再出现在OZON API中) |
| level | Integer | YES | 0 | 层级深度 |
| full_path | String(2000) | YES | - | 完整路径(用/分隔) |
| cached_at | DateTime | YES | utcnow | - |
| last_updated_at | DateTime | YES | utcnow | - |
| attributes_synced_at | DateTime | YES | - | 特征最后同步时间 |

## 索引

- `idx_ozon_categories_category_parent` (category_id, parent_id)
- `idx_ozon_categories_category_id` (category_id)
- `idx_ozon_categories_parent` (parent_id)
- `idx_ozon_categories_leaf` (is_leaf)
- `idx_ozon_categories_attrs_synced_at` (attributes_synced_at)
- `idx_ozon_categories_name` (name)
