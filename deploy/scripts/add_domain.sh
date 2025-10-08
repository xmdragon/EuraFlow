#!/bin/bash

#===============================================================================
# EuraFlow 添加域名脚本
# 在保持现有域名的前提下为项目添加新域名并配置SSL证书
#
# 使用方法:
#   sudo ./add_domain.sh example.com
#   sudo ./add_domain.sh example.com --skip-ssl  # 跳过SSL配置
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
NGINX_CONF_DIR="/etc/nginx/sites-available"
NGINX_ENABLED_DIR="/etc/nginx/sites-enabled"
NGINX_CONF_NAME="euraflow"
BACKUP_DIR="/backup/euraflow/nginx"
SKIP_SSL=false

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

# 打印横幅
print_banner() {
    echo -e "${BLUE}"
    cat << "EOF"
╔═══════════════════════════════════════════════════════════╗
║           EuraFlow - 域名添加工具 v1.0                   ║
╚═══════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 显示使用说明
show_usage() {
    cat << EOF
使用方法:
    $0 <new_domain> [选项]

参数:
    new_domain       要添加的新域名（例如: example.com）

选项:
    --skip-ssl       跳过SSL证书配置
    -h, --help       显示此帮助信息

示例:
    $0 example.com
    $0 example.com --skip-ssl

说明:
    此脚本会在保持现有域名的前提下添加新域名，并自动配置SSL证书。
    使用 certbot --expand 功能扩展现有证书以支持新域名。

EOF
    exit 0
}

# 检查权限
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本必须以 root 权限运行"
    fi
}

# 验证域名格式
validate_domain() {
    local domain=$1

    # 基本域名格式检查
    if [[ ! $domain =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$ ]]; then
        log_error "域名格式无效: $domain"
    fi

    log_info "域名格式验证通过: $domain"
}

# 检查依赖
check_dependencies() {
    log_info "检查依赖..."

    if ! command -v nginx &> /dev/null; then
        log_error "未安装 Nginx"
    fi

    if ! command -v certbot &> /dev/null && [[ $SKIP_SSL == false ]]; then
        log_warn "未安装 Certbot，正在安装..."
        apt-get update
        apt-get install -y certbot python3-certbot-nginx
    fi

    log_success "依赖检查完成"
}

# 检查nginx配置文件
check_nginx_config() {
    log_info "检查 Nginx 配置文件..."

    if [[ ! -f "$NGINX_CONF_DIR/$NGINX_CONF_NAME" ]]; then
        log_error "未找到 Nginx 配置文件: $NGINX_CONF_DIR/$NGINX_CONF_NAME"
    fi

    log_info "找到配置文件: $NGINX_CONF_DIR/$NGINX_CONF_NAME"
}

# 检查域名是否已存在
check_domain_exists() {
    local domain=$1
    local config_file="$NGINX_CONF_DIR/$NGINX_CONF_NAME"

    log_info "检查域名是否已配置..."

    if grep -q "server_name.*$domain" "$config_file"; then
        log_error "域名 $domain 已存在于配置中"
    fi

    log_info "域名未配置，可以继续"
}

# 获取当前配置的域名列表
get_current_domains() {
    local config_file="$NGINX_CONF_DIR/$NGINX_CONF_NAME"

    # 提取所有 server_name 中的域名
    grep -oP 'server_name\s+\K[^;]+' "$config_file" | tr ' ' '\n' | grep -v '^$' | sort -u
}

# 备份nginx配置
backup_nginx_config() {
    log_info "备份 Nginx 配置..."

    mkdir -p "$BACKUP_DIR"
    local backup_file="$BACKUP_DIR/${NGINX_CONF_NAME}_$(date +%Y%m%d_%H%M%S).conf"

    cp "$NGINX_CONF_DIR/$NGINX_CONF_NAME" "$backup_file"

    log_success "配置已备份到: $backup_file"
    echo "$backup_file"
}

# 添加域名到nginx配置
add_domain_to_config() {
    local new_domain=$1
    local config_file="$NGINX_CONF_DIR/$NGINX_CONF_NAME"

    log_info "添加域名到 Nginx 配置..."

    # 使用sed在所有server_name后添加新域名
    # 这会在每个server_name行的末尾（分号之前）添加新域名
    sed -i "s/\(server_name[^;]*\);/\1 $new_domain;/" "$config_file"

    log_success "域名已添加到配置文件"
}

# 测试nginx配置
test_nginx_config() {
    log_info "测试 Nginx 配置..."

    if nginx -t 2>&1 | grep -q "syntax is ok"; then
        log_success "Nginx 配置测试通过"
        return 0
    else
        log_error "Nginx 配置测试失败"
        return 1
    fi
}

# 重载nginx
reload_nginx() {
    log_info "重载 Nginx..."

    if systemctl reload nginx; then
        log_success "Nginx 已重载"
    else
        log_error "Nginx 重载失败"
    fi
}

# 配置SSL证书
configure_ssl() {
    local new_domain=$1
    local config_file="$NGINX_CONF_DIR/$NGINX_CONF_NAME"

    log_info "配置 SSL 证书..."

    # 获取所有配置的域名
    local all_domains=$(get_current_domains | tr '\n' ' ')

    log_info "当前配置的域名: $all_domains"
    log_info "正在为所有域名申请/扩展 SSL 证书..."

    # 构建certbot命令
    local certbot_domains=""
    for domain in $all_domains; do
        certbot_domains="$certbot_domains -d $domain"
    done

    # 尝试扩展现有证书或创建新证书
    log_warn "即将运行 Certbot，请确保:"
    log_warn "  1. 域名 DNS 已正确解析到此服务器"
    log_warn "  2. 防火墙已开放 80 和 443 端口"
    log_warn "  3. Nginx 正在运行"
    echo ""
    read -p "按 Enter 继续，或 Ctrl+C 取消: "

    if certbot certonly \
        --nginx \
        --expand \
        --non-interactive \
        --agree-tos \
        --email admin@${new_domain} \
        $certbot_domains; then
        log_success "SSL 证书配置成功"
    else
        log_error "SSL 证书配置失败，请检查:"
        echo "  1. 域名 DNS 是否已解析"
        echo "  2. 80 端口是否可访问"
        echo "  3. 查看日志: /var/log/letsencrypt/letsencrypt.log"
        exit 1
    fi
}

# 回滚配置
rollback_config() {
    local backup_file=$1

    log_warn "回滚到备份配置..."

    if [[ -f "$backup_file" ]]; then
        cp "$backup_file" "$NGINX_CONF_DIR/$NGINX_CONF_NAME"
        nginx -t && systemctl reload nginx
        log_success "配置已回滚"
    else
        log_error "备份文件不存在: $backup_file"
    fi
}

# 显示配置信息
show_config_info() {
    local new_domain=$1

    echo ""
    log_success "域名添加完成！"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}已配置的域名:${NC}"
    get_current_domains | while read domain; do
        echo "  • $domain"
    done
    echo ""
    echo -e "${GREEN}SSL 证书信息:${NC}"
    certbot certificates 2>/dev/null | grep -A5 "Certificate Name" || echo "  未找到证书信息"
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "${GREEN}后续步骤:${NC}"
    echo "  1. 访问 https://$new_domain 验证配置"
    echo "  2. 检查 SSL 证书: https://www.ssllabs.com/ssltest/"
    echo "  3. 配置 DNS CAA 记录（可选但推荐）"
    echo ""
    echo -e "${YELLOW}证书自动续期:${NC}"
    echo "  Let's Encrypt 证书会通过 cron 自动续期"
    echo "  检查续期任务: systemctl status certbot.timer"
    echo ""
}

# 主函数
main() {
    print_banner

    # 解析参数
    if [[ $# -eq 0 ]] || [[ "$1" == "-h" ]] || [[ "$1" == "--help" ]]; then
        show_usage
    fi

    local new_domain=$1
    shift

    # 解析选项
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-ssl)
                SKIP_SSL=true
                shift
                ;;
            *)
                log_error "未知选项: $1"
                ;;
        esac
    done

    # 执行检查
    check_root
    validate_domain "$new_domain"
    check_dependencies
    check_nginx_config
    check_domain_exists "$new_domain"

    # 显示当前配置
    echo ""
    log_info "当前已配置的域名:"
    get_current_domains | while read domain; do
        echo "  • $domain"
    done
    echo ""
    log_info "即将添加新域名: $new_domain"
    echo ""

    read -p "确认继续？(y/N): " confirm
    if [[ ! $confirm =~ ^[Yy]$ ]]; then
        log_warn "操作已取消"
        exit 0
    fi

    # 备份配置
    backup_file=$(backup_nginx_config)

    # 添加域名
    if ! add_domain_to_config "$new_domain"; then
        log_error "添加域名失败"
    fi

    # 测试配置
    if ! test_nginx_config; then
        log_error "配置测试失败，正在回滚..."
        rollback_config "$backup_file"
    fi

    # 重载nginx
    if ! reload_nginx; then
        log_error "Nginx 重载失败，正在回滚..."
        rollback_config "$backup_file"
    fi

    # 配置SSL
    if [[ $SKIP_SSL == false ]]; then
        if ! configure_ssl "$new_domain"; then
            log_warn "SSL 配置失败，但域名已添加到 Nginx"
            log_warn "可以稍后手动运行: certbot --expand -d $new_domain"
        fi
    else
        log_warn "已跳过 SSL 配置"
    fi

    # 显示结果
    show_config_info "$new_domain"
}

# 运行主函数
main "$@"
