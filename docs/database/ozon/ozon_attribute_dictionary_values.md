# ozon_attribute_dictionary_values

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/listing.py`
- **模型类**: `OzonAttributeDictionaryValue`
- **用途**: OZON属性字典值缓存表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| dictionary_id | Integer | NO | - | - |
| value_id | BigInteger | NO | - | - |
| value | Text | NO | - | 主显示值（优先中文） |
| value_zh | Text | YES | - | 字典值中文 |
| value_ru | Text | YES | - | 字典值俄文 |
| info | Text | YES | - | 附加信息（优先中文） |
| info_zh | Text | YES | - | 附加信息中文 |
| info_ru | Text | YES | - | 附加信息俄文 |
| picture | String(500) | YES | - | - |
| cached_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_dict_values_dict` (dictionary_id)
- `idx_ozon_dict_values_search` (value)

## 唯一约束

- uq_ozon_dict_values: (dictionary_id, value_id)
