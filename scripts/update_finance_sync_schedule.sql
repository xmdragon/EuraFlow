-- 更新OZON财务费用同步服务调度配置
-- 改为每小时15分运行一次（cron表达式）
-- 运行方式: psql -U postgres -d euraflow -f scripts/update_finance_sync_schedule.sql

BEGIN;

-- 更新调度配置
UPDATE sync_services
SET
    service_type = 'cron',
    schedule_config = '15 * * * *',  -- 每小时的15分运行（例如：01:15, 02:15, 03:15...）
    updated_at = NOW()
WHERE service_key = 'ozon_finance_sync';

-- 验证更新结果
SELECT
    id,
    service_key,
    service_name,
    service_type,
    schedule_config AS new_schedule,
    is_enabled,
    updated_at
FROM sync_services
WHERE service_key = 'ozon_finance_sync';

COMMIT;

-- 提示信息
\echo ''
\echo '✅ 财务同步服务调度配置已更新'
\echo '   - 调度类型：cron'
\echo '   - 调度配置：15 * * * * （每小时15分运行）'
\echo '   - 下次运行时间：每小时的第15分钟'
\echo ''
\echo '⚠️  注意：需要重启服务使配置生效'
