-- Ozon 商品上架功能数据库迁移脚本
-- 创建类目、属性、字典值和导入日志相关表

-- ============================
-- 类目与属性缓存表
-- ============================

-- 类目缓存表
CREATE TABLE IF NOT EXISTS ozon_categories (
    category_id INTEGER PRIMARY KEY,
    parent_id INTEGER,
    name VARCHAR(500) NOT NULL,
    is_leaf BOOLEAN DEFAULT FALSE,
    is_disabled BOOLEAN DEFAULT FALSE,
    level INTEGER DEFAULT 0,
    full_path VARCHAR(2000),  -- 完整路径(用/分隔)

    -- 缓存信息
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    -- 外键索引
    FOREIGN KEY (parent_id) REFERENCES ozon_categories(category_id) ON DELETE SET NULL
);

CREATE INDEX idx_ozon_categories_parent ON ozon_categories(parent_id);
CREATE INDEX idx_ozon_categories_leaf ON ozon_categories(is_leaf) WHERE is_leaf = TRUE;
CREATE INDEX idx_ozon_categories_name ON ozon_categories USING gin(to_tsvector('russian', name));

-- 类目属性缓存表
CREATE TABLE IF NOT EXISTS ozon_category_attributes (
    id BIGSERIAL PRIMARY KEY,
    category_id INTEGER NOT NULL,
    attribute_id INTEGER NOT NULL,

    -- 属性基本信息
    name VARCHAR(500) NOT NULL,
    description TEXT,
    attribute_type VARCHAR(50) NOT NULL,  -- string/number/boolean/dictionary/multivalue等

    -- 约束信息
    is_required BOOLEAN DEFAULT FALSE,
    is_collection BOOLEAN DEFAULT FALSE,  -- 是否多值属性
    dictionary_id INTEGER,

    -- 范围约束(用于数值型)
    min_value DECIMAL(18,4),
    max_value DECIMAL(18,4),

    -- 缓存信息
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(category_id, attribute_id)
);

CREATE INDEX idx_ozon_category_attrs_category ON ozon_category_attributes(category_id);
CREATE INDEX idx_ozon_category_attrs_required ON ozon_category_attributes(category_id, is_required) WHERE is_required = TRUE;
CREATE INDEX idx_ozon_category_attrs_dict ON ozon_category_attributes(dictionary_id) WHERE dictionary_id IS NOT NULL;

-- 属性字典值缓存表
CREATE TABLE IF NOT EXISTS ozon_attribute_dictionary_values (
    id BIGSERIAL PRIMARY KEY,
    dictionary_id INTEGER NOT NULL,
    value_id BIGINT NOT NULL,

    -- 值信息
    value TEXT NOT NULL,
    info TEXT,
    picture VARCHAR(500),

    -- 缓存信息
    cached_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(dictionary_id, value_id)
);

CREATE INDEX idx_ozon_dict_values_dict ON ozon_attribute_dictionary_values(dictionary_id);
CREATE INDEX idx_ozon_dict_values_search ON ozon_attribute_dictionary_values USING gin(to_tsvector('russian', value));

-- ============================
-- 商品上架日志表
-- ============================

-- 媒体导入日志表
CREATE TABLE IF NOT EXISTS ozon_media_import_logs (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    offer_id VARCHAR(100) NOT NULL,

    -- 图片信息
    source_url TEXT NOT NULL,  -- Cloudinary URL
    file_name VARCHAR(500),
    position INTEGER DEFAULT 0,  -- 图片位置(0=主图)

    -- OZON 响应
    ozon_file_id VARCHAR(100),
    ozon_url TEXT,
    task_id VARCHAR(100),

    -- 状态
    state VARCHAR(50) DEFAULT 'pending',  -- pending/uploading/uploaded/failed
    error_code VARCHAR(100),
    error_message TEXT,

    -- 重试信息
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP WITH TIME ZONE,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_media_logs_offer ON ozon_media_import_logs(shop_id, offer_id);
CREATE INDEX idx_ozon_media_logs_state ON ozon_media_import_logs(state, created_at);
CREATE INDEX idx_ozon_media_logs_task ON ozon_media_import_logs(task_id) WHERE task_id IS NOT NULL;

-- 商品导入日志表
CREATE TABLE IF NOT EXISTS ozon_product_import_logs (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    offer_id VARCHAR(100) NOT NULL,

    -- 请求信息
    import_mode VARCHAR(20) DEFAULT 'NEW_CARD',  -- NEW_CARD/FOLLOW_PDP
    request_payload JSONB NOT NULL,

    -- OZON 响应
    task_id VARCHAR(100),
    response_payload JSONB,

    -- 状态
    state VARCHAR(50) DEFAULT 'submitted',  -- submitted/processing/created/price_sent/failed
    error_code VARCHAR(100),
    error_message TEXT,
    errors JSONB,  -- 详细错误列表

    -- 结果
    ozon_product_id BIGINT,
    ozon_sku BIGINT,

    -- 重试信息
    retry_count INTEGER DEFAULT 0,
    last_retry_at TIMESTAMP WITH TIME ZONE,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_product_logs_offer ON ozon_product_import_logs(shop_id, offer_id);
CREATE INDEX idx_ozon_product_logs_state ON ozon_product_import_logs(state, created_at);
CREATE INDEX idx_ozon_product_logs_task ON ozon_product_import_logs(task_id) WHERE task_id IS NOT NULL;

-- 价格更新日志表
CREATE TABLE IF NOT EXISTS ozon_price_update_logs (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    offer_id VARCHAR(100) NOT NULL,

    -- 价格信息
    currency_code VARCHAR(10) DEFAULT 'RUB',
    price DECIMAL(18,4) NOT NULL,
    old_price DECIMAL(18,4),
    min_price DECIMAL(18,4),

    -- 定价策略
    auto_action_enabled BOOLEAN DEFAULT FALSE,
    price_strategy_enabled BOOLEAN DEFAULT FALSE,

    -- 状态
    state VARCHAR(50) DEFAULT 'pending',  -- pending/accepted/failed
    error_message TEXT,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_price_logs_offer ON ozon_price_update_logs(shop_id, offer_id, created_at);
CREATE INDEX idx_ozon_price_logs_state ON ozon_price_update_logs(state, created_at);

-- 库存更新日志表
CREATE TABLE IF NOT EXISTS ozon_stock_update_logs (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    offer_id VARCHAR(100) NOT NULL,

    -- 库存信息
    product_id BIGINT,
    warehouse_id INTEGER NOT NULL,
    stock INTEGER NOT NULL,

    -- 状态
    state VARCHAR(50) DEFAULT 'pending',  -- pending/accepted/failed
    error_message TEXT,

    -- 时间戳
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_stock_logs_offer ON ozon_stock_update_logs(shop_id, offer_id, created_at);
CREATE INDEX idx_ozon_stock_logs_state ON ozon_stock_update_logs(state, created_at);
CREATE INDEX idx_ozon_stock_logs_warehouse ON ozon_stock_update_logs(warehouse_id, created_at);

-- ============================
-- 扩展现有表字段
-- ============================

-- 为 ozon_products 表添加上架状态机相关字段
ALTER TABLE ozon_products
    ADD COLUMN IF NOT EXISTS listing_status VARCHAR(50) DEFAULT 'draft',
    ADD COLUMN IF NOT EXISTS listing_mode VARCHAR(20),  -- NEW_CARD/FOLLOW_PDP
    ADD COLUMN IF NOT EXISTS media_ready_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS import_submitted_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS created_at_ozon TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS priced_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS stock_set_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS live_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS listing_error_code VARCHAR(100),
    ADD COLUMN IF NOT EXISTS listing_error_message TEXT,
    ADD COLUMN IF NOT EXISTS currency_code VARCHAR(10) DEFAULT 'RUB';

-- 添加状态索引
CREATE INDEX IF NOT EXISTS idx_ozon_products_listing_status ON ozon_products(listing_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_ozon_products_shop_listing ON ozon_products(shop_id, listing_status);

-- 为 ozon_products 添加图片字段(如果不存在)
ALTER TABLE ozon_products
    ADD COLUMN IF NOT EXISTS images JSONB,
    ADD COLUMN IF NOT EXISTS ozon_visibility_details JSONB,
    ADD COLUMN IF NOT EXISTS ozon_status VARCHAR(50),
    ADD COLUMN IF NOT EXISTS status_reason VARCHAR(200),
    ADD COLUMN IF NOT EXISTS ozon_archived BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ozon_has_fbo_stocks BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ozon_has_fbs_stocks BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ozon_is_discounted BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ozon_visibility_status VARCHAR(100);

-- 添加OZON状态索引
CREATE INDEX IF NOT EXISTS idx_ozon_products_ozon_archived ON ozon_products(ozon_archived);
CREATE INDEX IF NOT EXISTS idx_ozon_products_ozon_visibility ON ozon_products(ozon_visibility_status);

-- ============================
-- 注释(PostgreSQL COMMENT)
-- ============================

COMMENT ON TABLE ozon_categories IS 'OZON 类目缓存表';
COMMENT ON TABLE ozon_category_attributes IS 'OZON 类目属性缓存表';
COMMENT ON TABLE ozon_attribute_dictionary_values IS 'OZON 属性字典值缓存表';
COMMENT ON TABLE ozon_media_import_logs IS 'OZON 媒体导入日志表';
COMMENT ON TABLE ozon_product_import_logs IS 'OZON 商品导入日志表';
COMMENT ON TABLE ozon_price_update_logs IS 'OZON 价格更新日志表';
COMMENT ON TABLE ozon_stock_update_logs IS 'OZON 库存更新日志表';

COMMENT ON COLUMN ozon_products.listing_status IS '上架状态: draft/media_ready/import_submitted/created/priced/ready_for_sale/live/error';
COMMENT ON COLUMN ozon_products.listing_mode IS '上架模式: NEW_CARD(新建卡)/FOLLOW_PDP(跟随卡)';
COMMENT ON COLUMN ozon_products.currency_code IS '货币代码: CNY/RUB/USD等';
