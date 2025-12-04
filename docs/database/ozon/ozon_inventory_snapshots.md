# ozon_inventory_snapshots

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/products.py`
- **模型类**: `OzonInventorySnapshot`
- **用途**: 库存快照（用于对账）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | Integer | NO | - | - |
| warehouse_id | Integer | YES | - | - |
| snapshot_date | DateTime | NO | - | - |
| inventory_data | JSONB | NO | - | - |
| total_skus | Integer | YES | 0 | - |
| total_stock | Integer | YES | 0 | - |
| total_value | Numeric(18, 4) | YES | - | - |
| reconciliation_status | String(50) | YES | - | - |
| discrepancies | JSONB | YES | - | - |
| created_at | DateTime | YES | utcnow | - |

## 索引

- `idx_ozon_inventory_snapshot` (shop_id, snapshot_date)
- `idx_ozon_inventory_warehouse` (warehouse_id, snapshot_date)
