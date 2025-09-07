#!/bin/bash
# EuraFlow 生产部署脚本

set -e  # 遇到错误立即退出

# 配置
APP_NAME="euraflow"
APP_USER="euraflow"
APP_DIR="/opt/euraflow"
BACKUP_DIR="/opt/backups/euraflow"
PYTHON_VERSION="3.12"

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# 检查运行权限
check_permissions() {
    log_info "检查部署权限..."
    
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本需要 root 权限"
        exit 1
    fi
}

# 检查系统依赖
check_system_deps() {
    log_info "检查系统依赖..."
    
    # 检查必需的命令
    local deps=("git" "python3" "systemctl" "nginx" "postgresql")
    for dep in "${deps[@]}"; do
        if ! command -v "$dep" &> /dev/null; then
            log_error "未找到必需的命令: $dep"
            exit 1
        fi
    done
    
    # 检查 Python 版本
    local python_version=$(python3 --version | grep -oE '[0-9]+\.[0-9]+')
    if [[ $(echo "$python_version >= 3.12" | bc) -eq 0 ]]; then
        log_error "需要 Python 3.12+，当前版本: $python_version"
        exit 1
    fi
    
    log_info "系统依赖检查通过"
}

# 创建应用用户和目录
setup_user_and_dirs() {
    log_info "设置用户和目录..."
    
    # 创建应用用户
    if ! id "$APP_USER" &>/dev/null; then
        useradd -r -s /bin/false -d "$APP_DIR" "$APP_USER"
        log_info "已创建用户: $APP_USER"
    fi
    
    # 创建目录
    mkdir -p "$APP_DIR" "$BACKUP_DIR"
    mkdir -p "$APP_DIR/logs" "$APP_DIR/data" "$APP_DIR/config"
    
    # 设置权限
    chown -R "$APP_USER:$APP_USER" "$APP_DIR"
    chmod 750 "$APP_DIR"
}

# 备份当前版本
backup_current() {
    log_info "备份当前版本..."
    
    if [ -d "$APP_DIR/app" ]; then
        local backup_name="backup_$(date +%Y%m%d_%H%M%S)"
        local backup_path="$BACKUP_DIR/$backup_name"
        
        mkdir -p "$backup_path"
        cp -r "$APP_DIR/app" "$backup_path/"
        cp "$APP_DIR/.env" "$backup_path/" 2>/dev/null || true
        
        log_info "已备份到: $backup_path"
        
        # 保留最近5个备份
        cd "$BACKUP_DIR" && ls -t | tail -n +6 | xargs -r rm -rf
    fi
}

# 部署代码
deploy_code() {
    log_info "部署应用代码..."
    
    # 停止服务
    systemctl stop ef-api ef-worker ef-scheduler 2>/dev/null || true
    
    # 部署代码（假设代码已通过 Git 或其他方式上传到 /tmp/euraflow-deploy/）
    if [ -d "/tmp/euraflow-deploy" ]; then
        rm -rf "$APP_DIR/app"
        cp -r "/tmp/euraflow-deploy" "$APP_DIR/app"
        chown -R "$APP_USER:$APP_USER" "$APP_DIR/app"
    else
        log_error "部署源码目录不存在: /tmp/euraflow-deploy"
        exit 1
    fi
}

# 安装 Python 依赖
install_dependencies() {
    log_info "安装 Python 依赖..."
    
    cd "$APP_DIR/app"
    
    # 创建虚拟环境
    if [ ! -d "venv" ]; then
        sudo -u "$APP_USER" python3 -m venv venv
    fi
    
    # 安装依赖
    sudo -u "$APP_USER" venv/bin/pip install --upgrade pip
    sudo -u "$APP_USER" venv/bin/pip install -r requirements.txt
}

# 配置环境变量
setup_config() {
    log_info "配置环境变量..."
    
    local env_file="$APP_DIR/.env"
    
    if [ ! -f "$env_file" ]; then
        log_warn ".env 文件不存在，创建默认配置"
        
        cat > "$env_file" << EOF
# EuraFlow 生产环境配置
EF__DB_HOST=localhost
EF__DB_PORT=5432
EF__DB_NAME=euraflow
EF__DB_USER=euraflow
EF__DB_PASSWORD=请修改密码

EF__REDIS_HOST=localhost
EF__REDIS_PORT=6379
EF__REDIS_PASSWORD=

EF__API_HOST=127.0.0.1
EF__API_PORT=8000
EF__API_DEBUG=false

EF__SECRET_KEY=$(openssl rand -hex 32)

EF__LOG_LEVEL=INFO
EF__LOG_FORMAT=json
EOF
        
        chown "$APP_USER:$APP_USER" "$env_file"
        chmod 600 "$env_file"
        
        log_warn "请编辑 $env_file 配置正确的数据库密码"
    fi
}

# 数据库迁移
run_migrations() {
    log_info "运行数据库迁移..."
    
    cd "$APP_DIR/app"
    sudo -u "$APP_USER" venv/bin/alembic upgrade head
}

# 配置 systemd 服务
setup_systemd_services() {
    log_info "配置 systemd 服务..."
    
    # API 服务
    cat > /etc/systemd/system/ef-api.service << EOF
[Unit]
Description=EuraFlow API Server
After=network.target postgresql.service redis.service
Requires=postgresql.service redis.service

[Service]
Type=exec
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/app
Environment=PATH=$APP_DIR/app/venv/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/app/venv/bin/python -m ef_core.app
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全设置
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    # Worker 服务
    cat > /etc/systemd/system/ef-worker.service << EOF
[Unit]
Description=EuraFlow Celery Worker
After=network.target postgresql.service redis.service
Requires=postgresql.service redis.service

[Service]
Type=exec
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/app
Environment=PATH=$APP_DIR/app/venv/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/app/venv/bin/celery -A ef_core.tasks.celery_app worker --loglevel=info --concurrency=4
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全设置
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    # Scheduler 服务
    cat > /etc/systemd/system/ef-scheduler.service << EOF
[Unit]
Description=EuraFlow Celery Beat Scheduler
After=network.target postgresql.service redis.service
Requires=postgresql.service redis.service

[Service]
Type=exec
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR/app
Environment=PATH=$APP_DIR/app/venv/bin
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/app/venv/bin/celery -A ef_core.tasks.celery_app beat --loglevel=info
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

# 安全设置
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$APP_DIR
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    # 重新加载 systemd
    systemctl daemon-reload
    
    # 启用服务
    systemctl enable ef-api ef-worker ef-scheduler
}

# 配置 Nginx
setup_nginx() {
    log_info "配置 Nginx..."
    
    cat > /etc/nginx/sites-available/euraflow << EOF
server {
    listen 80;
    server_name _;
    
    # 安全头
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    
    # API 代理
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        # 超时设置
        proxy_connect_timeout 30s;
        proxy_send_timeout 30s;
        proxy_read_timeout 30s;
    }
    
    # 健康检查
    location /healthz {
        proxy_pass http://127.0.0.1:8000;
    }
    
    # 静态文件（如果有）
    location /static/ {
        alias $APP_DIR/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    
    # 默认响应
    location / {
        return 404;
    }
}
EOF

    # 启用站点
    ln -sf /etc/nginx/sites-available/euraflow /etc/nginx/sites-enabled/
    
    # 测试 nginx 配置
    nginx -t
    
    # 重新加载 nginx
    systemctl reload nginx
}

# 启动服务
start_services() {
    log_info "启动服务..."
    
    systemctl start ef-api ef-worker ef-scheduler
    
    # 等待服务启动
    sleep 5
    
    # 检查服务状态
    local failed_services=()
    for service in ef-api ef-worker ef-scheduler; do
        if ! systemctl is-active --quiet "$service"; then
            failed_services+=("$service")
        fi
    done
    
    if [ ${#failed_services[@]} -gt 0 ]; then
        log_error "以下服务启动失败: ${failed_services[*]}"
        for service in "${failed_services[@]}"; do
            log_error "$service 日志:"
            journalctl -u "$service" -n 10 --no-pager
        done
        exit 1
    fi
    
    log_info "所有服务启动成功"
}

# 健康检查
health_check() {
    log_info "执行健康检查..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -f -s http://localhost:8000/healthz > /dev/null; then
            log_info "健康检查通过"
            return 0
        fi
        
        log_warn "健康检查失败，重试 $attempt/$max_attempts"
        sleep 2
        ((attempt++))
    done
    
    log_error "健康检查失败"
    return 1
}

# 主函数
main() {
    log_info "开始部署 EuraFlow..."
    
    check_permissions
    check_system_deps
    setup_user_and_dirs
    backup_current
    deploy_code
    install_dependencies
    setup_config
    run_migrations
    setup_systemd_services
    setup_nginx
    start_services
    
    if health_check; then
        log_info "🎉 EuraFlow 部署成功!"
        log_info "API 地址: http://localhost/api/ef/v1/"
        log_info "健康检查: http://localhost/healthz"
    else
        log_error "❌ 部署完成但健康检查失败"
        exit 1
    fi
}

# 脚本参数处理
case "${1:-deploy}" in
    "deploy")
        main
        ;;
    "rollback")
        log_info "执行回滚..."
        # TODO: 实现回滚逻辑
        log_warn "回滚功能尚未实现"
        ;;
    "status")
        log_info "服务状态:"
        systemctl status ef-api ef-worker ef-scheduler --no-pager
        ;;
    *)
        echo "用法: $0 [deploy|rollback|status]"
        exit 1
        ;;
esac