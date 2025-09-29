#!/bin/bash

#===============================================================================
# EuraFlow 健康检查脚本
# 支持多种检查模式和告警集成
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
INSTALL_DIR="/opt/euraflow"
API_URL="http://localhost:8000"
CHECK_MODE="full"  # quick | full | api | services | database
EXIT_ON_ERROR=false
SEND_ALERT=false
WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}"

# 健康状态
HEALTH_STATUS="healthy"
HEALTH_SCORE=100
ISSUES=()

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ISSUES+=("WARN: $1")
    HEALTH_SCORE=$((HEALTH_SCORE - 5))
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    ISSUES+=("ERROR: $1")
    HEALTH_SCORE=$((HEALTH_SCORE - 20))
    HEALTH_STATUS="unhealthy"
    if [[ "$EXIT_ON_ERROR" == "true" ]]; then
        exit 1
    fi
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

# API健康检查
check_api() {
    log_info "检查API健康状态..."

    # 基础健康检查
    if curl -f -s -o /dev/null -w "%{http_code}" "$API_URL/health" | grep -q "200"; then
        log_success "API响应正常"
    else
        log_error "API无响应"
        return 1
    fi

    # 响应时间检查
    RESPONSE_TIME=$(curl -o /dev/null -s -w '%{time_total}' "$API_URL/health")
    RESPONSE_TIME_MS=$(echo "$RESPONSE_TIME * 1000" | bc | cut -d'.' -f1)

    if [[ $RESPONSE_TIME_MS -lt 100 ]]; then
        log_success "API响应时间: ${RESPONSE_TIME_MS}ms (优秀)"
    elif [[ $RESPONSE_TIME_MS -lt 500 ]]; then
        log_success "API响应时间: ${RESPONSE_TIME_MS}ms (良好)"
    elif [[ $RESPONSE_TIME_MS -lt 1000 ]]; then
        log_warn "API响应时间: ${RESPONSE_TIME_MS}ms (较慢)"
    else
        log_error "API响应时间: ${RESPONSE_TIME_MS}ms (过慢)"
    fi

    # 详细健康信息
    if [[ "$CHECK_MODE" == "full" ]] || [[ "$CHECK_MODE" == "api" ]]; then
        HEALTH_DATA=$(curl -s "$API_URL/health" 2>/dev/null || echo "{}")

        # 解析JSON响应
        if command -v jq &> /dev/null; then
            STATUS=$(echo "$HEALTH_DATA" | jq -r '.status // "unknown"')
            DB_STATUS=$(echo "$HEALTH_DATA" | jq -r '.database // "unknown"')
            REDIS_STATUS=$(echo "$HEALTH_DATA" | jq -r '.redis // "unknown"')

            echo "  API状态: $STATUS"
            echo "  数据库: $DB_STATUS"
            echo "  Redis: $REDIS_STATUS"
        fi
    fi
}

# 服务状态检查
check_services() {
    log_info "检查系统服务..."

    local services=(
        "euraflow-backend"
        "euraflow-worker"
        "euraflow-scheduler"
        "euraflow-watermark"
        "euraflow-competitor"
        "euraflow-ozon-sync"
        "postgresql"
        "redis-server"
        "nginx"
    )

    for service in "${services[@]}"; do
        if systemctl is-active --quiet "$service"; then
            log_success "$service 运行中"

            # 检查服务资源使用
            if [[ "$CHECK_MODE" == "full" ]]; then
                PID=$(systemctl show -p MainPID --value "$service")
                if [[ "$PID" != "0" ]]; then
                    # CPU使用率
                    CPU=$(ps -p $PID -o %cpu= 2>/dev/null || echo "0")
                    # 内存使用
                    MEM=$(ps -p $PID -o rss= 2>/dev/null || echo "0")
                    MEM_MB=$((MEM / 1024))

                    echo "    PID: $PID, CPU: ${CPU}%, 内存: ${MEM_MB}MB"

                    # 检查异常
                    if (( $(echo "$CPU > 80" | bc -l) )); then
                        log_warn "$service CPU使用率过高: ${CPU}%"
                    fi
                    if [[ $MEM_MB -gt 2048 ]]; then
                        log_warn "$service 内存使用过高: ${MEM_MB}MB"
                    fi
                fi
            fi
        else
            if [[ "$service" == euraflow-* ]]; then
                log_error "$service 未运行"
            else
                log_warn "$service 未运行"
            fi
        fi
    done
}

# 数据库检查
check_database() {
    log_info "检查数据库状态..."

    # 检查PostgreSQL服务
    if ! systemctl is-active --quiet postgresql; then
        log_error "PostgreSQL服务未运行"
        return 1
    fi

    # 检查连接
    if sudo -u postgres psql -c "SELECT 1" euraflow > /dev/null 2>&1; then
        log_success "数据库连接正常"
    else
        log_error "无法连接到数据库"
        return 1
    fi

    # 检查数据库大小
    DB_SIZE=$(sudo -u postgres psql -t -c "SELECT pg_size_pretty(pg_database_size('euraflow'))" euraflow 2>/dev/null | xargs)
    echo "  数据库大小: $DB_SIZE"

    # 检查连接数
    CONNECTIONS=$(sudo -u postgres psql -t -c "SELECT count(*) FROM pg_stat_activity WHERE datname='euraflow'" 2>/dev/null | xargs)
    MAX_CONNECTIONS=$(sudo -u postgres psql -t -c "SHOW max_connections" 2>/dev/null | xargs)
    echo "  连接数: $CONNECTIONS / $MAX_CONNECTIONS"

    if [[ $CONNECTIONS -gt $((MAX_CONNECTIONS * 80 / 100)) ]]; then
        log_warn "数据库连接数接近上限"
    fi

    # 检查慢查询
    if [[ "$CHECK_MODE" == "full" ]]; then
        SLOW_QUERIES=$(sudo -u postgres psql -t -c "
            SELECT count(*)
            FROM pg_stat_activity
            WHERE datname='euraflow'
            AND state='active'
            AND now() - query_start > interval '5 seconds'
        " euraflow 2>/dev/null | xargs)

        if [[ $SLOW_QUERIES -gt 0 ]]; then
            log_warn "发现 $SLOW_QUERIES 个慢查询"
        fi
    fi
}

# Redis检查
check_redis() {
    log_info "检查Redis状态..."

    # 检查服务
    if ! systemctl is-active --quiet redis-server; then
        log_error "Redis服务未运行"
        return 1
    fi

    # 检查连接
    if redis-cli ping > /dev/null 2>&1; then
        log_success "Redis连接正常"
    else
        log_error "无法连接到Redis"
        return 1
    fi

    # 获取Redis信息
    if [[ "$CHECK_MODE" == "full" ]]; then
        REDIS_INFO=$(redis-cli INFO 2>/dev/null)

        # 内存使用
        USED_MEMORY=$(echo "$REDIS_INFO" | grep "used_memory_human:" | cut -d':' -f2 | tr -d '\r')
        echo "  内存使用: $USED_MEMORY"

        # 连接客户端
        CONNECTED_CLIENTS=$(echo "$REDIS_INFO" | grep "connected_clients:" | cut -d':' -f2 | tr -d '\r')
        echo "  连接客户端: $CONNECTED_CLIENTS"

        # 命令统计
        TOTAL_COMMANDS=$(echo "$REDIS_INFO" | grep "total_commands_processed:" | cut -d':' -f2 | tr -d '\r')
        echo "  处理命令数: $TOTAL_COMMANDS"
    fi
}

# 磁盘空间检查
check_disk() {
    log_info "检查磁盘空间..."

    # 检查主分区
    DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
    DISK_AVAILABLE=$(df -h / | awk 'NR==2 {print $4}')

    if [[ $DISK_USAGE -lt 70 ]]; then
        log_success "磁盘使用率: ${DISK_USAGE}% (可用: $DISK_AVAILABLE)"
    elif [[ $DISK_USAGE -lt 85 ]]; then
        log_warn "磁盘使用率: ${DISK_USAGE}% (可用: $DISK_AVAILABLE)"
    else
        log_error "磁盘空间不足: ${DISK_USAGE}% 已使用"
    fi

    # 检查日志目录
    if [[ -d /var/log/euraflow ]]; then
        LOG_SIZE=$(du -sh /var/log/euraflow 2>/dev/null | cut -f1)
        echo "  日志目录大小: $LOG_SIZE"
    fi

    # 检查备份目录
    if [[ -d /backup/euraflow ]]; then
        BACKUP_SIZE=$(du -sh /backup/euraflow 2>/dev/null | cut -f1)
        echo "  备份目录大小: $BACKUP_SIZE"
    fi
}

# 内存检查
check_memory() {
    log_info "检查内存使用..."

    # 总内存和使用情况
    TOTAL_MEM=$(free -m | awk 'NR==2{print $2}')
    USED_MEM=$(free -m | awk 'NR==2{print $3}')
    FREE_MEM=$(free -m | awk 'NR==2{print $4}')
    USAGE=$((USED_MEM * 100 / TOTAL_MEM))

    if [[ $USAGE -lt 70 ]]; then
        log_success "内存使用: ${USED_MEM}MB / ${TOTAL_MEM}MB (${USAGE}%)"
    elif [[ $USAGE -lt 85 ]]; then
        log_warn "内存使用较高: ${USED_MEM}MB / ${TOTAL_MEM}MB (${USAGE}%)"
    else
        log_error "内存使用过高: ${USED_MEM}MB / ${TOTAL_MEM}MB (${USAGE}%)"
    fi

    # Swap使用
    SWAP_TOTAL=$(free -m | awk 'NR==3{print $2}')
    SWAP_USED=$(free -m | awk 'NR==3{print $3}')
    if [[ $SWAP_TOTAL -gt 0 ]] && [[ $SWAP_USED -gt 0 ]]; then
        SWAP_USAGE=$((SWAP_USED * 100 / SWAP_TOTAL))
        if [[ $SWAP_USAGE -gt 50 ]]; then
            log_warn "Swap使用较高: ${SWAP_USED}MB / ${SWAP_TOTAL}MB (${SWAP_USAGE}%)"
        fi
    fi
}

# CPU检查
check_cpu() {
    log_info "检查CPU使用..."

    # 获取CPU使用率
    CPU_USAGE=$(top -bn1 | grep "Cpu(s)" | awk '{print $2}' | cut -d'%' -f1)

    if (( $(echo "$CPU_USAGE < 50" | bc -l) )); then
        log_success "CPU使用率: ${CPU_USAGE}%"
    elif (( $(echo "$CPU_USAGE < 80" | bc -l) )); then
        log_warn "CPU使用率较高: ${CPU_USAGE}%"
    else
        log_error "CPU使用率过高: ${CPU_USAGE}%"
    fi

    # 系统负载
    LOAD_AVG=$(uptime | awk -F'load average:' '{print $2}')
    CPU_CORES=$(nproc)
    echo "  系统负载: $LOAD_AVG (CPU核心数: $CPU_CORES)"
}

# 网络检查
check_network() {
    log_info "检查网络连接..."

    # 检查端口监听
    local ports=(8000 3000 5432 6379 80 443)
    for port in "${ports[@]}"; do
        if ss -tuln | grep -q ":$port "; then
            log_success "端口 $port 监听中"
        else
            case $port in
                8000) log_error "API端口 $port 未监听" ;;
                3000) log_warn "前端端口 $port 未监听" ;;
                5432) log_error "数据库端口 $port 未监听" ;;
                6379) log_error "Redis端口 $port 未监听" ;;
                80|443) log_warn "Web端口 $port 未监听" ;;
            esac
        fi
    done

    # 检查外网连接
    if ping -c 1 -W 2 8.8.8.8 > /dev/null 2>&1; then
        log_success "外网连接正常"
    else
        log_error "无法访问外网"
    fi
}

# 证书检查
check_ssl() {
    log_info "检查SSL证书..."

    # 获取域名
    DOMAIN=$(grep "server_name" /etc/nginx/sites-available/euraflow 2>/dev/null | head -1 | awk '{print $2}' | tr -d ';')

    if [[ -z "$DOMAIN" ]]; then
        log_warn "未配置域名"
        return
    fi

    # 检查证书文件
    CERT_FILE="/etc/letsencrypt/live/$DOMAIN/fullchain.pem"
    if [[ ! -f "$CERT_FILE" ]]; then
        log_warn "证书文件不存在"
        return
    fi

    # 检查证书有效期
    EXPIRY=$(openssl x509 -enddate -noout -in "$CERT_FILE" | cut -d= -f2)
    EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
    CURRENT_EPOCH=$(date +%s)
    DAYS_LEFT=$(( ($EXPIRY_EPOCH - $CURRENT_EPOCH) / 86400 ))

    if [[ $DAYS_LEFT -gt 30 ]]; then
        log_success "SSL证书有效 (剩余 $DAYS_LEFT 天)"
    elif [[ $DAYS_LEFT -gt 7 ]]; then
        log_warn "SSL证书即将过期 (剩余 $DAYS_LEFT 天)"
    else
        log_error "SSL证书即将过期 (剩余 $DAYS_LEFT 天)"
    fi
}

# 日志检查
check_logs() {
    log_info "检查错误日志..."

    # 检查最近的错误
    local log_files=(
        "/var/log/euraflow/error.log"
        "/var/log/nginx/euraflow_error.log"
        "/var/log/euraflow/worker-error.log"
    )

    for log_file in "${log_files[@]}"; do
        if [[ -f "$log_file" ]]; then
            ERROR_COUNT=$(tail -n 100 "$log_file" 2>/dev/null | grep -iE "error|critical|fatal" | wc -l)
            if [[ $ERROR_COUNT -gt 0 ]]; then
                log_warn "$(basename $log_file) 包含 $ERROR_COUNT 个错误"
            fi
        fi
    done
}

# 发送告警
send_alert() {
    if [[ "$SEND_ALERT" != "true" ]] || [[ -z "$WEBHOOK_URL" ]]; then
        return
    fi

    local message="EuraFlow健康检查报告\n"
    message+="状态: $HEALTH_STATUS\n"
    message+="得分: $HEALTH_SCORE/100\n"

    if [[ ${#ISSUES[@]} -gt 0 ]]; then
        message+="问题:\n"
        for issue in "${ISSUES[@]}"; do
            message+="- $issue\n"
        done
    fi

    curl -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -d "{\"text\":\"$message\"}" \
        2>/dev/null || true
}

# 生成JSON报告
generate_json_report() {
    cat << EOF
{
    "timestamp": "$(date -Iseconds)",
    "status": "$HEALTH_STATUS",
    "score": $HEALTH_SCORE,
    "checks": {
        "api": $(check_api > /dev/null 2>&1 && echo "true" || echo "false"),
        "services": $(check_services > /dev/null 2>&1 && echo "true" || echo "false"),
        "database": $(check_database > /dev/null 2>&1 && echo "true" || echo "false"),
        "redis": $(check_redis > /dev/null 2>&1 && echo "true" || echo "false"),
        "disk": $(check_disk > /dev/null 2>&1 && echo "true" || echo "false"),
        "memory": $(check_memory > /dev/null 2>&1 && echo "true" || echo "false"),
        "cpu": $(check_cpu > /dev/null 2>&1 && echo "true" || echo "false"),
        "network": $(check_network > /dev/null 2>&1 && echo "true" || echo "false")
    },
    "issues": $(printf '%s\n' "${ISSUES[@]}" | jq -R . | jq -s .)
}
EOF
}

# 显示摘要
show_summary() {
    echo ""
    echo "══════════════════════════════════════════════════════"
    echo "健康检查摘要"
    echo "══════════════════════════════════════════════════════"
    echo "状态: $HEALTH_STATUS"
    echo "健康分数: $HEALTH_SCORE/100"

    if [[ ${#ISSUES[@]} -gt 0 ]]; then
        echo ""
        echo "发现的问题:"
        for issue in "${ISSUES[@]}"; do
            echo "  • $issue"
        done
    else
        echo ""
        echo "没有发现问题"
    fi

    echo "══════════════════════════════════════════════════════"
}

# 显示帮助
show_help() {
    cat << EOF
用法: $0 [选项]

选项:
  -h, --help           显示帮助信息
  -m, --mode MODE      检查模式 (quick|full|api|services|database)
  -e, --exit-on-error  遇到错误时退出
  -a, --alert          发送告警通知
  -j, --json           输出JSON格式
  -w, --webhook URL    设置webhook URL

模式说明:
  quick     快速检查（仅关键服务）
  full      完整检查（所有项目）
  api       仅检查API
  services  仅检查服务
  database  仅检查数据库

示例:
  $0                   # 默认完整检查
  $0 -m quick          # 快速检查
  $0 -m full -a        # 完整检查并发送告警
  $0 -j > report.json  # 输出JSON报告

EOF
}

# 主函数
main() {
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -m|--mode)
                CHECK_MODE=$2
                shift
                ;;
            -e|--exit-on-error)
                EXIT_ON_ERROR=true
                ;;
            -a|--alert)
                SEND_ALERT=true
                ;;
            -j|--json)
                OUTPUT_JSON=true
                ;;
            -w|--webhook)
                WEBHOOK_URL=$2
                SEND_ALERT=true
                shift
                ;;
            *)
                echo "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
        shift
    done

    # JSON输出模式
    if [[ "$OUTPUT_JSON" == "true" ]]; then
        check_api > /dev/null 2>&1
        check_services > /dev/null 2>&1
        check_database > /dev/null 2>&1
        check_redis > /dev/null 2>&1
        check_disk > /dev/null 2>&1
        check_memory > /dev/null 2>&1
        check_cpu > /dev/null 2>&1
        check_network > /dev/null 2>&1
        generate_json_report
        exit 0
    fi

    # 显示横幅
    echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║          EuraFlow 健康检查工具 v1.0                   ║${NC}"
    echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 执行检查
    case $CHECK_MODE in
        quick)
            check_api
            check_services
            check_database
            ;;
        api)
            check_api
            ;;
        services)
            check_services
            ;;
        database)
            check_database
            check_redis
            ;;
        full|*)
            check_api
            check_services
            check_database
            check_redis
            check_disk
            check_memory
            check_cpu
            check_network
            check_ssl
            check_logs
            ;;
    esac

    # 显示摘要
    show_summary

    # 发送告警
    send_alert

    # 设置退出码
    if [[ "$HEALTH_STATUS" == "unhealthy" ]]; then
        exit 1
    fi
}

# 运行主函数
main "$@"