# inventories

## 基本信息

- **模型文件**: `ef_core/models/inventory.py`
- **模型类**: `Inventory`
- **用途**: 库存表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | BigInteger | NO | - | 店铺ID |
| sku | Text | NO | - | 商品SKU |
| qty_available | CheckConstraint(qty_available >= 0) | NO | - | 可售库存数量 |
| threshold | CheckConstraint(threshold >= 0) | NO | 0 | 安全库存阈值 |
| unit_price | Numeric(18, 4) | YES | - | 采购单价（每件商品采购价格） |
| notes | String(500) | YES | - | 备注 |
| updated_at | DateTime | NO | server: now() | 最后更新时间 |

## 索引

- `ix_inventories_shop` (shop_id)
- `ix_inventories_sku` (sku)
- `ix_inventories_threshold` (shop_id, threshold, qty_available)
- `ix_inventories_updated` (updated_at)

## 唯一约束

- uq_inventories_shop_sku: (shop_id, sku)
