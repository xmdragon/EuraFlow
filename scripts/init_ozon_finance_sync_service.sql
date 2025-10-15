-- 初始化OZON财务费用同步服务配置
-- 运行方式: psql -U postgres -d euraflow -f scripts/init_ozon_finance_sync_service.sql

-- 插入服务配置（如果不存在）
INSERT INTO sync_services (
    service_key,
    service_name,
    service_description,
    service_type,
    schedule_config,
    is_enabled,
    config_json,
    created_at,
    updated_at
) VALUES (
    'ozon_finance_sync',
    'OZON财务费用同步',
    '自动同步已签收订单的财务费用（尾程派送、国际物流、Ozon佣金），使用历史汇率将RUB转换为CNY',
    'interval',
    '600',  -- 每10分钟（600秒）
    true,
    '{"batch_size": 10, "delay_seconds": 0}'::jsonb,
    NOW(),
    NOW()
)
ON CONFLICT (service_key) DO UPDATE
SET
    service_name = EXCLUDED.service_name,
    service_description = EXCLUDED.service_description,
    schedule_config = EXCLUDED.schedule_config,
    config_json = EXCLUDED.config_json,
    updated_at = NOW();

-- 查询确认
SELECT
    id,
    service_key,
    service_name,
    service_type,
    schedule_config,
    is_enabled,
    config_json,
    created_at
FROM sync_services
WHERE service_key = 'ozon_finance_sync';
