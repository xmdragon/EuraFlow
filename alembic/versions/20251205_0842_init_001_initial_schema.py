"""initial_schema - 统一初始化迁移

Revision ID: init_001
Revises:
Create Date: 2025-12-05

此迁移脚本基于生产数据库结构生成，用于新环境部署。
包含所有表、索引、约束的创建。

对于已有数据的生产环境，只需将 alembic_version 标记为此版本：
    INSERT INTO alembic_version (version_num) VALUES ('init_001');
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = 'init_001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create all tables"""

    # ========================================
    # 1. 创建扩展
    # ========================================
    op.execute('CREATE EXTENSION IF NOT EXISTS pg_trgm')

    # ========================================
    # 2. 创建序列
    # ========================================
    op.execute('''CREATE SEQUENCE aliyun_oss_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE aliyun_translation_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE api_keys_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE audit_logs_archive_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE chatgpt_translation_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE cloudinary_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE exchange_rate_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE exchange_rates_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE inventories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE kuajing84_global_config_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE kuajing84_sync_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE listings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_attribute_dictionary_values_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_cancellations_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_categories_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_categories_category_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_category_attributes_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_category_commissions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_chat_messages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_chats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_collection_sources_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_daily_stats_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_domestic_tracking_numbers_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_finance_sync_watermarks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_finance_transactions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_global_settings_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_media_import_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_order_items_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_orders_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_postings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_price_update_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_product_collection_records_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_product_import_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_product_selection_import_history_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_product_selection_items_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_product_sync_errors_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_product_templates_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_promotion_actions_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_promotion_products_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_refunds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_returns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_shipment_packages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_shops_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_stock_update_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_sync_checkpoints_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_sync_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_warehouses_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE ozon_webhook_events_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE packages_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE refunds_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE returns_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE shipments_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE sync_service_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE sync_services_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE user_settings_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE users_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE watermark_configs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')
    op.execute('''CREATE SEQUENCE xiangjifanyi_configs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;''')

    # ========================================
    # 3. 创建表（按依赖顺序）
    # ========================================
    # alembic_version 由 alembic 自动管理，无需手动创建

    op.execute('''CREATE TABLE aliyun_oss_configs (
    id integer NOT NULL,
    access_key_id character varying(100),
    access_key_secret_encrypted text,
    bucket_name character varying(100) NOT NULL,
    endpoint character varying(255) NOT NULL,
    region_id character varying(50) DEFAULT 'cn-shanghai'::character varying NOT NULL,
    product_images_folder character varying(100) DEFAULT 'products'::character varying NOT NULL,
    watermark_images_folder character varying(100) DEFAULT 'watermarks'::character varying NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    last_test_at timestamp with time zone,
    last_test_success boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    product_videos_folder character varying(100) DEFAULT 'videos'::character varying NOT NULL
);''')

    op.execute('''CREATE TABLE aliyun_translation_configs (
    id integer NOT NULL,
    access_key_id character varying(100),
    access_key_secret_encrypted text,
    region_id character varying(50) DEFAULT 'cn-hangzhou'::character varying NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    last_test_at timestamp with time zone,
    last_test_success boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_default boolean DEFAULT true NOT NULL
);''')

    op.execute('''CREATE TABLE api_keys (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    key_hash character varying(255) NOT NULL,
    name character varying(100) NOT NULL,
    permissions json NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_used_at timestamp with time zone,
    expires_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE audit_logs (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    username character varying(100) NOT NULL,
    module character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    action_display character varying(100),
    table_name character varying(100) NOT NULL,
    record_id character varying(100) NOT NULL,
    changes jsonb,
    ip_address inet,
    user_agent character varying(500),
    request_id character varying(100),
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE audit_logs_archive (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    username character varying(100) NOT NULL,
    module character varying(50) NOT NULL,
    action character varying(50) NOT NULL,
    action_display character varying(100),
    table_name character varying(100) NOT NULL,
    record_id character varying(100) NOT NULL,
    changes jsonb,
    ip_address inet,
    user_agent character varying(500),
    request_id character varying(100),
    notes text,
    created_at timestamp with time zone NOT NULL
);''')

    op.execute('''CREATE TABLE chatgpt_translation_configs (
    id integer NOT NULL,
    api_key_encrypted text,
    base_url character varying(255),
    model_name character varying(100) DEFAULT 'gpt-5-mini'::character varying NOT NULL,
    system_prompt text DEFAULT '你是一名专业的中俄互译翻译器。
- 所有输出只包含译文，不要任何解释、前后缀或引号。
- 保持原文的语气和礼貌程度。
- 优先使用地道、口语化但自然的表达，适合电商、社交、即时通讯场景。
- 如果输入中文，就翻译成俄文；如果输入俄文，就翻译成中文。'::text NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    last_test_at timestamp with time zone,
    last_test_success boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE cloudinary_configs (
    id bigint NOT NULL,
    cloud_name character varying(100) NOT NULL,
    api_key character varying(100) NOT NULL,
    api_secret_encrypted text NOT NULL,
    auto_cleanup_days integer NOT NULL,
    last_quota_check timestamp with time zone,
    storage_used_bytes bigint,
    bandwidth_used_bytes bigint,
    is_active boolean NOT NULL,
    last_test_at timestamp with time zone,
    last_test_success boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    product_images_folder character varying(100) DEFAULT 'products'::character varying NOT NULL,
    watermark_images_folder character varying(100) DEFAULT 'watermarks'::character varying NOT NULL,
    is_default boolean DEFAULT true NOT NULL,
    product_videos_folder character varying(100) DEFAULT 'videos'::character varying NOT NULL
);''')

    op.execute('''CREATE TABLE exchange_rate_config (
    id integer NOT NULL,
    api_key character varying(200) NOT NULL,
    api_provider character varying(50) DEFAULT 'exchangerate-api'::character varying NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    base_currency character varying(3) DEFAULT 'CNY'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE exchange_rates (
    id integer NOT NULL,
    from_currency character varying(3) NOT NULL,
    to_currency character varying(3) NOT NULL,
    rate numeric(18,6) NOT NULL,
    fetched_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    source character varying(50) DEFAULT 'exchangerate-api'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE inventories (
    id bigint NOT NULL,
    shop_id bigint NOT NULL,
    sku text NOT NULL,
    qty_available integer NOT NULL,
    threshold integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    notes character varying(500),
    unit_price numeric(18,4)
);''')

    op.execute('''CREATE TABLE kuajing84_global_config (
    id integer NOT NULL,
    username character varying(100),
    password text,
    base_url character varying(200) DEFAULT 'https://www.kuajing84.com'::character varying,
    cookie jsonb,
    cookie_expires_at timestamp with time zone,
    enabled boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
    customer_id character varying(50)
);''')

    op.execute('''CREATE TABLE kuajing84_sync_logs (
    id bigint NOT NULL,
    ozon_order_id bigint NOT NULL,
    shop_id integer NOT NULL,
    order_number character varying(100) NOT NULL,
    logistics_order character varying(100) NOT NULL,
    kuajing84_oid character varying(100),
    sync_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    error_message text,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    synced_at timestamp with time zone,
    sync_type character varying(20) DEFAULT 'submit_tracking'::character varying NOT NULL,
    posting_id bigint,
    started_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE listings (
    id bigint NOT NULL,
    shop_id bigint NOT NULL,
    sku text NOT NULL,
    price_rub numeric(18,4) NOT NULL,
    price_old_rub numeric(18,4),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE order_items (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    sku text NOT NULL,
    offer_id text,
    qty integer NOT NULL,
    price_rub numeric(18,4) NOT NULL
);''')

    op.execute(r'''CREATE TABLE orders (
    id bigint NOT NULL,
    platform text NOT NULL,
    shop_id bigint NOT NULL,
    external_id text NOT NULL,
    external_no text NOT NULL,
    status text NOT NULL,
    external_status text NOT NULL,
    is_cod boolean NOT NULL,
    payment_method text NOT NULL,
    buyer_name text NOT NULL,
    buyer_phone_raw text,
    buyer_phone_e164 text,
    buyer_email text,
    address_country text NOT NULL,
    address_region text NOT NULL,
    address_city text NOT NULL,
    address_street text NOT NULL,
    address_postcode text NOT NULL,
    platform_created_ts timestamp with time zone NOT NULL,
    platform_updated_ts timestamp with time zone NOT NULL,
    fx_rate numeric(18,6) NOT NULL,
    currency text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    idempotency_key text NOT NULL,
    CONSTRAINT ck_orders_address_country CHECK ((address_country = 'RU'::text)),
    CONSTRAINT ck_orders_phone_e164_format CHECK (((buyer_phone_e164 IS NULL) OR (buyer_phone_e164 ~ '^\+[1-9]\d{6,14}$'::text)))
);''')

    op.execute('''CREATE TABLE ozon_attribute_dictionary_values (
    id bigint NOT NULL,
    dictionary_id integer NOT NULL,
    value_id bigint NOT NULL,
    value text NOT NULL,
    info text,
    picture character varying(500),
    cached_at timestamp with time zone,
    value_zh text,
    value_ru text,
    info_zh text,
    info_ru text
);''')

    op.execute('''CREATE TABLE ozon_cancellations (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    posting_id bigint,
    order_id bigint,
    cancellation_id bigint NOT NULL,
    posting_number character varying(100) NOT NULL,
    state character varying(50) NOT NULL,
    state_name character varying(200),
    cancellation_initiator character varying(50),
    cancellation_reason_id integer,
    cancellation_reason_name character varying(500),
    cancellation_reason_message text,
    approve_comment text,
    approve_date timestamp with time zone,
    auto_approve_date timestamp with time zone,
    order_date timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone NOT NULL,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_categories (
    category_id integer NOT NULL,
    parent_id integer,
    name character varying(500) NOT NULL,
    is_leaf boolean,
    is_disabled boolean,
    is_deprecated boolean,
    level integer,
    full_path character varying(2000),
    cached_at timestamp with time zone,
    last_updated_at timestamp with time zone,
    attributes_synced_at timestamp with time zone,
    id integer DEFAULT nextval('ozon_categories_id_seq'::regclass) NOT NULL,
    name_zh character varying(500),
    name_ru character varying(500)
);''')

    op.execute('''CREATE TABLE ozon_category_attributes (
    id bigint NOT NULL,
    category_id integer NOT NULL,
    attribute_id integer NOT NULL,
    name character varying(500) NOT NULL,
    description text,
    attribute_type character varying(50) NOT NULL,
    is_required boolean,
    is_collection boolean,
    dictionary_id integer,
    min_value numeric(18,4),
    max_value numeric(18,4),
    cached_at timestamp with time zone,
    is_aspect boolean DEFAULT false,
    group_id integer,
    group_name character varying(200),
    category_dependent boolean DEFAULT false,
    attribute_complex_id integer,
    max_value_count integer,
    complex_is_collection boolean DEFAULT false,
    name_zh character varying(500),
    name_ru character varying(500),
    description_zh text,
    description_ru text,
    group_name_zh character varying(200),
    group_name_ru character varying(200)
);''')

    op.execute('''CREATE TABLE ozon_category_commissions (
    id integer NOT NULL,
    category_module character varying(200) NOT NULL,
    category_name character varying(200) NOT NULL,
    rfbs_tier1 numeric(5,2) NOT NULL,
    rfbs_tier2 numeric(5,2) NOT NULL,
    rfbs_tier3 numeric(5,2) NOT NULL,
    fbp_tier1 numeric(5,2) NOT NULL,
    fbp_tier2 numeric(5,2) NOT NULL,
    fbp_tier3 numeric(5,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_chat_messages (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    chat_id character varying(100) NOT NULL,
    message_id character varying(100) NOT NULL,
    message_type character varying(50),
    sender_type character varying(50) NOT NULL,
    sender_id character varying(100),
    sender_name character varying(200),
    content text,
    content_data jsonb,
    is_read boolean,
    is_deleted boolean,
    is_edited boolean,
    order_number character varying(100),
    product_id bigint,
    metadata jsonb,
    read_at timestamp with time zone,
    edited_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone,
    data_cn text
);''')

    op.execute('''CREATE TABLE ozon_chats (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    chat_id character varying(100) NOT NULL,
    chat_type character varying(50),
    subject character varying(500),
    customer_id character varying(100),
    customer_name character varying(200),
    status character varying(50),
    is_closed boolean,
    order_number character varying(100),
    product_id bigint,
    message_count integer,
    unread_count integer,
    last_message_at timestamp with time zone,
    last_message_preview character varying(1000),
    metadata jsonb,
    closed_at timestamp with time zone,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone,
    is_archived boolean DEFAULT false NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_collection_sources (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    source_type character varying(20) NOT NULL,
    source_url text NOT NULL,
    source_path character varying(500) NOT NULL,
    display_name character varying(200),
    is_enabled boolean NOT NULL,
    priority integer NOT NULL,
    target_count integer NOT NULL,
    status character varying(20) NOT NULL,
    last_collected_at timestamp with time zone,
    last_product_count integer NOT NULL,
    total_collected_count integer NOT NULL,
    last_error text,
    error_count integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_collection_source_status CHECK (((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('collecting'::character varying)::text, ('completed'::character varying)::text, ('failed'::character varying)::text]))),
    CONSTRAINT chk_collection_source_target_count CHECK ((target_count > 0))
);''')

    op.execute('''CREATE TABLE ozon_daily_stats (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    date date NOT NULL,
    order_count integer DEFAULT 0 NOT NULL,
    delivered_count integer DEFAULT 0 NOT NULL,
    cancelled_count integer DEFAULT 0 NOT NULL,
    total_sales numeric(18,4) DEFAULT '0'::numeric NOT NULL,
    total_purchase numeric(18,4) DEFAULT '0'::numeric NOT NULL,
    total_profit numeric(18,4) DEFAULT '0'::numeric NOT NULL,
    total_commission numeric(18,4) DEFAULT '0'::numeric NOT NULL,
    total_logistics numeric(18,4) DEFAULT '0'::numeric NOT NULL,
    total_material_cost numeric(18,4) DEFAULT '0'::numeric NOT NULL,
    top_products jsonb,
    generated_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_domestic_tracking_numbers (
    id bigint NOT NULL,
    posting_id bigint NOT NULL,
    tracking_number character varying(200) NOT NULL,
    created_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_finance_sync_watermarks (
    id integer NOT NULL,
    shop_id integer NOT NULL,
    last_sync_date timestamp with time zone,
    sync_status character varying(20) DEFAULT 'idle'::character varying,
    sync_error text,
    total_synced_count integer DEFAULT 0,
    last_sync_count integer DEFAULT 0,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_finance_transactions (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    operation_id bigint NOT NULL,
    operation_type character varying(200) NOT NULL,
    operation_type_name character varying(500),
    transaction_type character varying(50) NOT NULL,
    posting_number character varying(100),
    operation_date timestamp with time zone NOT NULL,
    accruals_for_sale numeric(18,4) DEFAULT '0'::numeric,
    amount numeric(18,4) DEFAULT '0'::numeric,
    delivery_charge numeric(18,4) DEFAULT '0'::numeric,
    return_delivery_charge numeric(18,4) DEFAULT '0'::numeric,
    sale_commission numeric(18,4) DEFAULT '0'::numeric,
    ozon_sku character varying(100),
    item_name character varying(500),
    item_quantity integer,
    item_price numeric(18,4),
    posting_delivery_schema character varying(200),
    posting_warehouse_name character varying(200),
    services_json jsonb,
    raw_data jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_global_settings (
    id integer NOT NULL,
    setting_key character varying(100) NOT NULL,
    setting_value jsonb NOT NULL,
    description character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_media_import_logs (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    offer_id character varying(100) NOT NULL,
    source_url text NOT NULL,
    file_name character varying(500),
    "position" integer,
    ozon_file_id character varying(100),
    ozon_url text,
    task_id character varying(100),
    state character varying(50),
    error_code character varying(100),
    error_message text,
    retry_count integer,
    last_retry_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_order_items (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    offer_id character varying(100),
    ozon_sku bigint,
    name character varying(500),
    quantity integer NOT NULL,
    price numeric(18,4) NOT NULL,
    discount numeric(18,4) DEFAULT '0'::numeric,
    total_amount numeric(18,4) NOT NULL,
    status character varying(50),
    created_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_orders (
    id bigint NOT NULL,
    shop_id bigint NOT NULL,
    order_id character varying(100) NOT NULL,
    order_number character varying(100),
    posting_number character varying(100),
    status character varying(50),
    substatus character varying(50),
    delivery_type character varying(200),
    is_express boolean NOT NULL,
    is_premium boolean NOT NULL,
    total_price numeric(18,4),
    products_price numeric(18,4),
    delivery_price numeric(18,4),
    commission_amount numeric(18,4),
    customer_id character varying(100),
    customer_phone character varying(50),
    customer_email character varying(200),
    delivery_address json,
    delivery_method character varying(100),
    tracking_number character varying(100),
    items json,
    in_process_at timestamp with time zone,
    shipment_date timestamp with time zone,
    delivering_date timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    cancel_reason text,
    analytics_data json,
    financial_data json,
    sync_status character varying(20),
    sync_error text,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    warehouse_id bigint,
    warehouse_name character varying(200),
    tpl_provider_id integer,
    tpl_provider_name character varying(200),
    tpl_integration_type character varying(50),
    provider_status character varying(100),
    upper_barcode character varying(100),
    lower_barcode character varying(100),
    cancel_reason_id integer,
    cancellation_type character varying(50),
    cancelled_after_ship boolean,
    affect_cancellation_rating boolean,
    cancellation_initiator character varying(50),
    previous_substatus character varying(50),
    requirements json,
    addressee json,
    is_legal boolean,
    payment_type character varying(100),
    delivery_date_begin timestamp with time zone,
    delivery_date_end timestamp with time zone,
    sync_mode character varying(20),
    sync_version integer,
    barcodes json,
    cancellation_detail json,
    delivery_method_detail json,
    optional_info json,
    related_postings json,
    product_exemplars json,
    legal_info json,
    translit json,
    ozon_order_id character varying(100) NOT NULL,
    ozon_order_number character varying(100),
    ozon_status character varying(50),
    payment_status character varying(50),
    order_type character varying(50) DEFAULT 'FBS'::character varying,
    delivery_date timestamp with time zone,
    delivery_time_slot character varying(50),
    raw_payload jsonb,
    ordered_at timestamp with time zone NOT NULL,
    confirmed_at timestamp with time zone,
    shipped_at timestamp with time zone,
    client_delivery_date_begin timestamp with time zone,
    client_delivery_date_end timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_postings (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    shop_id integer NOT NULL,
    posting_number character varying(100) NOT NULL,
    ozon_posting_number character varying(100),
    status character varying(50) NOT NULL,
    substatus character varying(100),
    shipment_date timestamp with time zone,
    delivery_method_id bigint,
    delivery_method_name character varying(200),
    warehouse_id bigint,
    warehouse_name character varying(200),
    packages_count integer DEFAULT 1,
    total_weight numeric(10,3),
    is_cancelled boolean DEFAULT false,
    cancel_reason_id integer,
    cancel_reason character varying(500),
    raw_payload jsonb,
    in_process_at timestamp with time zone,
    shipped_at timestamp with time zone,
    delivered_at timestamp with time zone,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    material_cost numeric(18,2),
    purchase_price numeric(18,2),
    purchase_price_updated_at timestamp with time zone,
    order_notes character varying(1000),
    operation_time timestamp with time zone,
    operation_status character varying(50) DEFAULT 'awaiting_stock'::character varying NOT NULL,
    kuajing84_sync_error character varying(200),
    kuajing84_last_sync_at timestamp with time zone,
    last_mile_delivery_fee_cny numeric(18,2),
    international_logistics_fee_cny numeric(18,2),
    ozon_commission_cny numeric(18,2),
    finance_synced_at timestamp with time zone,
    profit numeric(18,2),
    profit_rate numeric(10,4),
    label_pdf_path character varying(500),
    label_printed_at timestamp with time zone,
    label_print_count integer DEFAULT 0 NOT NULL,
    source_platform jsonb,
    order_total_price numeric(18,2),
    has_tracking_number boolean DEFAULT false NOT NULL,
    has_domestic_tracking boolean DEFAULT false NOT NULL,
    product_skus character varying[],
    has_purchase_info boolean DEFAULT false NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_price_update_logs (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    offer_id character varying(100) NOT NULL,
    currency_code character varying(10),
    price numeric(18,4) NOT NULL,
    old_price numeric(18,4),
    min_price numeric(18,4),
    auto_action_enabled boolean,
    price_strategy_enabled boolean,
    state character varying(50),
    error_message text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_product_collection_records (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    shop_id integer,
    collection_type character varying(20) NOT NULL,
    source_url text NOT NULL,
    source_product_id character varying(100),
    product_data jsonb NOT NULL,
    listing_request_payload jsonb,
    listing_task_id character varying(100),
    listing_status character varying(50),
    listing_product_id bigint,
    listing_error_message text,
    listing_at timestamp without time zone,
    is_read boolean DEFAULT false,
    is_deleted boolean DEFAULT false,
    last_edited_at timestamp without time zone,
    last_edited_by integer,
    created_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    updated_at timestamp without time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    CONSTRAINT chk_collection_type CHECK (((collection_type)::text = ANY (ARRAY[('follow_pdp'::character varying)::text, ('collect_only'::character varying)::text])))
);''')

    op.execute('''CREATE TABLE ozon_product_import_logs (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    offer_id character varying(100) NOT NULL,
    import_mode character varying(20),
    request_payload jsonb NOT NULL,
    task_id character varying(100),
    response_payload jsonb,
    state character varying(50),
    error_code character varying(100),
    error_message text,
    errors jsonb,
    ozon_product_id bigint,
    ozon_sku bigint,
    retry_count integer,
    last_retry_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_product_selection_import_history (
    id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_type character varying(10) NOT NULL,
    file_size integer,
    imported_by integer NOT NULL,
    import_time timestamp with time zone NOT NULL,
    import_strategy character varying(20),
    total_rows integer,
    success_rows integer,
    failed_rows integer,
    updated_rows integer,
    skipped_rows integer,
    import_log json,
    error_details json,
    process_duration integer,
    created_at timestamp with time zone NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_product_selection_items (
    id integer NOT NULL,
    product_id character varying(50) NOT NULL,
    product_name_ru character varying(500),
    product_name_cn character varying(500),
    ozon_link text,
    image_url text,
    category_link text,
    brand character varying(200),
    brand_normalized character varying(200),
    current_price numeric(18,2),
    original_price numeric(18,2),
    rfbs_commission_low numeric(5,2),
    rfbs_commission_mid numeric(5,2),
    rfbs_commission_high numeric(5,2),
    fbp_commission_low numeric(5,2),
    fbp_commission_mid numeric(5,2),
    fbp_commission_high numeric(5,2),
    monthly_sales_volume integer,
    monthly_sales_revenue numeric(18,2),
    daily_sales_volume numeric(10,2),
    daily_sales_revenue numeric(18,2),
    sales_dynamic_percent numeric(10,2),
    conversion_rate numeric(5,2),
    package_weight integer,
    package_volume numeric(10,2),
    package_length integer,
    package_width integer,
    package_height integer,
    rating numeric(3,2),
    review_count integer,
    seller_type character varying(50),
    delivery_days integer,
    availability_percent numeric(5,2),
    ad_cost_share numeric(5,2),
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    competitor_count integer DEFAULT 0,
    competitor_min_price numeric(18,2),
    market_min_price numeric(18,2),
    price_index numeric(10,2),
    images_data json,
    images_updated_at timestamp with time zone,
    user_id integer NOT NULL,
    batch_id integer,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    card_views integer,
    card_add_to_cart_rate numeric(5,2),
    search_views integer,
    search_add_to_cart_rate numeric(5,2),
    click_through_rate numeric(5,2),
    promo_days integer,
    promo_discount_percent numeric(5,2),
    promo_conversion_rate numeric(5,2),
    paid_promo_days integer,
    return_cancel_rate numeric(5,2),
    category_path character varying(500),
    avg_price numeric(18,2),
    listing_date timestamp with time zone,
    listing_days integer,
    seller_mode character varying(20),
    category_level_1 character varying(200),
    category_level_2 character varying(200)
);''')

    op.execute('''CREATE TABLE ozon_product_sync_errors (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    product_id bigint,
    offer_id character varying(100) NOT NULL,
    task_id bigint,
    status character varying(50),
    errors jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_product_templates (
    id bigint NOT NULL,
    user_id integer NOT NULL,
    template_type character varying(20) NOT NULL,
    template_name character varying(200),
    shop_id integer,
    category_id integer,
    form_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    tags character varying(50)[],
    used_count integer DEFAULT 0 NOT NULL,
    last_used_at timestamp with time zone,
    CONSTRAINT ck_template_type CHECK (((template_type)::text = ANY (ARRAY[('draft'::character varying)::text, ('template'::character varying)::text])))
);''')

    op.execute('''CREATE TABLE ozon_products (
    id bigint NOT NULL,
    shop_id bigint NOT NULL,
    offer_id character varying(100) NOT NULL,
    ozon_product_id bigint,
    ozon_sku bigint,
    title character varying(500) NOT NULL,
    description text,
    barcode character varying(50),
    category_id integer,
    brand character varying(200),
    status character varying(20),
    visibility boolean NOT NULL,
    is_archived boolean NOT NULL,
    price numeric(18,4),
    old_price numeric(18,4),
    premium_price numeric(18,4),
    cost numeric(18,4),
    min_price numeric(18,4),
    stock integer NOT NULL,
    reserved integer NOT NULL,
    available integer NOT NULL,
    weight integer,
    width integer,
    height integer,
    depth integer,
    images json,
    attributes json,
    sync_status character varying(20) NOT NULL,
    sync_error text,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ozon_archived boolean DEFAULT false NOT NULL,
    ozon_has_fbo_stocks boolean DEFAULT false NOT NULL,
    ozon_has_fbs_stocks boolean DEFAULT false NOT NULL,
    ozon_is_discounted boolean DEFAULT false NOT NULL,
    ozon_visibility_status character varying(100),
    ozon_created_at timestamp with time zone,
    ozon_status character varying(50),
    status_reason text,
    ozon_visibility_details json,
    currency_code character varying(10),
    raw_payload jsonb,
    title_cn character varying(500),
    ozon_attributes jsonb,
    complex_attributes jsonb,
    description_category_id bigint,
    color_image character varying(200),
    dimension_unit character varying(10),
    weight_unit character varying(10),
    type_id bigint,
    model_info jsonb,
    pdf_list jsonb,
    primary_image character varying(500),
    barcodes jsonb,
    attributes_with_defaults jsonb,
    warehouse_stocks jsonb,
    videos jsonb,
    images360 jsonb,
    promotions jsonb,
    ozon_variants jsonb,
    vat character varying(10) DEFAULT '0'::character varying,
    listing_status character varying(50),
    listing_mode character varying(20),
    listing_error_code character varying(100),
    listing_error_message character varying(1000),
    media_ready_at timestamp with time zone,
    import_submitted_at timestamp with time zone,
    purchase_url character varying(1000),
    suggested_purchase_price numeric(18,4),
    purchase_note character varying(500),
    sales_count integer DEFAULT 0,
    last_sale_at timestamp with time zone,
    CONSTRAINT check_ozon_product_status CHECK (((status)::text = ANY (ARRAY[('on_sale'::character varying)::text, ('ready_to_sell'::character varying)::text, ('error'::character varying)::text, ('pending_modification'::character varying)::text, ('inactive'::character varying)::text, ('archived'::character varying)::text])))
);''')

    op.execute('''CREATE TABLE ozon_promotion_actions (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    action_id bigint NOT NULL,
    title character varying(500),
    description text,
    date_start timestamp with time zone,
    date_end timestamp with time zone,
    status character varying(50),
    auto_cancel_enabled boolean DEFAULT false NOT NULL,
    raw_data jsonb,
    last_sync_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_promotion_products (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    action_id bigint NOT NULL,
    product_id bigint,
    ozon_product_id bigint,
    status character varying(50) DEFAULT 'candidate'::character varying NOT NULL,
    promotion_price numeric(18,4),
    promotion_stock integer,
    add_mode character varying(50) DEFAULT 'automatic'::character varying NOT NULL,
    activated_at timestamp with time zone,
    deactivated_at timestamp with time zone,
    last_sync_at timestamp with time zone,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_refunds (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    shop_id integer NOT NULL,
    refund_id character varying(100) NOT NULL,
    refund_type character varying(50),
    posting_id bigint,
    refund_amount numeric(18,4) NOT NULL,
    commission_refund numeric(18,4),
    refund_items jsonb,
    reason_id integer,
    reason character varying(500),
    customer_comment character varying(1000),
    status character varying(50),
    requested_at timestamp with time zone NOT NULL,
    approved_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_returns (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    posting_id bigint,
    order_id bigint,
    return_id bigint NOT NULL,
    return_number character varying(100) NOT NULL,
    posting_number character varying(100) NOT NULL,
    order_number character varying(100),
    client_name character varying(200),
    product_name character varying(500),
    offer_id character varying(100),
    sku bigint,
    price numeric(18,4),
    currency_code character varying(10),
    group_state character varying(50) NOT NULL,
    state character varying(50) NOT NULL,
    state_name character varying(200),
    money_return_state_name character varying(200),
    created_at_ozon timestamp with time zone NOT NULL,
    raw_payload jsonb,
    created_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    updated_at timestamp with time zone DEFAULT (now() AT TIME ZONE 'UTC'::text) NOT NULL,
    return_reason_id integer,
    return_reason_name character varying(500),
    rejection_reason_id integer,
    rejection_reason_name character varying(500),
    rejection_reasons jsonb,
    return_method_description text,
    available_actions jsonb,
    delivery_method_name character varying(200)
);''')

    op.execute('''CREATE TABLE ozon_shipment_packages (
    id bigint NOT NULL,
    posting_id bigint NOT NULL,
    package_number character varying(100) NOT NULL,
    tracking_number character varying(200),
    carrier_id integer,
    carrier_name character varying(200),
    carrier_code character varying(50),
    weight numeric(10,3),
    width numeric(10,2),
    height numeric(10,2),
    length numeric(10,2),
    label_url character varying(500),
    label_printed_at timestamp with time zone,
    status character varying(50),
    status_updated_at timestamp with time zone,
    tracking_data jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_shops (
    id bigint NOT NULL,
    shop_name character varying(200) NOT NULL,
    platform character varying(50) NOT NULL,
    status character varying(20) NOT NULL,
    owner_user_id bigint NOT NULL,
    client_id character varying(200) NOT NULL,
    api_key_enc text NOT NULL,
    config json NOT NULL,
    stats json,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_sync_at timestamp with time zone,
    shop_name_cn character varying(200)
);''')

    op.execute('''CREATE TABLE ozon_stock_update_logs (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    offer_id character varying(100) NOT NULL,
    product_id bigint,
    warehouse_id integer NOT NULL,
    stock integer NOT NULL,
    state character varying(50),
    error_message text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);''')

    op.execute('''CREATE TABLE ozon_sync_checkpoints (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    last_cursor character varying(500),
    last_sync_at timestamp with time zone,
    last_modified_at timestamp with time zone,
    status character varying(50) DEFAULT 'idle'::character varying,
    error_message character varying(5000),
    retry_count integer DEFAULT 0,
    total_processed bigint DEFAULT '0'::bigint,
    total_success bigint DEFAULT '0'::bigint,
    total_failed bigint DEFAULT '0'::bigint,
    config jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);''')

    op.execute('''CREATE TABLE ozon_sync_logs (
    id bigint NOT NULL,
    shop_id integer NOT NULL,
    entity_type character varying(50) NOT NULL,
    sync_type character varying(50),
    batch_id character varying(100),
    batch_size integer,
    status character varying(50) NOT NULL,
    processed_count integer DEFAULT 0,
    success_count integer DEFAULT 0,
    failed_count integer DEFAULT 0,
    skipped_count integer DEFAULT 0,
    error_message character varying(2000),
    error_details jsonb,
    duration_ms integer,
    api_calls integer,
    rate_limit_hits integer DEFAULT 0,
    started_at timestamp with time zone NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);''')

    op.execute('''CREATE TABLE ozon_warehouses (
    id bigint NOT NULL,
    shop_id bigint NOT NULL,
    warehouse_id bigint NOT NULL,
    name character varying(200) NOT NULL,
    is_rfbs boolean DEFAULT false NOT NULL,
    status character varying(20) NOT NULL,
    has_entrusted_acceptance boolean DEFAULT false NOT NULL,
    postings_limit integer DEFAULT '-1'::integer NOT NULL,
    min_postings_limit integer,
    has_postings_limit boolean DEFAULT false NOT NULL,
    min_working_days integer,
    working_days json,
    can_print_act_in_advance boolean DEFAULT false NOT NULL,
    is_karantin boolean DEFAULT false NOT NULL,
    is_kgt boolean DEFAULT false NOT NULL,
    is_timetable_editable boolean DEFAULT false NOT NULL,
    first_mile_type json,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE ozon_webhook_events (
    id bigint NOT NULL,
    event_id character varying(200) NOT NULL,
    event_type character varying(100) NOT NULL,
    shop_id integer NOT NULL,
    payload jsonb NOT NULL,
    headers jsonb,
    signature character varying(500),
    is_verified boolean,
    status character varying(50),
    processed_at timestamp with time zone,
    retry_count integer,
    idempotency_key character varying(200),
    error_message character varying(1000),
    entity_type character varying(50),
    entity_id character varying(100),
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    result_message character varying(500),
    processing_duration_ms integer
);''')

    op.execute('''CREATE TABLE packages (
    id bigint NOT NULL,
    shipment_id bigint NOT NULL,
    weight_kg numeric(10,3),
    dim_l_cm numeric(10,1),
    dim_w_cm numeric(10,1),
    dim_h_cm numeric(10,1)
);''')

    op.execute('''CREATE TABLE refunds (
    id bigint NOT NULL,
    platform text NOT NULL,
    shop_id bigint NOT NULL,
    order_external_id text NOT NULL,
    amount_rub numeric(18,4) NOT NULL,
    created_at timestamp with time zone NOT NULL
);''')

    op.execute('''CREATE TABLE returns (
    id bigint NOT NULL,
    platform text NOT NULL,
    shop_id bigint NOT NULL,
    external_id text NOT NULL,
    order_external_id text NOT NULL,
    reason_code text NOT NULL,
    status text NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL
);''')

    op.execute('''CREATE TABLE shipments (
    id bigint NOT NULL,
    order_id bigint NOT NULL,
    carrier_code text NOT NULL,
    tracking_no text NOT NULL,
    pushed boolean NOT NULL,
    pushed_at timestamp with time zone,
    push_receipt jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE sync_service_logs (
    id bigint NOT NULL,
    service_key character varying(100) NOT NULL,
    run_id character varying(100) NOT NULL,
    started_at timestamp with time zone NOT NULL,
    finished_at timestamp with time zone,
    status character varying(20) NOT NULL,
    records_processed integer,
    records_updated integer,
    execution_time_ms integer,
    error_message text,
    error_stack text,
    extra_data jsonb
);''')

    op.execute('''CREATE TABLE sync_services (
    id integer NOT NULL,
    service_key character varying(100) NOT NULL,
    service_name character varying(200) NOT NULL,
    service_description text,
    service_type character varying(20) NOT NULL,
    schedule_config character varying(200) NOT NULL,
    is_enabled boolean NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status character varying(20),
    last_run_message text,
    run_count integer NOT NULL,
    success_count integer NOT NULL,
    error_count integer NOT NULL,
    config_json jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);''')

    op.execute('''CREATE TABLE user_settings (
    id bigint NOT NULL,
    user_id bigint NOT NULL,
    notifications_email boolean NOT NULL,
    notifications_browser boolean NOT NULL,
    notifications_order_updates boolean NOT NULL,
    notifications_price_alerts boolean NOT NULL,
    notifications_inventory_alerts boolean NOT NULL,
    display_language character varying(10) NOT NULL,
    display_timezone character varying(50) NOT NULL,
    display_currency character varying(3) NOT NULL,
    display_date_format character varying(20) NOT NULL,
    sync_auto_sync boolean NOT NULL,
    sync_interval integer NOT NULL,
    sync_on_login boolean NOT NULL,
    security_two_factor_auth boolean NOT NULL,
    security_session_timeout integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE user_shops (
    user_id bigint NOT NULL,
    shop_id bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE users (
    id bigint NOT NULL,
    username character varying(50) NOT NULL,
    password_hash character varying(255) NOT NULL,
    is_active boolean NOT NULL,
    role character varying(50) NOT NULL,
    permissions json NOT NULL,
    primary_shop_id bigint,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_user_id bigint
);''')

    op.execute('''CREATE TABLE watermark_configs (
    id bigint NOT NULL,
    shop_id bigint,
    name character varying(100) NOT NULL,
    cloudinary_public_id text NOT NULL,
    image_url text NOT NULL,
    scale_ratio numeric(5,3) NOT NULL,
    opacity numeric(3,2) NOT NULL,
    margin_pixels integer NOT NULL,
    positions json,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    storage_provider character varying(20) DEFAULT 'cloudinary'::character varying NOT NULL
);''')

    op.execute('''CREATE TABLE watermark_tasks (
    id uuid NOT NULL,
    shop_id bigint NOT NULL,
    product_id bigint NOT NULL,
    watermark_config_id bigint,
    task_type character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    original_images json,
    processed_images json,
    cloudinary_public_ids json,
    processing_metadata json,
    error_message text,
    retry_count integer NOT NULL,
    max_retries integer NOT NULL,
    batch_id uuid,
    batch_total integer,
    batch_position integer,
    processing_started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);''')

    op.execute('''CREATE TABLE xiangjifanyi_configs (
    id integer NOT NULL,
    api_url character varying(255),
    user_key text,
    video_trans_key text,
    fetch_key text,
    img_matting_key text,
    text_trans_key text,
    aigc_key text,
    enabled boolean DEFAULT false NOT NULL,
    last_test_at timestamp with time zone,
    last_test_success boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    phone character varying(20),
    password text,
    img_trans_key_ali text,
    img_trans_key_google text,
    img_trans_key_papago text,
    img_trans_key_deepl text,
    img_trans_key_chatgpt text,
    img_trans_key_baidu text
);''')


    # ========================================
    # 4. 添加约束和外键
    # ========================================
    op.execute('''ALTER TABLE aliyun_oss_configs
    ADD CONSTRAINT aliyun_oss_configs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE aliyun_translation_configs
    ADD CONSTRAINT aliyun_translation_configs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE audit_logs_archive
    ADD CONSTRAINT audit_logs_archive_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE chatgpt_translation_configs
    ADD CONSTRAINT chatgpt_translation_configs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE cloudinary_configs
    ADD CONSTRAINT cloudinary_configs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE exchange_rate_config
    ADD CONSTRAINT exchange_rate_config_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE exchange_rates
    ADD CONSTRAINT exchange_rates_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE inventories
    ADD CONSTRAINT inventories_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE kuajing84_global_config
    ADD CONSTRAINT kuajing84_global_config_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE kuajing84_sync_logs
    ADD CONSTRAINT kuajing84_sync_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE listings
    ADD CONSTRAINT listings_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_attribute_dictionary_values
    ADD CONSTRAINT ozon_attribute_dictionary_values_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_cancellations
    ADD CONSTRAINT ozon_cancellations_cancellation_id_key UNIQUE (cancellation_id);''')
    op.execute('''ALTER TABLE ozon_cancellations
    ADD CONSTRAINT ozon_cancellations_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_categories
    ADD CONSTRAINT ozon_categories_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_category_attributes
    ADD CONSTRAINT ozon_category_attributes_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_category_commissions
    ADD CONSTRAINT ozon_category_commissions_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_chat_messages
    ADD CONSTRAINT ozon_chat_messages_message_id_key UNIQUE (message_id);''')
    op.execute('''ALTER TABLE ozon_chat_messages
    ADD CONSTRAINT ozon_chat_messages_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_chats
    ADD CONSTRAINT ozon_chats_chat_id_key UNIQUE (chat_id);''')
    op.execute('''ALTER TABLE ozon_chats
    ADD CONSTRAINT ozon_chats_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_collection_sources
    ADD CONSTRAINT ozon_collection_sources_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_daily_stats
    ADD CONSTRAINT ozon_daily_stats_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_domestic_tracking_numbers
    ADD CONSTRAINT ozon_domestic_tracking_numbers_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_finance_sync_watermarks
    ADD CONSTRAINT ozon_finance_sync_watermarks_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_finance_sync_watermarks
    ADD CONSTRAINT ozon_finance_sync_watermarks_shop_id_key UNIQUE (shop_id);''')
    op.execute('''ALTER TABLE ozon_finance_transactions
    ADD CONSTRAINT ozon_finance_transactions_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_global_settings
    ADD CONSTRAINT ozon_global_settings_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_global_settings
    ADD CONSTRAINT ozon_global_settings_setting_key_key UNIQUE (setting_key);''')
    op.execute('''ALTER TABLE ozon_media_import_logs
    ADD CONSTRAINT ozon_media_import_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_order_items
    ADD CONSTRAINT ozon_order_items_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_orders
    ADD CONSTRAINT ozon_orders_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_postings
    ADD CONSTRAINT ozon_postings_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_postings
    ADD CONSTRAINT ozon_postings_posting_number_key UNIQUE (posting_number);''')
    op.execute('''ALTER TABLE ozon_price_update_logs
    ADD CONSTRAINT ozon_price_update_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_product_collection_records
    ADD CONSTRAINT ozon_product_collection_records_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_product_import_logs
    ADD CONSTRAINT ozon_product_import_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_product_selection_import_history
    ADD CONSTRAINT ozon_product_selection_import_history_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_product_selection_items
    ADD CONSTRAINT ozon_product_selection_items_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_product_sync_errors
    ADD CONSTRAINT ozon_product_sync_errors_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_product_templates
    ADD CONSTRAINT ozon_product_templates_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_products
    ADD CONSTRAINT ozon_products_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_promotion_actions
    ADD CONSTRAINT ozon_promotion_actions_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_promotion_products
    ADD CONSTRAINT ozon_promotion_products_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_refunds
    ADD CONSTRAINT ozon_refunds_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_refunds
    ADD CONSTRAINT ozon_refunds_refund_id_key UNIQUE (refund_id);''')
    op.execute('''ALTER TABLE ozon_returns
    ADD CONSTRAINT ozon_returns_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_returns
    ADD CONSTRAINT ozon_returns_return_id_key UNIQUE (return_id);''')
    op.execute('''ALTER TABLE ozon_shipment_packages
    ADD CONSTRAINT ozon_shipment_packages_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_shops
    ADD CONSTRAINT ozon_shops_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_stock_update_logs
    ADD CONSTRAINT ozon_stock_update_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_sync_checkpoints
    ADD CONSTRAINT ozon_sync_checkpoints_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_sync_logs
    ADD CONSTRAINT ozon_sync_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_warehouses
    ADD CONSTRAINT ozon_warehouses_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE ozon_webhook_events
    ADD CONSTRAINT ozon_webhook_events_event_id_key UNIQUE (event_id);''')
    op.execute('''ALTER TABLE ozon_webhook_events
    ADD CONSTRAINT ozon_webhook_events_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE packages
    ADD CONSTRAINT packages_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE user_shops
    ADD CONSTRAINT pk_user_shops PRIMARY KEY (user_id, shop_id);''')
    op.execute('''ALTER TABLE refunds
    ADD CONSTRAINT refunds_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE returns
    ADD CONSTRAINT returns_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE shipments
    ADD CONSTRAINT shipments_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE sync_service_logs
    ADD CONSTRAINT sync_service_logs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE sync_services
    ADD CONSTRAINT sync_services_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE sync_services
    ADD CONSTRAINT sync_services_service_key_key UNIQUE (service_key);''')
    op.execute('''ALTER TABLE api_keys
    ADD CONSTRAINT uq_api_keys_key_hash UNIQUE (key_hash);''')
    op.execute('''ALTER TABLE ozon_collection_sources
    ADD CONSTRAINT uq_collection_source_user_path UNIQUE (user_id, source_path);''')
    op.execute('''ALTER TABLE inventories
    ADD CONSTRAINT uq_inventories_shop_sku UNIQUE (shop_id, sku);''')
    op.execute('''ALTER TABLE listings
    ADD CONSTRAINT uq_listings_shop_sku UNIQUE (shop_id, sku);''')
    op.execute('''ALTER TABLE orders
    ADD CONSTRAINT uq_orders_idempotency_key UNIQUE (idempotency_key);''')
    op.execute('''ALTER TABLE orders
    ADD CONSTRAINT uq_orders_platform_shop_external UNIQUE (platform, shop_id, external_id);''')
    op.execute('''ALTER TABLE ozon_cancellations
    ADD CONSTRAINT uq_ozon_cancellations_shop_id UNIQUE (shop_id, cancellation_id);''')
    op.execute('''ALTER TABLE ozon_category_attributes
    ADD CONSTRAINT uq_ozon_category_attrs UNIQUE (category_id, attribute_id);''')
    op.execute('''ALTER TABLE ozon_sync_checkpoints
    ADD CONSTRAINT uq_ozon_checkpoint UNIQUE (shop_id, entity_type);''')
    op.execute('''ALTER TABLE ozon_daily_stats
    ADD CONSTRAINT uq_ozon_daily_stats_shop_date UNIQUE (shop_id, date);''')
    op.execute('''ALTER TABLE ozon_attribute_dictionary_values
    ADD CONSTRAINT uq_ozon_dict_values UNIQUE (dictionary_id, value_id);''')
    op.execute('''ALTER TABLE ozon_finance_transactions
    ADD CONSTRAINT uq_ozon_finance_transaction UNIQUE (shop_id, operation_id, ozon_sku);''')
    op.execute('''ALTER TABLE ozon_orders
    ADD CONSTRAINT uq_ozon_order_shop_posting UNIQUE (shop_id, posting_number);''')
    op.execute('''ALTER TABLE ozon_shipment_packages
    ADD CONSTRAINT uq_ozon_packages UNIQUE (posting_id, package_number);''')
    op.execute('''ALTER TABLE ozon_promotion_actions
    ADD CONSTRAINT uq_ozon_promotion_actions_shop_action UNIQUE (shop_id, action_id);''')
    op.execute('''ALTER TABLE ozon_promotion_products
    ADD CONSTRAINT uq_ozon_promotion_products_shop_action_product UNIQUE (shop_id, action_id, product_id);''')
    op.execute('''ALTER TABLE ozon_returns
    ADD CONSTRAINT uq_ozon_returns_shop_id UNIQUE (shop_id, return_id);''')
    op.execute('''ALTER TABLE ozon_shops
    ADD CONSTRAINT uq_ozon_shop_owner_name UNIQUE (owner_user_id, shop_name);''')
    op.execute('''ALTER TABLE ozon_warehouses
    ADD CONSTRAINT uq_ozon_warehouse_shop_warehouse UNIQUE (shop_id, warehouse_id);''')
    op.execute('''ALTER TABLE ozon_domestic_tracking_numbers
    ADD CONSTRAINT uq_posting_tracking UNIQUE (posting_id, tracking_number);''')
    op.execute('''ALTER TABLE shipments
    ADD CONSTRAINT uq_shipments_tracking UNIQUE (tracking_no);''')
    op.execute('''ALTER TABLE user_settings
    ADD CONSTRAINT user_settings_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE user_settings
    ADD CONSTRAINT user_settings_user_id_key UNIQUE (user_id);''')
    op.execute('''ALTER TABLE users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE users
    ADD CONSTRAINT users_username_key UNIQUE (username);''')
    op.execute('''ALTER TABLE watermark_configs
    ADD CONSTRAINT watermark_configs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE watermark_tasks
    ADD CONSTRAINT watermark_tasks_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE xiangjifanyi_configs
    ADD CONSTRAINT xiangjifanyi_configs_pkey PRIMARY KEY (id);''')
    op.execute('''ALTER TABLE api_keys
    ADD CONSTRAINT api_keys_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE kuajing84_sync_logs
    ADD CONSTRAINT fk_kuajing84_sync_logs_posting_id FOREIGN KEY (posting_id) REFERENCES ozon_postings(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_product_sync_errors
    ADD CONSTRAINT fk_ozon_product_sync_errors_product_id FOREIGN KEY (product_id) REFERENCES ozon_products(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_product_selection_items
    ADD CONSTRAINT fk_product_selection_items_batch_id FOREIGN KEY (batch_id) REFERENCES ozon_product_selection_import_history(id) ON DELETE SET NULL;''')
    op.execute('''ALTER TABLE ozon_product_selection_items
    ADD CONSTRAINT fk_product_selection_user_id FOREIGN KEY (user_id) REFERENCES users(id);''')
    op.execute('''ALTER TABLE user_shops
    ADD CONSTRAINT fk_user_shops_shop_id_ozon FOREIGN KEY (shop_id) REFERENCES ozon_shops(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE user_shops
    ADD CONSTRAINT fk_user_shops_user_id FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE users
    ADD CONSTRAINT fk_users_parent_user_id FOREIGN KEY (parent_user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE users
    ADD CONSTRAINT fk_users_primary_shop_id_ozon FOREIGN KEY (primary_shop_id) REFERENCES ozon_shops(id) ON DELETE SET NULL;''')
    op.execute('''ALTER TABLE kuajing84_sync_logs
    ADD CONSTRAINT kuajing84_sync_logs_ozon_order_id_fkey FOREIGN KEY (ozon_order_id) REFERENCES ozon_orders(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE order_items
    ADD CONSTRAINT order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_cancellations
    ADD CONSTRAINT ozon_cancellations_order_id_fkey FOREIGN KEY (order_id) REFERENCES ozon_orders(id);''')
    op.execute('''ALTER TABLE ozon_cancellations
    ADD CONSTRAINT ozon_cancellations_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES ozon_postings(id);''')
    op.execute('''ALTER TABLE ozon_collection_sources
    ADD CONSTRAINT ozon_collection_sources_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_daily_stats
    ADD CONSTRAINT ozon_daily_stats_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id);''')
    op.execute('''ALTER TABLE ozon_domestic_tracking_numbers
    ADD CONSTRAINT ozon_domestic_tracking_numbers_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES ozon_postings(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_finance_sync_watermarks
    ADD CONSTRAINT ozon_finance_sync_watermarks_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id);''')
    op.execute('''ALTER TABLE ozon_finance_transactions
    ADD CONSTRAINT ozon_finance_transactions_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id);''')
    op.execute('''ALTER TABLE ozon_order_items
    ADD CONSTRAINT ozon_order_items_order_id_fkey FOREIGN KEY (order_id) REFERENCES ozon_orders(id);''')
    op.execute('''ALTER TABLE ozon_orders
    ADD CONSTRAINT ozon_orders_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_postings
    ADD CONSTRAINT ozon_postings_order_id_fkey FOREIGN KEY (order_id) REFERENCES ozon_orders(id);''')
    op.execute('''ALTER TABLE ozon_product_collection_records
    ADD CONSTRAINT ozon_product_collection_records_last_edited_by_fkey FOREIGN KEY (last_edited_by) REFERENCES users(id);''')
    op.execute('''ALTER TABLE ozon_product_collection_records
    ADD CONSTRAINT ozon_product_collection_records_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id);''')
    op.execute('''ALTER TABLE ozon_product_collection_records
    ADD CONSTRAINT ozon_product_collection_records_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id);''')
    op.execute('''ALTER TABLE ozon_product_templates
    ADD CONSTRAINT ozon_product_templates_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_products
    ADD CONSTRAINT ozon_products_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_promotion_products
    ADD CONSTRAINT ozon_promotion_products_product_id_fkey FOREIGN KEY (product_id) REFERENCES ozon_products(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_refunds
    ADD CONSTRAINT ozon_refunds_order_id_fkey FOREIGN KEY (order_id) REFERENCES ozon_orders(id);''')
    op.execute('''ALTER TABLE ozon_refunds
    ADD CONSTRAINT ozon_refunds_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES ozon_postings(id);''')
    op.execute('''ALTER TABLE ozon_returns
    ADD CONSTRAINT ozon_returns_order_id_fkey FOREIGN KEY (order_id) REFERENCES ozon_orders(id);''')
    op.execute('''ALTER TABLE ozon_returns
    ADD CONSTRAINT ozon_returns_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES ozon_postings(id);''')
    op.execute('''ALTER TABLE ozon_shipment_packages
    ADD CONSTRAINT ozon_shipment_packages_posting_id_fkey FOREIGN KEY (posting_id) REFERENCES ozon_postings(id);''')
    op.execute('''ALTER TABLE ozon_shops
    ADD CONSTRAINT ozon_shops_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE ozon_warehouses
    ADD CONSTRAINT ozon_warehouses_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE packages
    ADD CONSTRAINT packages_shipment_id_fkey FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE shipments
    ADD CONSTRAINT shipments_order_id_fkey FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE user_settings
    ADD CONSTRAINT user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE watermark_configs
    ADD CONSTRAINT watermark_configs_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE watermark_tasks
    ADD CONSTRAINT watermark_tasks_product_id_fkey FOREIGN KEY (product_id) REFERENCES ozon_products(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE watermark_tasks
    ADD CONSTRAINT watermark_tasks_shop_id_fkey FOREIGN KEY (shop_id) REFERENCES ozon_shops(id) ON DELETE CASCADE;''')
    op.execute('''ALTER TABLE watermark_tasks
    ADD CONSTRAINT watermark_tasks_watermark_config_id_fkey FOREIGN KEY (watermark_config_id) REFERENCES watermark_configs(id) ON DELETE SET NULL;''')

    # ========================================
    # 5. 创建索引
    # ========================================
    op.execute('''CREATE INDEX idx_aliyun_translation_is_default ON aliyun_translation_configs USING btree (is_default, enabled);''')
    op.execute('''CREATE INDEX idx_audit_logs_action ON audit_logs USING btree (action, created_at DESC);''')
    op.execute('''CREATE INDEX idx_audit_logs_archive_created ON audit_logs_archive USING btree (created_at DESC);''')
    op.execute('''CREATE INDEX idx_audit_logs_archive_record ON audit_logs_archive USING btree (table_name, record_id);''')
    op.execute('''CREATE INDEX idx_audit_logs_created ON audit_logs USING btree (created_at DESC);''')
    op.execute('''CREATE INDEX idx_audit_logs_module ON audit_logs USING btree (module, created_at DESC);''')
    op.execute('''CREATE INDEX idx_audit_logs_record ON audit_logs USING btree (table_name, record_id);''')
    op.execute('''CREATE INDEX idx_audit_logs_user ON audit_logs USING btree (user_id, created_at DESC);''')
    op.execute('''CREATE INDEX idx_batch_read ON ozon_product_selection_items USING btree (batch_id, is_read);''')
    op.execute('''CREATE INDEX idx_brand_price ON ozon_product_selection_items USING btree (brand_normalized, current_price);''')
    op.execute('''CREATE INDEX idx_category_level_1 ON ozon_product_selection_items USING btree (category_level_1);''')
    op.execute('''CREATE INDEX idx_category_level_2 ON ozon_product_selection_items USING btree (category_level_2);''')
    op.execute('''CREATE INDEX idx_category_path ON ozon_product_selection_items USING btree (category_path);''')
    op.execute('''CREATE INDEX idx_chatgpt_translation_is_default ON chatgpt_translation_configs USING btree (is_default, enabled);''')
    op.execute('''CREATE INDEX idx_collection_shop ON ozon_product_collection_records USING btree (shop_id) WHERE (shop_id IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_collection_source_last_collected ON ozon_collection_sources USING btree (last_collected_at);''')
    op.execute('''CREATE INDEX idx_collection_source_status ON ozon_collection_sources USING btree (user_id, status);''')
    op.execute('''CREATE INDEX idx_collection_source_user_enabled ON ozon_collection_sources USING btree (user_id, is_enabled);''')
    op.execute('''CREATE INDEX idx_collection_type_status ON ozon_product_collection_records USING btree (collection_type, listing_status);''')
    op.execute('''CREATE INDEX idx_collection_user ON ozon_product_collection_records USING btree (user_id, created_at DESC);''')
    op.execute('''CREATE INDEX idx_commission ON ozon_product_selection_items USING btree (rfbs_commission_low, rfbs_commission_mid, fbp_commission_low, fbp_commission_mid);''')
    op.execute('''CREATE INDEX idx_domestic_posting_id ON ozon_domestic_tracking_numbers USING btree (posting_id);''')
    op.execute('''CREATE INDEX idx_domestic_tracking_number ON ozon_domestic_tracking_numbers USING btree (tracking_number);''')
    op.execute('''CREATE INDEX idx_exchange_rates_currency_time ON exchange_rates USING btree (from_currency, to_currency, fetched_at);''')
    op.execute('''CREATE UNIQUE INDEX idx_only_one_default_aliyun_oss ON aliyun_oss_configs USING btree (is_default) WHERE (is_default = true);''')
    op.execute('''CREATE UNIQUE INDEX idx_only_one_default_cloudinary ON cloudinary_configs USING btree (is_default) WHERE (is_default = true);''')
    op.execute('''CREATE INDEX idx_orders_shop_platform_updated ON orders USING btree (shop_id, platform, platform_updated_ts DESC);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_cancelled_at ON ozon_cancellations USING btree (cancelled_at);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_initiator ON ozon_cancellations USING btree (cancellation_initiator);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_posting ON ozon_cancellations USING btree (posting_number);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_shop_date ON ozon_cancellations USING btree (shop_id, cancelled_at);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_shop_id ON ozon_cancellations USING btree (shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_shop_state ON ozon_cancellations USING btree (shop_id, state);''')
    op.execute('''CREATE INDEX idx_ozon_cancellations_state ON ozon_cancellations USING btree (state);''')
    op.execute('''CREATE INDEX idx_ozon_categories_attrs_synced_at ON ozon_categories USING btree (attributes_synced_at);''')
    op.execute('''CREATE INDEX idx_ozon_categories_category_id ON ozon_categories USING btree (category_id);''')
    op.execute('''CREATE UNIQUE INDEX idx_ozon_categories_category_parent ON ozon_categories USING btree (category_id, parent_id);''')
    op.execute('''CREATE INDEX idx_ozon_categories_leaf ON ozon_categories USING btree (is_leaf) WHERE (is_leaf = true);''')
    op.execute('''CREATE INDEX idx_ozon_categories_name ON ozon_categories USING gin (name gin_trgm_ops);''')
    op.execute('''CREATE INDEX idx_ozon_categories_name_zh ON ozon_categories USING btree (name_zh);''')
    op.execute('''CREATE INDEX idx_ozon_categories_parent ON ozon_categories USING btree (parent_id);''')
    op.execute('''CREATE INDEX idx_ozon_category_attrs_aspect ON ozon_category_attributes USING btree (category_id, is_aspect);''')
    op.execute('''CREATE INDEX idx_ozon_category_attrs_category ON ozon_category_attributes USING btree (category_id);''')
    op.execute('''CREATE INDEX idx_ozon_category_attrs_dict ON ozon_category_attributes USING btree (dictionary_id) WHERE (dictionary_id IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_category_attrs_group ON ozon_category_attributes USING btree (category_id, group_id);''')
    op.execute('''CREATE INDEX idx_ozon_category_attrs_required ON ozon_category_attributes USING btree (category_id, is_required) WHERE (is_required = true);''')
    op.execute('''CREATE INDEX idx_ozon_category_commissions_module ON ozon_category_commissions USING btree (category_module);''')
    op.execute('''CREATE INDEX idx_ozon_category_commissions_name ON ozon_category_commissions USING btree (category_name);''')
    op.execute('''CREATE INDEX idx_ozon_chat_order ON ozon_chats USING btree (order_number);''')
    op.execute('''CREATE INDEX idx_ozon_chat_shop_chat ON ozon_chat_messages USING btree (shop_id, chat_id, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_chat_shop_status ON ozon_chats USING btree (shop_id, status, last_message_at);''')
    op.execute('''CREATE INDEX idx_ozon_chat_unread ON ozon_chat_messages USING btree (shop_id, is_read, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_checkpoint_status ON ozon_sync_checkpoints USING btree (status, last_sync_at);''')
    op.execute('''CREATE INDEX idx_ozon_daily_stats_date ON ozon_daily_stats USING btree (date);''')
    op.execute('''CREATE INDEX idx_ozon_daily_stats_shop_date ON ozon_daily_stats USING btree (shop_id, date);''')
    op.execute('''CREATE INDEX idx_ozon_daily_stats_shop_id ON ozon_daily_stats USING btree (shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_dict_values_dict ON ozon_attribute_dictionary_values USING btree (dictionary_id);''')
    op.execute('''CREATE INDEX idx_ozon_dict_values_search ON ozon_attribute_dictionary_values USING gin (value gin_trgm_ops);''')
    op.execute('''CREATE INDEX idx_ozon_dict_values_value_zh ON ozon_attribute_dictionary_values USING btree (value_zh);''')
    op.execute('''CREATE INDEX idx_ozon_finance_operation ON ozon_finance_transactions USING btree (operation_id);''')
    op.execute('''CREATE INDEX idx_ozon_finance_posting ON ozon_finance_transactions USING btree (posting_number);''')
    op.execute('''CREATE INDEX idx_ozon_finance_shop_date ON ozon_finance_transactions USING btree (shop_id, operation_date);''')
    op.execute('''CREATE INDEX idx_ozon_finance_type ON ozon_finance_transactions USING btree (shop_id, transaction_type, operation_type);''')
    op.execute('''CREATE INDEX idx_ozon_finance_watermark_shop ON ozon_finance_sync_watermarks USING btree (shop_id);''')
    op.execute('''CREATE UNIQUE INDEX idx_ozon_global_settings_key ON ozon_global_settings USING btree (setting_key);''')
    op.execute('''CREATE INDEX idx_ozon_media_logs_offer ON ozon_media_import_logs USING btree (shop_id, offer_id);''')
    op.execute('''CREATE INDEX idx_ozon_media_logs_state ON ozon_media_import_logs USING btree (state, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_media_logs_task ON ozon_media_import_logs USING btree (task_id) WHERE (task_id IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_order_items_offer_id ON ozon_order_items USING btree (offer_id);''')
    op.execute('''CREATE INDEX idx_ozon_order_items_order ON ozon_order_items USING btree (order_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_orders_join_cover ON ozon_orders USING btree (id, shop_id, ordered_at, total_price);''')
    op.execute('''CREATE INDEX idx_ozon_packages_tracking ON ozon_shipment_packages USING btree (tracking_number);''')
    op.execute('''CREATE INDEX idx_ozon_postings_date ON ozon_postings USING btree (shop_id, shipment_date);''')
    op.execute('''CREATE INDEX idx_ozon_postings_has_purchase_info ON ozon_postings USING btree (has_purchase_info);''')
    op.execute('''CREATE INDEX idx_ozon_postings_has_tracking ON ozon_postings USING btree (has_tracking_number, has_domestic_tracking, status, operation_status);''')
    op.execute('''CREATE INDEX idx_ozon_postings_in_process ON ozon_postings USING btree (shop_id, in_process_at, status) WHERE (in_process_at IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_postings_kuajing84_sync ON ozon_postings USING btree (kuajing84_sync_error, material_cost);''')
    op.execute('''CREATE INDEX idx_ozon_postings_label_printed ON ozon_postings USING btree (label_printed_at) WHERE (label_printed_at IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_postings_operation_status ON ozon_postings USING btree (shop_id, operation_status);''')
    op.execute('''CREATE INDEX idx_ozon_postings_operation_time ON ozon_postings USING btree (shop_id, operation_time);''')
    op.execute('''CREATE INDEX idx_ozon_postings_order_join ON ozon_postings USING btree (order_id, in_process_at, status, shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_postings_product_skus_gin ON ozon_postings USING gin (product_skus);''')
    op.execute('''CREATE INDEX idx_ozon_postings_report_date ON ozon_postings USING btree (in_process_at, status);''')
    op.execute('''CREATE INDEX idx_ozon_postings_report_delivered ON ozon_postings USING btree (delivered_at, status) WHERE (delivered_at IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_postings_report_shipped ON ozon_postings USING btree (shipped_at, status) WHERE (shipped_at IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_postings_shop_posting ON ozon_postings USING btree (shop_id, posting_number);''')
    op.execute('''CREATE INDEX idx_ozon_postings_status ON ozon_postings USING btree (shop_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_postings_status_order ON ozon_postings USING btree (status, order_id) WHERE ((status)::text <> 'cancelled'::text);''')
    op.execute('''CREATE INDEX idx_ozon_postings_status_time ON ozon_postings USING btree (status, in_process_at, shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_postings_total_price ON ozon_postings USING btree (shop_id, order_total_price) WHERE (order_total_price IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_postings_tracking ON ozon_postings USING btree (((raw_payload ->> 'tracking_number'::text))) WHERE ((raw_payload ->> 'tracking_number'::text) IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_postings_warehouse ON ozon_postings USING btree (warehouse_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_price_logs_offer ON ozon_price_update_logs USING btree (shop_id, offer_id, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_price_logs_state ON ozon_price_update_logs USING btree (state, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_product_logs_offer ON ozon_product_import_logs USING btree (shop_id, offer_id);''')
    op.execute('''CREATE INDEX idx_ozon_product_logs_state ON ozon_product_import_logs USING btree (state, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_product_logs_task ON ozon_product_import_logs USING btree (task_id) WHERE (task_id IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_ozon_products_ozon_archived ON ozon_products USING btree (ozon_archived);''')
    op.execute('''CREATE INDEX idx_ozon_products_ozon_product_id ON ozon_products USING btree (ozon_product_id);''')
    op.execute('''CREATE INDEX idx_ozon_products_ozon_sku ON ozon_products USING btree (ozon_sku);''')
    op.execute('''CREATE INDEX idx_ozon_products_ozon_visibility ON ozon_products USING btree (ozon_visibility_status);''')
    op.execute('''CREATE INDEX idx_ozon_products_sales ON ozon_products USING btree (shop_id, sales_count);''')
    op.execute('''CREATE INDEX idx_ozon_products_shop_offer ON ozon_products USING btree (shop_id, offer_id);''')
    op.execute('''CREATE INDEX idx_ozon_products_shop_status ON ozon_products USING btree (shop_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_products_title_cn ON ozon_products USING btree (title_cn);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_actions_auto_cancel ON ozon_promotion_actions USING btree (shop_id, auto_cancel_enabled);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_actions_shop ON ozon_promotion_actions USING btree (shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_actions_shop_status ON ozon_promotion_actions USING btree (shop_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_products_ozon_product ON ozon_promotion_products USING btree (ozon_product_id);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_products_product ON ozon_promotion_products USING btree (product_id);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_products_shop_action_mode ON ozon_promotion_products USING btree (shop_id, action_id, add_mode);''')
    op.execute('''CREATE INDEX idx_ozon_promotion_products_shop_action_status ON ozon_promotion_products USING btree (shop_id, action_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_refunds_date ON ozon_refunds USING btree (shop_id, requested_at);''')
    op.execute('''CREATE INDEX idx_ozon_refunds_status ON ozon_refunds USING btree (shop_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_returns_created_at_ozon ON ozon_returns USING btree (created_at_ozon);''')
    op.execute('''CREATE INDEX idx_ozon_returns_group_state ON ozon_returns USING btree (group_state);''')
    op.execute('''CREATE INDEX idx_ozon_returns_offer ON ozon_returns USING btree (offer_id);''')
    op.execute('''CREATE INDEX idx_ozon_returns_posting ON ozon_returns USING btree (posting_number);''')
    op.execute('''CREATE INDEX idx_ozon_returns_shop_date ON ozon_returns USING btree (shop_id, created_at_ozon);''')
    op.execute('''CREATE INDEX idx_ozon_returns_shop_id ON ozon_returns USING btree (shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_returns_shop_state ON ozon_returns USING btree (shop_id, group_state);''')
    op.execute('''CREATE INDEX idx_ozon_shops_client_status ON ozon_shops USING btree (client_id, status);''')
    op.execute('''CREATE INDEX idx_ozon_stock_logs_offer ON ozon_stock_update_logs USING btree (shop_id, offer_id, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_stock_logs_state ON ozon_stock_update_logs USING btree (state, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_stock_logs_warehouse ON ozon_stock_update_logs USING btree (warehouse_id, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_sync_log_batch ON ozon_sync_logs USING btree (batch_id);''')
    op.execute('''CREATE INDEX idx_ozon_sync_log_shop ON ozon_sync_logs USING btree (shop_id, entity_type, started_at);''')
    op.execute('''CREATE INDEX idx_ozon_sync_log_status ON ozon_sync_logs USING btree (status, started_at);''')
    op.execute('''CREATE INDEX idx_ozon_warehouses_shop_id ON ozon_warehouses USING btree (shop_id);''')
    op.execute('''CREATE INDEX idx_ozon_webhook_entity ON ozon_webhook_events USING btree (entity_type, entity_id);''')
    op.execute('''CREATE INDEX idx_ozon_webhook_idempotency ON ozon_webhook_events USING btree (idempotency_key);''')
    op.execute('''CREATE INDEX idx_ozon_webhook_shop ON ozon_webhook_events USING btree (shop_id, event_type, created_at);''')
    op.execute('''CREATE INDEX idx_ozon_webhook_status ON ozon_webhook_events USING btree (status, created_at);''')
    op.execute('''CREATE INDEX idx_product_id ON ozon_product_selection_items USING btree (product_id);''')
    op.execute('''CREATE INDEX idx_product_id_name ON ozon_product_selection_items USING btree (product_id, product_name_ru);''')
    op.execute('''CREATE INDEX idx_product_selection_user_id ON ozon_product_selection_items USING btree (user_id);''')
    op.execute('''CREATE INDEX idx_sales_weight ON ozon_product_selection_items USING btree (monthly_sales_volume, package_weight);''')
    op.execute('''CREATE INDEX idx_sync_logs_run_id ON sync_service_logs USING btree (run_id);''')
    op.execute('''CREATE INDEX idx_sync_logs_service ON sync_service_logs USING btree (service_key, started_at);''')
    op.execute('''CREATE INDEX idx_sync_logs_status ON sync_service_logs USING btree (status, started_at);''')
    op.execute('''CREATE INDEX idx_sync_services_enabled ON sync_services USING btree (is_enabled, service_type);''')
    op.execute('''CREATE INDEX idx_sync_services_last_run ON sync_services USING btree (last_run_at);''')
    op.execute('''CREATE INDEX idx_templates_category ON ozon_product_templates USING btree (category_id) WHERE (category_id IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_templates_shop ON ozon_product_templates USING btree (shop_id) WHERE (shop_id IS NOT NULL);''')
    op.execute('''CREATE INDEX idx_templates_updated_at ON ozon_product_templates USING btree (updated_at DESC);''')
    op.execute('''CREATE UNIQUE INDEX idx_templates_user_draft ON ozon_product_templates USING btree (user_id) WHERE ((template_type)::text = 'draft'::text);''')
    op.execute('''CREATE INDEX idx_templates_user_type ON ozon_product_templates USING btree (user_id, template_type);''')
    op.execute('''CREATE INDEX idx_user_product_name ON ozon_product_selection_items USING btree (user_id, product_id, product_name_ru);''')
    op.execute('''CREATE INDEX idx_watermark_configs_provider_active ON watermark_configs USING btree (storage_provider, is_active);''')
    op.execute('''CREATE INDEX idx_watermark_configs_storage_provider ON watermark_configs USING btree (storage_provider);''')
    op.execute('''CREATE INDEX ix_api_keys_is_active ON api_keys USING btree (is_active);''')
    op.execute('''CREATE INDEX ix_api_keys_key_hash ON api_keys USING btree (key_hash);''')
    op.execute('''CREATE INDEX ix_api_keys_user_id ON api_keys USING btree (user_id);''')
    op.execute('''CREATE INDEX ix_exchange_rates_fetched_at ON exchange_rates USING btree (fetched_at);''')
    op.execute('''CREATE INDEX ix_exchange_rates_from_currency ON exchange_rates USING btree (from_currency);''')
    op.execute('''CREATE INDEX ix_exchange_rates_to_currency ON exchange_rates USING btree (to_currency);''')
    op.execute('''CREATE INDEX ix_inventories_shop ON inventories USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_inventories_sku ON inventories USING btree (sku);''')
    op.execute('''CREATE INDEX ix_inventories_threshold ON inventories USING btree (shop_id, threshold, qty_available);''')
    op.execute('''CREATE INDEX ix_inventories_updated ON inventories USING btree (updated_at);''')
    op.execute('''CREATE INDEX ix_kuajing84_sync_logs_order_id ON kuajing84_sync_logs USING btree (ozon_order_id);''')
    op.execute('''CREATE INDEX ix_kuajing84_sync_logs_order_number ON kuajing84_sync_logs USING btree (order_number);''')
    op.execute('''CREATE INDEX ix_kuajing84_sync_logs_posting_id ON kuajing84_sync_logs USING btree (posting_id);''')
    op.execute('''CREATE INDEX ix_kuajing84_sync_logs_status ON kuajing84_sync_logs USING btree (shop_id, sync_status);''')
    op.execute('''CREATE INDEX ix_listings_price ON listings USING btree (price_rub);''')
    op.execute('''CREATE INDEX ix_listings_shop ON listings USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_listings_sku ON listings USING btree (sku);''')
    op.execute('''CREATE INDEX ix_listings_updated ON listings USING btree (updated_at);''')
    op.execute('''CREATE INDEX ix_order_items_order ON order_items USING btree (order_id);''')
    op.execute('''CREATE INDEX ix_order_items_sku ON order_items USING btree (sku);''')
    op.execute('''CREATE INDEX ix_orders_created_at ON orders USING btree (created_at);''')
    op.execute('''CREATE INDEX ix_orders_external_no ON orders USING btree (external_no);''')
    op.execute('''CREATE INDEX ix_orders_shop_updated ON orders USING btree (shop_id, platform_updated_ts);''')
    op.execute('''CREATE INDEX ix_orders_status ON orders USING btree (status);''')
    op.execute('''CREATE INDEX ix_ozon_chat_messages_chat_id ON ozon_chat_messages USING btree (chat_id);''')
    op.execute('''CREATE INDEX ix_ozon_chat_messages_shop_id ON ozon_chat_messages USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_ozon_chats_is_archived ON ozon_chats USING btree (is_archived);''')
    op.execute('''CREATE INDEX ix_ozon_chats_shop_id ON ozon_chats USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_ozon_orders_cancel_reason_id ON ozon_orders USING btree (cancel_reason_id);''')
    op.execute('''CREATE INDEX ix_ozon_orders_client_delivery_date ON ozon_orders USING btree (client_delivery_date_begin);''')
    op.execute('''CREATE INDEX ix_ozon_orders_created_at ON ozon_orders USING btree (created_at);''')
    op.execute('''CREATE INDEX ix_ozon_orders_delivery_type ON ozon_orders USING btree (delivery_type);''')
    op.execute('''CREATE INDEX ix_ozon_orders_is_legal ON ozon_orders USING btree (is_legal);''')
    op.execute('''CREATE INDEX ix_ozon_orders_order_number ON ozon_orders USING btree (order_number);''')
    op.execute('''CREATE INDEX ix_ozon_orders_payment_type ON ozon_orders USING btree (payment_type);''')
    op.execute('''CREATE INDEX ix_ozon_orders_posting_number ON ozon_orders USING btree (posting_number);''')
    op.execute('''CREATE INDEX ix_ozon_orders_shop_id ON ozon_orders USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_ozon_orders_status ON ozon_orders USING btree (status);''')
    op.execute('''CREATE INDEX ix_ozon_orders_sync_mode ON ozon_orders USING btree (sync_mode);''')
    op.execute('''CREATE INDEX ix_ozon_orders_tpl_provider_id ON ozon_orders USING btree (tpl_provider_id);''')
    op.execute('''CREATE INDEX ix_ozon_orders_warehouse_id ON ozon_orders USING btree (warehouse_id);''')
    op.execute('''CREATE INDEX ix_ozon_postings_source_platform_gin ON ozon_postings USING gin (source_platform);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_import_history_id ON ozon_product_selection_import_history USING btree (id);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_items_batch_id ON ozon_product_selection_items USING btree (batch_id);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_items_brand ON ozon_product_selection_items USING btree (brand);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_items_brand_normalized ON ozon_product_selection_items USING btree (brand_normalized);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_items_id ON ozon_product_selection_items USING btree (id);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_items_monthly_sales_volume ON ozon_product_selection_items USING btree (monthly_sales_volume);''')
    op.execute('''CREATE INDEX ix_ozon_product_selection_items_package_weight ON ozon_product_selection_items USING btree (package_weight);''')
    op.execute('''CREATE INDEX ix_ozon_product_sync_errors_offer_id ON ozon_product_sync_errors USING btree (offer_id);''')
    op.execute('''CREATE INDEX ix_ozon_product_sync_errors_product_id ON ozon_product_sync_errors USING btree (product_id);''')
    op.execute('''CREATE INDEX ix_ozon_product_sync_errors_shop_id ON ozon_product_sync_errors USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_ozon_product_sync_errors_task_id ON ozon_product_sync_errors USING btree (task_id);''')
    op.execute('''CREATE INDEX ix_ozon_products_offer_id ON ozon_products USING btree (offer_id);''')
    op.execute('''CREATE INDEX ix_ozon_products_ozon_status ON ozon_products USING btree (ozon_status);''')
    op.execute('''CREATE INDEX ix_ozon_products_shop_id ON ozon_products USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_ozon_products_status ON ozon_products USING btree (status);''')
    op.execute('''CREATE INDEX ix_ozon_products_sync_status ON ozon_products USING btree (sync_status);''')
    op.execute('''CREATE INDEX ix_ozon_shops_owner_user_id ON ozon_shops USING btree (owner_user_id);''')
    op.execute('''CREATE INDEX ix_ozon_shops_status ON ozon_shops USING btree (status);''')
    op.execute('''CREATE INDEX ix_packages_shipment ON packages USING btree (shipment_id);''')
    op.execute('''CREATE INDEX ix_shipments_carrier ON shipments USING btree (carrier_code);''')
    op.execute('''CREATE INDEX ix_shipments_order ON shipments USING btree (order_id);''')
    op.execute('''CREATE INDEX ix_shipments_pushed ON shipments USING btree (pushed, created_at);''')
    op.execute('''CREATE INDEX ix_user_settings_user_id ON user_settings USING btree (user_id);''')
    op.execute('''CREATE INDEX ix_user_shops_shop_id ON user_shops USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_user_shops_user_id ON user_shops USING btree (user_id);''')
    op.execute('''CREATE INDEX ix_users_is_active ON users USING btree (is_active);''')
    op.execute('''CREATE INDEX ix_users_parent_user_id ON users USING btree (parent_user_id);''')
    op.execute('''CREATE INDEX ix_users_role ON users USING btree (role);''')
    op.execute('''CREATE UNIQUE INDEX ix_users_username ON users USING btree (username);''')
    op.execute('''CREATE INDEX ix_watermark_configs_shop_id ON watermark_configs USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_watermark_tasks_batch_id ON watermark_tasks USING btree (batch_id);''')
    op.execute('''CREATE INDEX ix_watermark_tasks_created_at ON watermark_tasks USING btree (created_at);''')
    op.execute('''CREATE INDEX ix_watermark_tasks_product_id ON watermark_tasks USING btree (product_id);''')
    op.execute('''CREATE INDEX ix_watermark_tasks_shop_id ON watermark_tasks USING btree (shop_id);''')
    op.execute('''CREATE INDEX ix_watermark_tasks_status ON watermark_tasks USING btree (status);''')
    op.execute('''CREATE UNIQUE INDEX uq_watermark_task_processing ON watermark_tasks USING btree (shop_id, product_id, status) WHERE ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('processing'::character varying)::text]));''')

    # ========================================
    # 5.5 关联序列到表的 id 列
    # ========================================
    sequence_table_mapping = [
        ('aliyun_oss_configs_id_seq', 'aliyun_oss_configs'),
        ('aliyun_translation_configs_id_seq', 'aliyun_translation_configs'),
        ('api_keys_id_seq', 'api_keys'),
        ('audit_logs_archive_id_seq', 'audit_logs_archive'),
        ('audit_logs_id_seq', 'audit_logs'),
        ('chatgpt_translation_configs_id_seq', 'chatgpt_translation_configs'),
        ('cloudinary_configs_id_seq', 'cloudinary_configs'),
        ('exchange_rate_config_id_seq', 'exchange_rate_config'),
        ('exchange_rates_id_seq', 'exchange_rates'),
        ('inventories_id_seq', 'inventories'),
        ('kuajing84_global_config_id_seq', 'kuajing84_global_config'),
        ('kuajing84_sync_logs_id_seq', 'kuajing84_sync_logs'),
        ('listings_id_seq', 'listings'),
        ('order_items_id_seq', 'order_items'),
        ('orders_id_seq', 'orders'),
        ('ozon_attribute_dictionary_values_id_seq', 'ozon_attribute_dictionary_values'),
        ('ozon_cancellations_id_seq', 'ozon_cancellations'),
        ('ozon_categories_id_seq', 'ozon_categories'),
        ('ozon_categories_category_id_seq', 'ozon_categories', 'category_id'),
        ('ozon_category_attributes_id_seq', 'ozon_category_attributes'),
        ('ozon_category_commissions_id_seq', 'ozon_category_commissions'),
        ('ozon_chat_messages_id_seq', 'ozon_chat_messages'),
        ('ozon_chats_id_seq', 'ozon_chats'),
        ('ozon_collection_sources_id_seq', 'ozon_collection_sources'),
        ('ozon_daily_stats_id_seq', 'ozon_daily_stats'),
        ('ozon_domestic_tracking_numbers_id_seq', 'ozon_domestic_tracking_numbers'),
        ('ozon_finance_sync_watermarks_id_seq', 'ozon_finance_sync_watermarks'),
        ('ozon_finance_transactions_id_seq', 'ozon_finance_transactions'),
        ('ozon_global_settings_id_seq', 'ozon_global_settings'),
        ('ozon_media_import_logs_id_seq', 'ozon_media_import_logs'),
        ('ozon_order_items_id_seq', 'ozon_order_items'),
        ('ozon_orders_id_seq', 'ozon_orders'),
        ('ozon_postings_id_seq', 'ozon_postings'),
        ('ozon_price_update_logs_id_seq', 'ozon_price_update_logs'),
        ('ozon_product_collection_records_id_seq', 'ozon_product_collection_records'),
        ('ozon_product_import_logs_id_seq', 'ozon_product_import_logs'),
        ('ozon_product_selection_import_history_id_seq', 'ozon_product_selection_import_history'),
        ('ozon_product_selection_items_id_seq', 'ozon_product_selection_items'),
        ('ozon_product_sync_errors_id_seq', 'ozon_product_sync_errors'),
        ('ozon_product_templates_id_seq', 'ozon_product_templates'),
        ('ozon_products_id_seq', 'ozon_products'),
        ('ozon_promotion_actions_id_seq', 'ozon_promotion_actions'),
        ('ozon_promotion_products_id_seq', 'ozon_promotion_products'),
        ('ozon_refunds_id_seq', 'ozon_refunds'),
        ('ozon_returns_id_seq', 'ozon_returns'),
        ('ozon_shipment_packages_id_seq', 'ozon_shipment_packages'),
        ('ozon_shops_id_seq', 'ozon_shops'),
        ('ozon_stock_update_logs_id_seq', 'ozon_stock_update_logs'),
        ('ozon_sync_checkpoints_id_seq', 'ozon_sync_checkpoints'),
        ('ozon_sync_logs_id_seq', 'ozon_sync_logs'),
        ('ozon_warehouses_id_seq', 'ozon_warehouses'),
        ('ozon_webhook_events_id_seq', 'ozon_webhook_events'),
        ('packages_id_seq', 'packages'),
        ('refunds_id_seq', 'refunds'),
        ('returns_id_seq', 'returns'),
        ('shipments_id_seq', 'shipments'),
        ('sync_service_logs_id_seq', 'sync_service_logs'),
        ('sync_services_id_seq', 'sync_services'),
        ('user_settings_id_seq', 'user_settings'),
        ('users_id_seq', 'users'),
        ('watermark_configs_id_seq', 'watermark_configs'),
        ('xiangjifanyi_configs_id_seq', 'xiangjifanyi_configs'),
    ]

    for item in sequence_table_mapping:
        seq_name = item[0]
        table_name = item[1]
        col_name = item[2] if len(item) > 2 else 'id'
        op.execute(f"ALTER TABLE {table_name} ALTER COLUMN {col_name} SET DEFAULT nextval('{seq_name}');")
        op.execute(f"ALTER SEQUENCE {seq_name} OWNED BY {table_name}.{col_name};")

    # ========================================
    # 6. 创建默认管理员用户
    # ========================================
    import os
    import bcrypt

    admin_password = os.getenv('EF__ADMIN_PASSWORD', 'admin123')
    password_bytes = admin_password.encode('utf-8')
    password_hash = bcrypt.hashpw(password_bytes, bcrypt.gensalt()).decode('utf-8')

    conn = op.get_bind()
    conn.execute(
        sa.text(f"""
            INSERT INTO users (username, password_hash, is_active, role, permissions)
            VALUES ('admin', '{password_hash}', true, 'admin', '["*"]')
            ON CONFLICT (username) DO NOTHING
        """)
    )


def downgrade() -> None:
    """Drop all tables (危险操作！)"""
    # 按照依赖的逆序删除表
    tables = [
        'xiangjifanyi_configs',
        'watermark_tasks',
        'watermark_configs',
        'users',
        'user_shops',
        'user_settings',
        'sync_services',
        'sync_service_logs',
        'shipments',
        'returns',
        'refunds',
        'packages',
        'ozon_webhook_events',
        'ozon_warehouses',
        'ozon_sync_logs',
        'ozon_sync_checkpoints',
        'ozon_stock_update_logs',
        'ozon_shops',
        'ozon_shipment_packages',
        'ozon_returns',
        'ozon_refunds',
        'ozon_promotion_products',
        'ozon_promotion_actions',
        'ozon_products',
        'ozon_product_templates',
        'ozon_product_sync_errors',
        'ozon_product_selection_items',
        'ozon_product_selection_import_history',
        'ozon_product_import_logs',
        'ozon_product_collection_records',
        'ozon_price_update_logs',
        'ozon_postings',
        'ozon_orders',
        'ozon_order_items',
        'ozon_media_import_logs',
        'ozon_global_settings',
        'ozon_finance_transactions',
        'ozon_finance_sync_watermarks',
        'ozon_domestic_tracking_numbers',
        'ozon_daily_stats',
        'ozon_collection_sources',
        'ozon_chats',
        'ozon_chat_messages',
        'ozon_category_commissions',
        'ozon_category_attributes',
        'ozon_categories',
        'ozon_cancellations',
        'ozon_attribute_dictionary_values',
        'orders',
        'order_items',
        'listings',
        'kuajing84_sync_logs',
        'kuajing84_global_config',
        'inventories',
        'exchange_rates',
        'exchange_rate_config',
        'cloudinary_configs',
        'chatgpt_translation_configs',
        'audit_logs_archive',
        'audit_logs',
        'api_keys',
        'aliyun_translation_configs',
        'aliyun_oss_configs',
    ]

    for table in tables:
        op.execute(f'DROP TABLE IF EXISTS {table} CASCADE')

    op.execute('DROP EXTENSION IF EXISTS pg_trgm')
