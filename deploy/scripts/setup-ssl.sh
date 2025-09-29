#!/bin/bash

#===============================================================================
# SSL证书自动配置脚本
# 支持 Let's Encrypt 和自签名证书
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

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

# 检查权限
check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本必须以 root 权限运行"
    fi
}

# 安装 Certbot
install_certbot() {
    log_info "安装 Certbot..."

    if ! command -v certbot &> /dev/null; then
        if [[ -f /etc/debian_version ]]; then
            apt-get update
            apt-get install -y certbot python3-certbot-nginx
        elif [[ -f /etc/redhat-release ]]; then
            dnf install -y epel-release
            dnf install -y certbot python3-certbot-nginx
        else
            log_error "不支持的操作系统"
        fi
    else
        log_info "Certbot 已安装"
    fi
}

# 生成 DH 参数
generate_dhparam() {
    log_info "生成 DH 参数（这可能需要几分钟）..."

    if [[ ! -f /etc/nginx/dhparam.pem ]]; then
        openssl dhparam -out /etc/nginx/dhparam.pem 2048
        chmod 600 /etc/nginx/dhparam.pem
        log_info "DH 参数已生成"
    else
        log_info "DH 参数已存在"
    fi
}

# 创建 SSL 参数片段
create_ssl_params() {
    log_info "创建 SSL 参数配置..."

    mkdir -p /etc/nginx/snippets

    cat > /etc/nginx/snippets/ssl-params.conf << 'EOF'
# SSL参数配置
ssl_protocols TLSv1.2 TLSv1.3;
ssl_prefer_server_ciphers off;
ssl_dhparam /etc/nginx/dhparam.pem;
ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
ssl_ecdh_curve secp384r1;
ssl_session_timeout 10m;
ssl_session_cache shared:SSL:10m;
ssl_session_tickets off;
ssl_stapling on;
ssl_stapling_verify on;

# 安全头
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
add_header X-Frame-Options "SAMEORIGIN" always;
add_header X-Content-Type-Options "nosniff" always;
add_header X-XSS-Protection "1; mode=block" always;
EOF

    log_info "SSL 参数配置已创建"
}

# 申请 Let's Encrypt 证书
request_letsencrypt() {
    local domain=$1
    local email=$2

    log_info "申请 Let's Encrypt 证书..."

    # 创建验证目录
    mkdir -p /var/www/certbot
    chown www-data:www-data /var/www/certbot

    # 测试 Nginx 配置
    nginx -t || log_error "Nginx 配置错误"

    # 重载 Nginx
    systemctl reload nginx

    # 申请证书
    certbot certonly \
        --webroot \
        --webroot-path=/var/www/certbot \
        --email "$email" \
        --agree-tos \
        --no-eff-email \
        --force-renewal \
        -d "$domain" \
        -d "www.$domain"

    if [[ $? -eq 0 ]]; then
        log_info "证书申请成功"

        # 更新 Nginx 配置以使用新证书
        update_nginx_ssl "$domain"
    else
        log_error "证书申请失败"
    fi
}

# 更新 Nginx SSL 配置
update_nginx_ssl() {
    local domain=$1

    log_info "更新 Nginx SSL 配置..."

    # 备份原配置
    cp /etc/nginx/sites-available/euraflow /etc/nginx/sites-available/euraflow.bak

    # 更新证书路径
    sed -i "s|ssl_certificate .*|ssl_certificate /etc/letsencrypt/live/$domain/fullchain.pem;|" /etc/nginx/sites-available/euraflow
    sed -i "s|ssl_certificate_key .*|ssl_certificate_key /etc/letsencrypt/live/$domain/privkey.pem;|" /etc/nginx/sites-available/euraflow
    sed -i "s|ssl_trusted_certificate .*|ssl_trusted_certificate /etc/letsencrypt/live/$domain/chain.pem;|" /etc/nginx/sites-available/euraflow

    # 测试配置
    nginx -t || {
        cp /etc/nginx/sites-available/euraflow.bak /etc/nginx/sites-available/euraflow
        log_error "Nginx 配置更新失败"
    }

    # 重载 Nginx
    systemctl reload nginx
    log_info "Nginx SSL 配置已更新"
}

# 生成自签名证书
generate_self_signed() {
    local domain=$1

    log_info "生成自签名证书..."

    # 创建证书目录
    mkdir -p /etc/ssl/certs/euraflow

    # 生成私钥
    openssl genrsa -out /etc/ssl/certs/euraflow/privkey.pem 2048

    # 生成证书请求
    openssl req -new \
        -key /etc/ssl/certs/euraflow/privkey.pem \
        -out /etc/ssl/certs/euraflow/cert.csr \
        -subj "/C=CN/ST=State/L=City/O=EuraFlow/CN=$domain"

    # 生成证书
    openssl x509 -req \
        -days 365 \
        -in /etc/ssl/certs/euraflow/cert.csr \
        -signkey /etc/ssl/certs/euraflow/privkey.pem \
        -out /etc/ssl/certs/euraflow/fullchain.pem

    # 设置权限
    chmod 600 /etc/ssl/certs/euraflow/*.pem

    log_info "自签名证书已生成"
}

# 设置自动续期
setup_auto_renewal() {
    log_info "设置证书自动续期..."

    # 创建续期脚本
    cat > /usr/local/bin/renew-certs.sh << 'EOF'
#!/bin/bash
certbot renew --quiet --no-self-upgrade --post-hook "systemctl reload nginx"
EOF

    chmod +x /usr/local/bin/renew-certs.sh

    # 添加 cron 任务
    cat > /etc/cron.d/certbot << 'EOF'
# 每天凌晨3点检查并续期证书
0 3 * * * root /usr/local/bin/renew-certs.sh >> /var/log/letsencrypt/renew.log 2>&1
EOF

    # 创建 systemd timer（更可靠）
    cat > /etc/systemd/system/certbot-renewal.service << 'EOF'
[Unit]
Description=Certbot Renewal
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --no-self-upgrade --post-hook "systemctl reload nginx"
EOF

    cat > /etc/systemd/system/certbot-renewal.timer << 'EOF'
[Unit]
Description=Twice daily renewal of Let's Encrypt certificates
Documentation=man:certbot(1)

[Timer]
OnCalendar=0/12:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF

    # 启用 timer
    systemctl daemon-reload
    systemctl enable certbot-renewal.timer
    systemctl start certbot-renewal.timer

    log_info "自动续期已设置"
}

# 检查证书状态
check_cert_status() {
    local domain=$1

    log_info "检查证书状态..."

    if [[ -f /etc/letsencrypt/live/$domain/fullchain.pem ]]; then
        # 检查证书有效期
        expiry=$(openssl x509 -enddate -noout -in /etc/letsencrypt/live/$domain/fullchain.pem | cut -d= -f2)
        expiry_epoch=$(date -d "$expiry" +%s)
        current_epoch=$(date +%s)
        days_left=$(( ($expiry_epoch - $current_epoch) / 86400 ))

        if [[ $days_left -lt 30 ]]; then
            log_warn "证书将在 $days_left 天后过期，建议续期"
        else
            log_info "证书有效，还有 $days_left 天到期"
        fi

        # 显示证书信息
        echo -e "\n证书信息："
        openssl x509 -in /etc/letsencrypt/live/$domain/fullchain.pem -noout -subject -issuer -dates
    else
        log_warn "未找到证书文件"
    fi
}

# 备份证书
backup_certs() {
    local domain=$1

    log_info "备份证书..."

    backup_dir="/backup/ssl/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"

    if [[ -d /etc/letsencrypt/live/$domain ]]; then
        cp -r /etc/letsencrypt/live/$domain "$backup_dir/"
        cp -r /etc/letsencrypt/archive/$domain "$backup_dir/" 2>/dev/null || true
        cp /etc/letsencrypt/renewal/$domain.conf "$backup_dir/" 2>/dev/null || true

        # 压缩备份
        tar -czf "$backup_dir.tar.gz" -C "$(dirname $backup_dir)" "$(basename $backup_dir)"
        rm -rf "$backup_dir"

        log_info "证书已备份到 $backup_dir.tar.gz"
    else
        log_warn "未找到要备份的证书"
    fi
}

# 恢复证书
restore_certs() {
    local backup_file=$1

    log_info "恢复证书..."

    if [[ ! -f $backup_file ]]; then
        log_error "备份文件不存在: $backup_file"
    fi

    # 解压备份
    temp_dir="/tmp/cert_restore_$(date +%s)"
    mkdir -p "$temp_dir"
    tar -xzf "$backup_file" -C "$temp_dir"

    # 恢复文件
    cp -r "$temp_dir"/*/* /etc/letsencrypt/ 2>/dev/null || true

    # 清理临时文件
    rm -rf "$temp_dir"

    # 重载 Nginx
    systemctl reload nginx

    log_info "证书已恢复"
}

# 主菜单
show_menu() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════╗"
    echo "║          EuraFlow SSL 证书管理工具               ║"
    echo "╚══════════════════════════════════════════════════╝"
    echo -e "${NC}"
    echo "1. 申请 Let's Encrypt 证书"
    echo "2. 生成自签名证书"
    echo "3. 检查证书状态"
    echo "4. 设置自动续期"
    echo "5. 备份证书"
    echo "6. 恢复证书"
    echo "7. 生成 DH 参数"
    echo "8. 手动续期证书"
    echo "9. 退出"
    echo
}

# 主函数
main() {
    check_root

    # 如果有参数，直接执行
    if [[ $# -gt 0 ]]; then
        case "$1" in
            --letsencrypt)
                install_certbot
                generate_dhparam
                create_ssl_params
                request_letsencrypt "$2" "$3"
                setup_auto_renewal
                check_cert_status "$2"
                ;;
            --self-signed)
                generate_dhparam
                create_ssl_params
                generate_self_signed "$2"
                ;;
            --renew)
                certbot renew
                systemctl reload nginx
                ;;
            --status)
                check_cert_status "$2"
                ;;
            *)
                echo "用法: $0 [选项]"
                echo "  --letsencrypt <domain> <email>  申请 Let's Encrypt 证书"
                echo "  --self-signed <domain>           生成自签名证书"
                echo "  --renew                          续期证书"
                echo "  --status <domain>                检查证书状态"
                exit 1
                ;;
        esac
        exit 0
    fi

    # 交互式菜单
    while true; do
        show_menu
        read -p "请选择操作 [1-9]: " choice

        case $choice in
            1)
                read -p "请输入域名: " domain
                read -p "请输入邮箱: " email
                install_certbot
                generate_dhparam
                create_ssl_params
                request_letsencrypt "$domain" "$email"
                setup_auto_renewal
                check_cert_status "$domain"
                ;;
            2)
                read -p "请输入域名: " domain
                generate_dhparam
                create_ssl_params
                generate_self_signed "$domain"
                ;;
            3)
                read -p "请输入域名: " domain
                check_cert_status "$domain"
                ;;
            4)
                setup_auto_renewal
                ;;
            5)
                read -p "请输入域名: " domain
                backup_certs "$domain"
                ;;
            6)
                read -p "请输入备份文件路径: " backup_file
                restore_certs "$backup_file"
                ;;
            7)
                generate_dhparam
                ;;
            8)
                certbot renew
                systemctl reload nginx
                ;;
            9)
                echo "退出"
                exit 0
                ;;
            *)
                echo "无效选择"
                ;;
        esac

        echo
        read -p "按回车键继续..."
    done
}

# 运行主函数
main "$@"