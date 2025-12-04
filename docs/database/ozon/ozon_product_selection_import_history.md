# ozon_product_selection_import_history

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/product_selection.py`
- **模型类**: `ImportHistory`
- **用途**: 导入历史记录

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | - |
| file_name | String(255) | NO | - | 文件名 |
| file_type | String(10) | NO | - | 文件类型(xlsx/csv) |
| file_size | Integer | YES | - | 文件大小(字节) |
| imported_by | Integer | NO | - | 导入用户ID |
| import_time | DateTime | NO | - | 导入时间 |
| import_strategy | String(20) | YES | 'update' | 导入策略(skip/update/append) |
| total_rows | Integer | YES | 0 | 总行数 |
| success_rows | Integer | YES | 0 | 成功行数 |
| failed_rows | Integer | YES | 0 | 失败行数 |
| updated_rows | Integer | YES | 0 | 更新行数 |
| skipped_rows | Integer | YES | 0 | 跳过行数 |
| import_log | JSON | YES | - | 导入日志详情 |
| error_details | JSON | YES | - | 错误详情 |
| process_duration | Integer | YES | - | 处理耗时(秒) |
| created_at | DateTime | NO | - | - |
