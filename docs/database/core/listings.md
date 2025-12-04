# listings

## 基本信息

- **模型文件**: `ef_core/models/listings.py`
- **模型类**: `Listing`
- **用途**: 商品价格表

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | BigInteger | PK | - | - |
| shop_id | BigInteger | NO | - | 店铺ID |
| sku | Text | NO | - | 商品SKU |
| price_rub | CheckConstraint(price_rub >= 0) | NO | - | 当前价格（卢布） |
| price_old_rub | CheckConstraint(price_old_rub >= price_rub) | YES | - | 划线价（卢布） |
| updated_at | DateTime | NO | server: now() | 最后更新时间 |

## 索引

- `ix_listings_shop` (shop_id)
- `ix_listings_sku` (sku)
- `ix_listings_price` (price_rub)
- `ix_listings_updated` (updated_at)

## 唯一约束

- uq_listings_shop_sku: (shop_id, sku)
