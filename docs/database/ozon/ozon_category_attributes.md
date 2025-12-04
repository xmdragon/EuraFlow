# ozon_category_attributes

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonCategoryAttribute`
- **用途**: OZON类目属性缓存表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| category_id | Integer | NO | - | FK → ozon_categories.category_id |
| attribute_id | Integer | NO | - | - |
| name | String(500) | NO | - | 主显示名称（优先中文） |
| name_zh | String(500) | YES | - | 属性中文名称 |
| name_ru | String(500) | YES | - | 属性俄文名称 |
| description | Text | YES | - | 主显示描述（优先中文） |
| description_zh | Text | YES | - | 属性中文描述 |
| description_ru | Text | YES | - | 属性俄文描述 |
| attribute_type | String(50) | NO | - | string/number/boolean/dictionary/multivalue |
| is_required | Boolean | YES | False | 是否必填 |
| is_collection | Boolean | YES | False | 是否多值属性 |
| is_aspect | Boolean | YES | False | 是否方面属性（变体维度，入库后不可改） |
| dictionary_id | Integer | YES | - | 字典ID(如果是字典类型) |
| category_dependent | Boolean | YES | False | 字典值是否依赖类别 |
| group_id | Integer | YES | - | 特征组ID |
| group_name | String(200) | YES | - | 特征组名称（优先中文） |
| group_name_zh | String(200) | YES | - | 特征组中文名称 |
| group_name_ru | String(200) | YES | - | 特征组俄文名称 |
| attribute_complex_id | Integer | YES | - | 复合属性标识符 |
| complex_is_collection | Boolean | YES | False | 复合特征是否为集合 |
| min_value | Numeric(18, 4) | YES | - | - |
| max_value | Numeric(18, 4) | YES | - | - |
| max_value_count | Integer | YES | - | 多值属性的最大值数量 |
| cached_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_category_attrs_category` (category_id)
- `idx_ozon_category_attrs_required` (category_id, is_required)
- `idx_ozon_category_attrs_dict` (dictionary_id)

## 唯一约束

- uq_ozon_category_attrs: (category_id, attribute_id)

## 外键关系

- `category_id` → `ozon_categories.category_id`
