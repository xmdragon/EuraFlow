# ozon_collection_sources

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/collection_source.py`
- **模型类**: `OzonCollectionSource`
- **用途**: OZON 自动采集地址表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| user_id | Integer | NO | - | FK → users.id | 用户ID |
| source_type | String(20) | NO | - | 类型：category（类目页）| seller（店铺页）| highlight（专题页）| other（其他） |
| source_url | Text | NO | - | 完整 URL |
| source_path | String(500) | NO | - | URL 路径部分（用于批次名，如 /category/elektronika-15500/） |
| display_name | String(200) | YES | - | 显示名称（用户自定义） |
| is_enabled | Boolean | NO | True | 是否启用 |
| priority | Integer | NO | 0 | 优先级（数值越高优先级越高） |
| target_count | Integer | NO | 100 | 每次采集目标数量 |
| status | String(20) | NO | 'pending' | 状态：pending | collecting | completed | failed |
| last_collected_at | DateTime | YES | - | 上次采集完成时间（UTC） |
| last_product_count | Integer | NO | 0 | 上次采集的商品数量 |
| total_collected_count | Integer | NO | 0 | 累计采集商品数量 |
| last_error | Text | YES | - | 最后一次错误信息 |
| error_count | Integer | NO | 0 | 连续错误次数 |
| created_at | DateTime | NO | utcnow | 创建时间（UTC） |
| updated_at | DateTime | NO | utcnow | 更新时间（UTC） |

## 索引

- `idx_collection_source_user_enabled` (user_id, is_enabled)
- `idx_collection_source_last_collected` (last_collected_at)
- `idx_collection_source_status` (user_id, status)

## 唯一约束

- uq_collection_source_user_path: (user_id, source_path)

## 外键关系

- `user_id` → `users.id`
