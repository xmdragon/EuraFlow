#!/bin/bash
# EuraFlow 日志查看工具
# 用法: ./view_logs.sh [service] [lines]
# 示例: ./view_logs.sh backend 50
#      ./view_logs.sh celery_beat
#      ./view_logs.sh all

SERVICE="${1:-all}"
LINES="${2:-50}"

show_service_log() {
    local service=$1
    local lines=$2

    echo "================================================================================"
    echo "  $service - STDOUT (最后 $lines 行)"
    echo "================================================================================"
    supervisorctl tail -$lines euraflow:$service stdout 2>/dev/null || echo "无输出"
    echo ""

    echo "================================================================================"
    echo "  $service - STDERR (最后 $lines 行)"
    echo "================================================================================"
    supervisorctl tail -$lines euraflow:$service stderr 2>/dev/null || echo "无错误"
    echo ""
}

if [ "$SERVICE" == "all" ]; then
    echo ""
    echo "################################################################################"
    echo "#                        EuraFlow 所有服务日志                                  #"
    echo "################################################################################"
    echo ""

    for svc in backend celery_beat celery_worker worker; do
        show_service_log $svc $LINES
    done

elif [ "$SERVICE" == "help" ] || [ "$SERVICE" == "-h" ] || [ "$SERVICE" == "--help" ]; then
    echo "EuraFlow 日志查看工具"
    echo ""
    echo "用法: $0 [service] [lines]"
    echo ""
    echo "参数:"
    echo "  service  - 服务名称 (backend, celery_beat, celery_worker, worker, all)"
    echo "  lines    - 显示行数 (默认: 50)"
    echo ""
    echo "示例:"
    echo "  $0 backend 100        # 查看后端服务最后100行日志"
    echo "  $0 celery_beat        # 查看 Celery Beat 调度器日志"
    echo "  $0 celery_worker 200  # 查看 Celery Worker 最后200行日志"
    echo "  $0 all                # 查看所有服务日志"
    echo ""
else
    show_service_log $SERVICE $LINES
fi
