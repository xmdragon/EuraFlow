#!/bin/bash

#===============================================================================
# EuraFlow 备份脚本
# 支持数据库、文件、配置的全量和增量备份
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
BACKUP_ROOT="/backup/euraflow"
INSTALL_DIR="/opt/euraflow"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30
S3_BUCKET=${BACKUP_S3_BUCKET:-""}
DB_NAME="euraflow"
DB_USER="euraflow"

# 备份类型
BACKUP_DB=true
BACKUP_FILES=true
BACKUP_CONFIG=true
BACKUP_LOGS=false

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    exit 1
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# 创建备份目录
create_backup_dirs() {
    mkdir -p "${BACKUP_ROOT}"/{db,files,config,logs,temp}
}

# 备份数据库
backup_database() {
    if [[ "$BACKUP_DB" != "true" ]]; then
        return
    fi

    log_info "开始备份数据库..."

    local backup_file="${BACKUP_ROOT}/db/euraflow_${DATE}.sql.gz"

    # 检查 PostgreSQL 是否运行
    if ! systemctl is-active --quiet postgresql; then
        log_error "PostgreSQL 服务未运行"
    fi

    # 执行备份
    export PGPASSWORD="${DB_PASSWORD:-$(grep EF__DATABASE__URL $INSTALL_DIR/.env | cut -d':' -f3 | cut -d'@' -f1)}"

    pg_dump -U $DB_USER -h localhost -d $DB_NAME \
        --no-owner \
        --no-acl \
        --clean \
        --if-exists \
        --verbose 2>/dev/null | gzip -9 > "$backup_file"

    if [[ ${PIPESTATUS[0]} -eq 0 ]]; then
        local size=$(du -h "$backup_file" | cut -f1)
        log_success "数据库备份完成: $backup_file (大小: $size)"

        # 生成恢复脚本
        cat > "${backup_file%.sql.gz}_restore.sh" << EOF
#!/bin/bash
# 数据库恢复脚本
# 生成时间: $(date)
# 备份文件: $(basename $backup_file)

echo "警告：此操作将覆盖现有数据库！"
read -p "确定要恢复数据库吗？(yes/no): " confirm
if [[ "\$confirm" != "yes" ]]; then
    echo "操作已取消"
    exit 0
fi

gunzip -c "$backup_file" | psql -U $DB_USER -h localhost -d $DB_NAME

echo "数据库恢复完成"
EOF
        chmod +x "${backup_file%.sql.gz}_restore.sh"
    else
        log_error "数据库备份失败"
    fi

    unset PGPASSWORD
}

# 备份文件
backup_files() {
    if [[ "$BACKUP_FILES" != "true" ]]; then
        return
    fi

    log_info "开始备份文件..."

    local backup_file="${BACKUP_ROOT}/files/euraflow_files_${DATE}.tar.gz"

    # 创建文件列表
    local include_list="${BACKUP_ROOT}/temp/include.txt"
    cat > "$include_list" << EOF
uploads/
web/dist/
plugins/
static/
EOF

    # 创建排除列表
    local exclude_list="${BACKUP_ROOT}/temp/exclude.txt"
    cat > "$exclude_list" << EOF
*.pyc
__pycache__/
.git/
node_modules/
venv/
*.log
.env.local
.pytest_cache/
.coverage
*.swp
*.swo
*~
.DS_Store
EOF

    # 执行备份
    cd "$INSTALL_DIR"
    tar czf "$backup_file" \
        --files-from="$include_list" \
        --exclude-from="$exclude_list" \
        2>/dev/null || true

    if [[ -f "$backup_file" ]]; then
        local size=$(du -h "$backup_file" | cut -f1)
        log_success "文件备份完成: $backup_file (大小: $size)"
    else
        log_warn "文件备份失败或没有文件需要备份"
    fi

    # 清理临时文件
    rm -f "$include_list" "$exclude_list"
}

# 备份配置
backup_config() {
    if [[ "$BACKUP_CONFIG" != "true" ]]; then
        return
    fi

    log_info "开始备份配置..."

    local backup_file="${BACKUP_ROOT}/config/euraflow_config_${DATE}.tar.gz"

    # 创建临时目录
    local temp_dir="${BACKUP_ROOT}/temp/config_${DATE}"
    mkdir -p "$temp_dir"

    # 复制配置文件
    cp "$INSTALL_DIR/.env" "$temp_dir/" 2>/dev/null || true
    cp "$INSTALL_DIR"/*.yml "$temp_dir/" 2>/dev/null || true
    cp "$INSTALL_DIR"/*.yaml "$temp_dir/" 2>/dev/null || true
    cp "$INSTALL_DIR"/*.json "$temp_dir/" 2>/dev/null || true
    cp "$INSTALL_DIR"/*.toml "$temp_dir/" 2>/dev/null || true
    cp -r "$INSTALL_DIR/config" "$temp_dir/" 2>/dev/null || true

    # Nginx配置
    mkdir -p "$temp_dir/nginx"
    cp /etc/nginx/sites-available/euraflow "$temp_dir/nginx/" 2>/dev/null || true
    cp -r /etc/nginx/snippets "$temp_dir/nginx/" 2>/dev/null || true

    # Systemd服务文件
    mkdir -p "$temp_dir/systemd"
    cp /etc/systemd/system/euraflow*.service "$temp_dir/systemd/" 2>/dev/null || true

    # SSL证书信息（不备份私钥）
    if [[ -d /etc/letsencrypt/live ]]; then
        mkdir -p "$temp_dir/ssl"
        echo "证书域名:" > "$temp_dir/ssl/cert_info.txt"
        ls /etc/letsencrypt/live >> "$temp_dir/ssl/cert_info.txt"
        echo "" >> "$temp_dir/ssl/cert_info.txt"
        echo "证书有效期:" >> "$temp_dir/ssl/cert_info.txt"
        for domain in /etc/letsencrypt/live/*/; do
            domain_name=$(basename "$domain")
            echo "$domain_name:" >> "$temp_dir/ssl/cert_info.txt"
            openssl x509 -enddate -noout -in "$domain/fullchain.pem" >> "$temp_dir/ssl/cert_info.txt" 2>/dev/null || true
        done
    fi

    # 打包配置
    tar czf "$backup_file" -C "$temp_dir" . 2>/dev/null

    if [[ -f "$backup_file" ]]; then
        local size=$(du -h "$backup_file" | cut -f1)
        log_success "配置备份完成: $backup_file (大小: $size)"
    else
        log_warn "配置备份失败"
    fi

    # 清理临时目录
    rm -rf "$temp_dir"
}

# 备份日志
backup_logs() {
    if [[ "$BACKUP_LOGS" != "true" ]]; then
        return
    fi

    log_info "开始备份日志..."

    local backup_file="${BACKUP_ROOT}/logs/euraflow_logs_${DATE}.tar.gz"

    # 打包日志
    tar czf "$backup_file" \
        -C /var/log \
        euraflow/ \
        nginx/euraflow*.log \
        2>/dev/null || true

    if [[ -f "$backup_file" ]]; then
        local size=$(du -h "$backup_file" | cut -f1)
        log_success "日志备份完成: $backup_file (大小: $size)"
    else
        log_warn "日志备份失败或没有日志文件"
    fi
}

# 上传到S3
upload_to_s3() {
    if [[ -z "$S3_BUCKET" ]]; then
        log_info "未配置S3，跳过上传"
        return
    fi

    log_info "上传备份到S3..."

    # 检查AWS CLI
    if ! command -v aws &> /dev/null; then
        log_warn "AWS CLI 未安装，跳过S3上传"
        return
    fi

    # 上传今天的备份
    local today=$(date +%Y%m%d)
    for file in "${BACKUP_ROOT}"/*/*.${today}*; do
        if [[ -f "$file" ]]; then
            aws s3 cp "$file" "s3://${S3_BUCKET}/euraflow-backup/$(basename $(dirname $file))/$(basename $file)" \
                --storage-class STANDARD_IA \
                --metadata "backup-date=${DATE},server=$(hostname)" || {
                log_warn "上传失败: $file"
            }
        fi
    done

    log_success "S3上传完成"
}

# 清理旧备份
cleanup_old_backups() {
    log_info "清理超过 ${RETENTION_DAYS} 天的旧备份..."

    # 清理本地备份
    find "${BACKUP_ROOT}" -type f -name "*.gz" -mtime +${RETENTION_DAYS} -delete
    find "${BACKUP_ROOT}" -type f -name "*_restore.sh" -mtime +${RETENTION_DAYS} -delete

    # 清理S3旧备份
    if [[ ! -z "$S3_BUCKET" ]] && command -v aws &> /dev/null; then
        local cutoff_date=$(date -d "${RETENTION_DAYS} days ago" +%Y-%m-%d)
        aws s3api list-objects-v2 \
            --bucket "${S3_BUCKET}" \
            --prefix "euraflow-backup/" \
            --query "Contents[?LastModified<='${cutoff_date}'].Key" \
            --output text | xargs -I {} aws s3 rm "s3://${S3_BUCKET}/{}" 2>/dev/null || true
    fi

    log_success "旧备份清理完成"
}

# 生成备份报告
generate_report() {
    local report_file="${BACKUP_ROOT}/backup_report_${DATE}.txt"

    cat > "$report_file" << EOF
===============================================================================
EuraFlow 备份报告
===============================================================================
时间: $(date)
主机: $(hostname)
备份目录: ${BACKUP_ROOT}

备份内容:
-----------
EOF

    # 列出备份文件
    for type in db files config logs; do
        echo "" >> "$report_file"
        echo "[$type]" >> "$report_file"
        ls -lh "${BACKUP_ROOT}/${type}/"*${DATE}* 2>/dev/null >> "$report_file" || echo "  无备份" >> "$report_file"
    done

    # 磁盘使用情况
    echo "" >> "$report_file"
    echo "磁盘使用:" >> "$report_file"
    du -sh "${BACKUP_ROOT}"/* >> "$report_file"

    echo "" >> "$report_file"
    echo "总计:" >> "$report_file"
    du -sh "${BACKUP_ROOT}" >> "$report_file"

    # 可用空间
    echo "" >> "$report_file"
    echo "可用空间:" >> "$report_file"
    df -h "${BACKUP_ROOT}" >> "$report_file"

    log_info "备份报告: $report_file"
}

# 验证备份
verify_backup() {
    log_info "验证备份完整性..."

    local has_error=false

    # 验证数据库备份
    if [[ "$BACKUP_DB" == "true" ]]; then
        local db_backup=$(ls -t "${BACKUP_ROOT}/db/"*${DATE}*.sql.gz 2>/dev/null | head -1)
        if [[ -f "$db_backup" ]]; then
            gunzip -t "$db_backup" 2>/dev/null || {
                log_error "数据库备份文件损坏: $db_backup"
                has_error=true
            }
        else
            log_warn "未找到数据库备份文件"
        fi
    fi

    # 验证文件备份
    if [[ "$BACKUP_FILES" == "true" ]]; then
        local file_backup=$(ls -t "${BACKUP_ROOT}/files/"*${DATE}*.tar.gz 2>/dev/null | head -1)
        if [[ -f "$file_backup" ]]; then
            tar tzf "$file_backup" > /dev/null 2>&1 || {
                log_error "文件备份损坏: $file_backup"
                has_error=true
            }
        fi
    fi

    if [[ "$has_error" == "false" ]]; then
        log_success "备份验证通过"
    fi
}

# 发送通知
send_notification() {
    local status=$1
    local message=$2

    # 如果配置了webhook
    if [[ ! -z "${ALERT_WEBHOOK_URL}" ]]; then
        curl -X POST "${ALERT_WEBHOOK_URL}" \
            -H "Content-Type: application/json" \
            -d "{\"text\":\"EuraFlow Backup ${status}: ${message}\"}" \
            2>/dev/null || true
    fi

    # 写入系统日志
    logger -t "euraflow-backup" "${status}: ${message}"
}

# 显示使用帮助
show_help() {
    cat << EOF
用法: $0 [选项]

选项:
  -h, --help           显示帮助信息
  -d, --database       仅备份数据库
  -f, --files          仅备份文件
  -c, --config         仅备份配置
  -l, --logs           包含日志备份
  -a, --all            备份所有内容（包括日志）
  -s, --s3             上传到S3
  -r, --retain DAYS    保留天数（默认: 30）
  -v, --verify         验证备份完整性
  --restore FILE       恢复指定备份

示例:
  $0                   # 执行默认备份（数据库+文件+配置）
  $0 -d                # 仅备份数据库
  $0 -a -s            # 备份所有内容并上传到S3
  $0 --restore /backup/euraflow/db/euraflow_20240101_120000.sql.gz

EOF
}

# 恢复备份
restore_backup() {
    local backup_file=$1

    if [[ ! -f "$backup_file" ]]; then
        log_error "备份文件不存在: $backup_file"
    fi

    log_warn "警告：恢复操作将覆盖现有数据！"
    read -p "确定要继续吗？(yes/no): " confirm
    if [[ "$confirm" != "yes" ]]; then
        log_info "操作已取消"
        exit 0
    fi

    # 判断备份类型
    case "$backup_file" in
        *.sql.gz)
            log_info "恢复数据库备份..."
            gunzip -c "$backup_file" | psql -U $DB_USER -h localhost -d $DB_NAME
            ;;
        *files*.tar.gz)
            log_info "恢复文件备份..."
            cd "$INSTALL_DIR"
            tar xzf "$backup_file"
            ;;
        *config*.tar.gz)
            log_info "恢复配置备份..."
            tar xzf "$backup_file" -C /tmp/restore_config
            echo "配置已解压到 /tmp/restore_config，请手动复制需要的文件"
            ;;
        *)
            log_error "未知的备份文件类型"
            ;;
    esac

    log_success "恢复完成"
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
            -d|--database)
                BACKUP_DB=true
                BACKUP_FILES=false
                BACKUP_CONFIG=false
                ;;
            -f|--files)
                BACKUP_DB=false
                BACKUP_FILES=true
                BACKUP_CONFIG=false
                ;;
            -c|--config)
                BACKUP_DB=false
                BACKUP_FILES=false
                BACKUP_CONFIG=true
                ;;
            -l|--logs)
                BACKUP_LOGS=true
                ;;
            -a|--all)
                BACKUP_DB=true
                BACKUP_FILES=true
                BACKUP_CONFIG=true
                BACKUP_LOGS=true
                ;;
            -s|--s3)
                UPLOAD_TO_S3=true
                ;;
            -r|--retain)
                RETENTION_DAYS=$2
                shift
                ;;
            -v|--verify)
                VERIFY_BACKUP=true
                ;;
            --restore)
                restore_backup "$2"
                exit 0
                ;;
            *)
                echo "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
        shift
    done

    # 开始备份
    log_info "开始EuraFlow备份..."
    log_info "备份类型: DB=$BACKUP_DB, FILES=$BACKUP_FILES, CONFIG=$BACKUP_CONFIG, LOGS=$BACKUP_LOGS"

    # 创建目录
    create_backup_dirs

    # 执行备份
    backup_database
    backup_files
    backup_config
    backup_logs

    # 验证备份
    if [[ "${VERIFY_BACKUP}" == "true" ]]; then
        verify_backup
    fi

    # 上传到S3
    if [[ "${UPLOAD_TO_S3}" == "true" ]]; then
        upload_to_s3
    fi

    # 清理旧备份
    cleanup_old_backups

    # 生成报告
    generate_report

    # 发送通知
    send_notification "SUCCESS" "备份完成于 ${DATE}"

    log_success "EuraFlow备份完成！"
}

# 错误处理
trap 'send_notification "FAILED" "备份失败: $?"' ERR

# 运行主函数
main "$@"