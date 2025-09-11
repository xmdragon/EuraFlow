-- Ozon 插件数据库迁移脚本
-- 创建 Ozon 相关数据表

-- ============================
-- 商品相关表
-- ============================

-- 商品主表
CREATE TABLE IF NOT EXISTS ozon_products (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    
    -- SKU 映射
    sku VARCHAR(100) NOT NULL,
    offer_id VARCHAR(100) NOT NULL,
    ozon_product_id BIGINT,
    ozon_sku BIGINT,
    
    -- 商品信息
    title VARCHAR(500) NOT NULL,
    description VARCHAR(5000),
    barcode VARCHAR(50),
    category_id INTEGER,
    brand VARCHAR(200),
    
    -- 状态
    status VARCHAR(50) DEFAULT 'draft',
    visibility BOOLEAN DEFAULT TRUE,
    is_archived BOOLEAN DEFAULT FALSE,
    
    -- 价格
    price DECIMAL(18,4),
    old_price DECIMAL(18,4),
    premium_price DECIMAL(18,4),
    cost DECIMAL(18,4),
    min_price DECIMAL(18,4),
    
    -- 库存
    stock INTEGER DEFAULT 0,
    reserved INTEGER DEFAULT 0,
    available INTEGER DEFAULT 0,
    
    -- 尺寸重量
    weight DECIMAL(10,3),
    width DECIMAL(10,2),
    height DECIMAL(10,2),
    depth DECIMAL(10,2),
    
    -- 原始数据
    raw_payload JSONB,
    
    -- 同步信息
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    sync_error VARCHAR(1000),
    
    -- 时间戳
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    -- 唯一约束
    CONSTRAINT uq_ozon_products_shop_sku UNIQUE(shop_id, sku),
    CONSTRAINT uq_ozon_products_shop_offer UNIQUE(shop_id, offer_id)
);

-- 索引
CREATE INDEX idx_ozon_products_ozon_product_id ON ozon_products(ozon_product_id);
CREATE INDEX idx_ozon_products_status ON ozon_products(status);
CREATE INDEX idx_ozon_products_sync ON ozon_products(shop_id, sync_status, last_sync_at);

-- 商品变体
CREATE TABLE IF NOT EXISTS ozon_product_variants (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES ozon_products(id) ON DELETE CASCADE,
    
    variant_id VARCHAR(100) NOT NULL,
    variant_type VARCHAR(50),
    variant_value VARCHAR(200),
    variant_sku VARCHAR(100),
    variant_barcode VARCHAR(50),
    
    price DECIMAL(18,4),
    stock INTEGER DEFAULT 0,
    images JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_ozon_variants UNIQUE(product_id, variant_id)
);

CREATE INDEX idx_ozon_variants_sku ON ozon_product_variants(variant_sku);

-- 商品属性
CREATE TABLE IF NOT EXISTS ozon_product_attributes (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES ozon_products(id) ON DELETE CASCADE,
    
    attribute_id INTEGER NOT NULL,
    attribute_name VARCHAR(200),
    attribute_type VARCHAR(50),
    value JSONB,
    is_required BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_ozon_attributes UNIQUE(product_id, attribute_id)
);

-- 价格历史
CREATE TABLE IF NOT EXISTS ozon_price_history (
    id BIGSERIAL PRIMARY KEY,
    product_id BIGINT NOT NULL REFERENCES ozon_products(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL,
    
    price_before DECIMAL(18,4),
    price_after DECIMAL(18,4) NOT NULL,
    old_price_before DECIMAL(18,4),
    old_price_after DECIMAL(18,4),
    
    change_reason VARCHAR(200),
    changed_by VARCHAR(100),
    source VARCHAR(50),
    
    effective_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_price_history ON ozon_price_history(product_id, effective_at);
CREATE INDEX idx_ozon_price_history_shop ON ozon_price_history(shop_id, created_at);

-- 库存快照
CREATE TABLE IF NOT EXISTS ozon_inventory_snapshots (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    warehouse_id INTEGER,
    
    snapshot_date TIMESTAMP NOT NULL,
    inventory_data JSONB NOT NULL,
    
    total_skus INTEGER DEFAULT 0,
    total_stock INTEGER DEFAULT 0,
    total_value DECIMAL(18,4),
    
    reconciliation_status VARCHAR(50),
    discrepancies JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_inventory_snapshot ON ozon_inventory_snapshots(shop_id, snapshot_date);
CREATE INDEX idx_ozon_inventory_warehouse ON ozon_inventory_snapshots(warehouse_id, snapshot_date);

-- ============================
-- 订单相关表
-- ============================

-- 订单主表
CREATE TABLE IF NOT EXISTS ozon_orders (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    
    -- 订单号映射
    order_id VARCHAR(100) NOT NULL,
    ozon_order_id VARCHAR(100) NOT NULL,
    ozon_order_number VARCHAR(100),
    
    -- 状态
    status VARCHAR(50) NOT NULL,
    ozon_status VARCHAR(50),
    payment_status VARCHAR(50),
    
    -- 订单类型
    order_type VARCHAR(50) DEFAULT 'FBS',
    is_express BOOLEAN DEFAULT FALSE,
    is_premium BOOLEAN DEFAULT FALSE,
    
    -- 金额
    total_amount DECIMAL(18,4) NOT NULL,
    products_amount DECIMAL(18,4),
    delivery_amount DECIMAL(18,4),
    commission_amount DECIMAL(18,4),
    
    -- 客户信息
    customer_id VARCHAR(100),
    customer_phone VARCHAR(50),
    customer_email VARCHAR(200),
    
    -- 地址
    delivery_address JSONB,
    
    -- 配送信息
    delivery_method VARCHAR(100),
    delivery_date TIMESTAMP,
    delivery_time_slot VARCHAR(50),
    
    -- 原始数据
    raw_payload JSONB,
    
    -- 时间
    ordered_at TIMESTAMP NOT NULL,
    confirmed_at TIMESTAMP,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    
    -- 同步
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(50) DEFAULT 'pending',
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_ozon_orders_shop_order UNIQUE(shop_id, ozon_order_id)
);

CREATE INDEX idx_ozon_orders_status ON ozon_orders(shop_id, status);
CREATE INDEX idx_ozon_orders_date ON ozon_orders(shop_id, ordered_at);
CREATE INDEX idx_ozon_orders_sync ON ozon_orders(sync_status, last_sync_at);

-- 发货单（Posting）
CREATE TABLE IF NOT EXISTS ozon_postings (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES ozon_orders(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL,
    
    posting_number VARCHAR(100) NOT NULL UNIQUE,
    ozon_posting_number VARCHAR(100),
    
    status VARCHAR(50) NOT NULL,
    substatus VARCHAR(100),
    
    -- 发货信息
    shipment_date TIMESTAMP,
    delivery_method_id INTEGER,
    delivery_method_name VARCHAR(200),
    
    -- 仓库
    warehouse_id INTEGER,
    warehouse_name VARCHAR(200),
    
    -- 包裹
    packages_count INTEGER DEFAULT 1,
    total_weight DECIMAL(10,3),
    
    -- 取消
    is_cancelled BOOLEAN DEFAULT FALSE,
    cancel_reason_id INTEGER,
    cancel_reason VARCHAR(500),
    
    raw_payload JSONB,
    
    -- 时间
    in_process_at TIMESTAMP,
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_postings_status ON ozon_postings(shop_id, status);
CREATE INDEX idx_ozon_postings_date ON ozon_postings(shop_id, shipment_date);
CREATE INDEX idx_ozon_postings_warehouse ON ozon_postings(warehouse_id, status);

-- 订单商品明细
CREATE TABLE IF NOT EXISTS ozon_order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES ozon_orders(id) ON DELETE CASCADE,
    
    sku VARCHAR(100) NOT NULL,
    offer_id VARCHAR(100),
    ozon_sku BIGINT,
    
    name VARCHAR(500),
    
    quantity INTEGER NOT NULL,
    price DECIMAL(18,4) NOT NULL,
    discount DECIMAL(18,4) DEFAULT 0,
    total_amount DECIMAL(18,4) NOT NULL,
    
    status VARCHAR(50),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_order_items_sku ON ozon_order_items(sku);
CREATE INDEX idx_ozon_order_items_order ON ozon_order_items(order_id, status);

-- 发货包裹
CREATE TABLE IF NOT EXISTS ozon_shipment_packages (
    id BIGSERIAL PRIMARY KEY,
    posting_id BIGINT NOT NULL REFERENCES ozon_postings(id) ON DELETE CASCADE,
    
    package_number VARCHAR(100) NOT NULL,
    tracking_number VARCHAR(200),
    
    carrier_id INTEGER,
    carrier_name VARCHAR(200),
    carrier_code VARCHAR(50),
    
    weight DECIMAL(10,3),
    width DECIMAL(10,2),
    height DECIMAL(10,2),
    length DECIMAL(10,2),
    
    label_url VARCHAR(500),
    label_printed_at TIMESTAMP,
    
    status VARCHAR(50),
    status_updated_at TIMESTAMP,
    tracking_data JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_ozon_packages UNIQUE(posting_id, package_number)
);

CREATE INDEX idx_ozon_packages_tracking ON ozon_shipment_packages(tracking_number);

-- 退款退货
CREATE TABLE IF NOT EXISTS ozon_refunds (
    id BIGSERIAL PRIMARY KEY,
    order_id BIGINT NOT NULL REFERENCES ozon_orders(id) ON DELETE CASCADE,
    shop_id INTEGER NOT NULL,
    
    refund_id VARCHAR(100) NOT NULL UNIQUE,
    refund_type VARCHAR(50),
    
    posting_id BIGINT REFERENCES ozon_postings(id),
    
    refund_amount DECIMAL(18,4) NOT NULL,
    commission_refund DECIMAL(18,4),
    
    refund_items JSONB,
    
    reason_id INTEGER,
    reason VARCHAR(500),
    customer_comment VARCHAR(1000),
    
    status VARCHAR(50),
    
    requested_at TIMESTAMP NOT NULL,
    approved_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_refunds_status ON ozon_refunds(shop_id, status);
CREATE INDEX idx_ozon_refunds_date ON ozon_refunds(shop_id, requested_at);

-- ============================
-- 同步和运维表
-- ============================

-- 同步检查点
CREATE TABLE IF NOT EXISTS ozon_sync_checkpoints (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    
    last_cursor VARCHAR(500),
    last_sync_at TIMESTAMP,
    last_modified_at TIMESTAMP,
    
    status VARCHAR(50) DEFAULT 'idle',
    error_message VARCHAR(1000),
    retry_count INTEGER DEFAULT 0,
    
    total_processed BIGINT DEFAULT 0,
    total_success BIGINT DEFAULT 0,
    total_failed BIGINT DEFAULT 0,
    
    config JSONB,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    CONSTRAINT uq_ozon_checkpoint UNIQUE(shop_id, entity_type)
);

CREATE INDEX idx_ozon_checkpoint_status ON ozon_sync_checkpoints(status, last_sync_at);

-- 同步日志
CREATE TABLE IF NOT EXISTS ozon_sync_logs (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    sync_type VARCHAR(50),
    
    batch_id VARCHAR(100),
    batch_size INTEGER,
    
    status VARCHAR(50) NOT NULL,
    processed_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    
    error_message VARCHAR(2000),
    error_details JSONB,
    
    duration_ms INTEGER,
    api_calls INTEGER,
    rate_limit_hits INTEGER DEFAULT 0,
    
    started_at TIMESTAMP NOT NULL,
    completed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_sync_log_shop ON ozon_sync_logs(shop_id, entity_type, started_at);
CREATE INDEX idx_ozon_sync_log_status ON ozon_sync_logs(status, started_at);
CREATE INDEX idx_ozon_sync_log_batch ON ozon_sync_logs(batch_id);

-- Webhook事件
CREATE TABLE IF NOT EXISTS ozon_webhook_events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(200) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    shop_id INTEGER NOT NULL,
    
    payload JSONB NOT NULL,
    headers JSONB,
    
    signature VARCHAR(500),
    is_verified BOOLEAN DEFAULT FALSE,
    
    status VARCHAR(50) DEFAULT 'pending',
    processed_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    
    idempotency_key VARCHAR(200),
    error_message VARCHAR(1000),
    
    entity_type VARCHAR(50),
    entity_id VARCHAR(100),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_webhook_status ON ozon_webhook_events(status, created_at);
CREATE INDEX idx_ozon_webhook_shop ON ozon_webhook_events(shop_id, event_type, created_at);
CREATE INDEX idx_ozon_webhook_idempotency ON ozon_webhook_events(idempotency_key);
CREATE INDEX idx_ozon_webhook_entity ON ozon_webhook_events(entity_type, entity_id);

-- API指标
CREATE TABLE IF NOT EXISTS ozon_api_metrics (
    id BIGSERIAL PRIMARY KEY,
    shop_id INTEGER NOT NULL,
    endpoint VARCHAR(200) NOT NULL,
    method VARCHAR(10) NOT NULL,
    
    request_id VARCHAR(100),
    correlation_id VARCHAR(100),
    
    status_code INTEGER,
    response_time_ms INTEGER,
    
    is_error BOOLEAN DEFAULT FALSE,
    error_code VARCHAR(100),
    error_message VARCHAR(500),
    
    is_rate_limited BOOLEAN DEFAULT FALSE,
    retry_after INTEGER,
    
    requested_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_ozon_metrics_shop ON ozon_api_metrics(shop_id, requested_at);
CREATE INDEX idx_ozon_metrics_endpoint ON ozon_api_metrics(endpoint, status_code);
CREATE INDEX idx_ozon_metrics_errors ON ozon_api_metrics(is_error, error_code, requested_at);

-- Outbox事件
CREATE TABLE IF NOT EXISTS ozon_outbox_events (
    id BIGSERIAL PRIMARY KEY,
    event_id VARCHAR(100) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    
    aggregate_type VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(100) NOT NULL,
    
    event_data JSONB NOT NULL,
    
    status VARCHAR(50) DEFAULT 'pending',
    sent_at TIMESTAMP,
    retry_count INTEGER DEFAULT 0,
    next_retry_at TIMESTAMP,
    
    error_message VARCHAR(1000),
    
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ozon_outbox_status ON ozon_outbox_events(status, next_retry_at);
CREATE INDEX idx_ozon_outbox_aggregate ON ozon_outbox_events(aggregate_type, aggregate_id);