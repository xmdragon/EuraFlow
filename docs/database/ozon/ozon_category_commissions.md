# ozon_category_commissions

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/category_commissions.py`
- **模型类**: `OzonCategoryCommission`
- **用途**: Ozon类目佣金模型

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Unknown | PK | - | 佣金记录ID |
| category_module | String(200) | NO | - | 类目模块（一级类目，如：美容、电子产品） |
| category_name | String(200) | NO | - | 商品类目（二级类目，如：专业医疗设备） |
| rfbs_tier1 | DECIMAL(5, 2) | NO | - | rFBS方案佣金 - 最多1500卢布（含） |
| rfbs_tier2 | DECIMAL(5, 2) | NO | - | rFBS方案佣金 - 最多5000卢布（含） |
| rfbs_tier3 | DECIMAL(5, 2) | NO | - | rFBS方案佣金 - 超过5000卢布 |
| fbp_tier1 | DECIMAL(5, 2) | NO | - | FBP方案佣金 - 最多1500卢布（含） |
| fbp_tier2 | DECIMAL(5, 2) | NO | - | FBP方案佣金 - 最多5000卢布（含） |
| fbp_tier3 | DECIMAL(5, 2) | NO | - | FBP方案佣金 - 超过5000卢布 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |

## 索引

- `idx_ozon_category_commissions_module` (category_module)
- `idx_ozon_category_commissions_name` (category_name)
