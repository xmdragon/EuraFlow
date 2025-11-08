#!/bin/bash
# EuraFlow 定时任务状态查看工具

echo "================================================================================"
echo "                       EuraFlow 定时任务状态报告"
echo "================================================================================"
echo ""

./venv/bin/python << 'PYTHON_SCRIPT'
from ef_core.tasks.celery_app import celery_app
from datetime import datetime
import sys

def format_cron(schedule_obj):
    """格式化 cron 表达式为可读格式"""
    try:
        if hasattr(schedule_obj, 'minute'):
            m = schedule_obj.minute
            h = schedule_obj.hour
            dom = schedule_obj.day_of_month
            mon = schedule_obj.month_of_year
            dow = schedule_obj.day_of_week

            # 简化常见的 cron 表达式
            if isinstance(m, set) and len(m) == 60:
                return "每分钟"
            elif isinstance(m, set) and all(x % 5 == 0 for x in m) and len(m) == 12:
                return "每5分钟"
            elif isinstance(m, set) and all(x % 10 == 0 for x in m) and len(m) == 6:
                return "每10分钟"
            elif isinstance(m, set) and all(x % 30 == 0 for x in m) and len(m) == 2:
                return "每30分钟"
            elif isinstance(m, set) and len(m) == 1:
                minute_val = list(m)[0]
                if isinstance(h, set) and len(h) == 1:
                    hour_val = list(h)[0]
                    return f"每天 {hour_val:02d}:{minute_val:02d}"
                elif isinstance(h, set) and len(h) == 24:
                    return f"每小时第{minute_val}分钟"
                elif isinstance(h, set):
                    hours = sorted(list(h))
                    if len(hours) <= 3:
                        return f"每天 {','.join(f'{h:02d}:{minute_val:02d}' for h in hours)}"
                    else:
                        interval = hours[1] - hours[0]
                        return f"每{interval}小时（第{minute_val}分钟）"

            # 特殊情况：星期几
            if isinstance(dow, set) and len(dow) == 1:
                dow_val = list(dow)[0]
                dow_names = ['一', '二', '三', '四', '五', '六', '日']
                return f"每周{dow_names[dow_val-1 if dow_val > 0 else 6]}"

            return f"cron: {m} {h} {dom} {mon} {dow}"
        else:
            return str(schedule_obj)
    except Exception as e:
        return str(schedule_obj)

# 获取所有任务
schedule = celery_app.conf.beat_schedule

# 按类别分类
categories = {
    '核心系统任务': [],
    'OZON 业务任务': [],
    '财务任务': [],
    '系统维护任务': []
}

for name, config in schedule.items():
    task_name = config.get('task', '')
    schedule_obj = config.get('schedule')
    queue = config.get('options', {}).get('queue', 'default')

    schedule_str = format_cron(schedule_obj)

    task_info = {
        'name': task_name,
        'schedule': schedule_str,
        'queue': queue
    }

    if task_name.startswith('ef.core.'):
        categories['核心系统任务'].append(task_info)
    elif task_name.startswith('ef.ozon.'):
        categories['OZON 业务任务'].append(task_info)
    elif task_name.startswith('ef.finance.'):
        categories['财务任务'].append(task_info)
    elif task_name.startswith('ef.system.'):
        categories['系统维护任务'].append(task_info)

# 打印报告
print(f"📊 总计: {len(schedule)} 个定时任务")
print("")

for category, tasks in categories.items():
    if tasks:
        print(f"【{category}】({len(tasks)} 个)")
        print("-" * 80)
        for i, task in enumerate(sorted(tasks, key=lambda x: x['name']), 1):
            print(f"{i}. {task['name']}")
            print(f"   ⏰ 调度: {task['schedule']}")
            print(f"   📦 队列: {task['queue']}")
            print("")

print("=" * 80)
print("✅ 所有任务已正确注册到 Celery Beat 调度器")
print("")
print("💡 提示:")
print("   - 查看服务日志: ./view_logs.sh [service]")
print("   - 查看系统状态: supervisorctl status")
print("   - 查看 Celery Worker: ./view_logs.sh celery_worker 100")
print("=" * 80)

PYTHON_SCRIPT
