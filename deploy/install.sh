#!/bin/bash

#===============================================================================
# EuraFlow 一键部署脚本
# 适用于 Ubuntu 22.04 LTS / 24.04 LTS
#
# 使用方法:
#   curl -sSL https://example.com/install.sh | sudo bash
#   或
#   sudo ./install.sh
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
INSTALL_DIR="/opt/euraflow"
USER="euraflow"
GROUP="euraflow"
PYTHON_VERSION="3.12"
NODE_VERSION="20"
POSTGRES_VERSION="15"
GITHUB_REPO="https://github.com/your-org/EuraFlow.git"
BRANCH="master"

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
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║     _____ _   _ ____      _     _____ _     _____        __ ║
║    | ____| | | |  _ \    / \   |  ___| |   / _ \ \      / / ║
║    |  _| | | | | |_) |  / _ \  | |_  | |  | | | \ \ /\ / /  ║
║    | |___| |_| |  _ <  / ___ \ |  _| | |__| |_| |\ V  V /   ║
║    |_____|\___/|_| \_\/_/   \_\|_|   |_____\___/  \_/\_/    ║
║                                                              ║
║                   外网部署一键安装脚本 v1.0                  ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 检查系统要求
check_system() {
    log_info "检查系统要求..."

    # 检查是否为Ubuntu
    if [[ ! -f /etc/lsb-release ]] || ! grep -q "Ubuntu" /etc/lsb-release; then
        log_error "此脚本仅支持 Ubuntu 22.04 或 24.04"
    fi

    # 检查Ubuntu版本
    UBUNTU_VERSION=$(lsb_release -rs)
    if [[ "$UBUNTU_VERSION" != "22.04" ]] && [[ "$UBUNTU_VERSION" != "24.04" ]]; then
        log_warn "检测到 Ubuntu $UBUNTU_VERSION，建议使用 22.04 或 24.04"
    fi

    # 检查是否为root用户
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本必须以 root 权限运行"
    fi

    # 检查内存
    TOTAL_MEM=$(free -m | awk 'NR==2{print $2}')
    if [[ $TOTAL_MEM -lt 2048 ]]; then
        log_warn "系统内存少于 2GB，可能影响性能"
    fi

    # 检查磁盘空间
    AVAILABLE_SPACE=$(df / | awk 'NR==2{print $4}')
    if [[ $AVAILABLE_SPACE -lt 10485760 ]]; then
        log_error "可用磁盘空间少于 10GB"
    fi

    log_success "系统检查通过"
}

# 收集配置信息
collect_config() {
    log_info "收集配置信息..."

    # 域名配置
    read -p "请输入您的域名（例如: api.example.com）: " DOMAIN_NAME
    if [[ -z "$DOMAIN_NAME" ]]; then
        log_error "域名不能为空"
    fi

    # 邮箱配置（用于Let's Encrypt）
    read -p "请输入您的邮箱（用于SSL证书）: " EMAIL
    if [[ -z "$EMAIL" ]]; then
        log_error "邮箱不能为空"
    fi

    # 数据库密码
    read -sp "请设置PostgreSQL密码: " DB_PASSWORD
    echo
    if [[ -z "$DB_PASSWORD" ]]; then
        DB_PASSWORD=$(openssl rand -base64 32)
        log_warn "未设置密码，自动生成: $DB_PASSWORD"
    fi

    # Git仓库配置
    read -p "请输入Git仓库地址 (默认: $GITHUB_REPO): " CUSTOM_REPO
    if [[ ! -z "$CUSTOM_REPO" ]]; then
        GITHUB_REPO="$CUSTOM_REPO"
    fi

    log_success "配置信息收集完成"
}

# 更新系统
update_system() {
    log_info "更新系统包..."

    apt-get update
    apt-get upgrade -y
    apt-get install -y \
        curl \
        wget \
        git \
        build-essential \
        software-properties-common \
        apt-transport-https \
        ca-certificates \
        gnupg \
        lsb-release \
        ufw \
        htop \
        supervisor \
        redis-server \
        nginx \
        certbot \
        python3-certbot-nginx

    log_success "系统更新完成"
}

# 安装Python 3.12
install_python() {
    log_info "安装 Python $PYTHON_VERSION..."

    # 检查Python版本
    if command -v python3.12 &> /dev/null; then
        log_info "Python 3.12 已安装"
    else
        add-apt-repository ppa:deadsnakes/ppa -y
        apt-get update
        apt-get install -y \
            python3.12 \
            python3.12-venv \
            python3.12-dev \
            python3-pip
    fi

    # 设置Python 3.12为默认
    update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1

    log_success "Python $PYTHON_VERSION 安装完成"
}

# 安装Node.js
install_nodejs() {
    log_info "安装 Node.js $NODE_VERSION..."

    if command -v node &> /dev/null; then
        NODE_INSTALLED_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [[ "$NODE_INSTALLED_VERSION" -ge "$NODE_VERSION" ]]; then
            log_info "Node.js $NODE_VERSION+ 已安装"
            return
        fi
    fi

    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
    apt-get install -y nodejs

    # 安装yarn和pm2
    npm install -g yarn pm2

    log_success "Node.js $NODE_VERSION 安装完成"
}

# 安装PostgreSQL
install_postgresql() {
    log_info "安装 PostgreSQL $POSTGRES_VERSION..."

    if command -v psql &> /dev/null; then
        log_info "PostgreSQL 已安装"
    else
        # 添加PostgreSQL官方仓库
        echo "deb https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
        wget --quiet -O - https://www.postgresql.org/media/keys/ACCC4CF8.asc | apt-key add -
        apt-get update
        apt-get install -y postgresql-${POSTGRES_VERSION} postgresql-contrib-${POSTGRES_VERSION}
    fi

    # 启动PostgreSQL
    systemctl start postgresql
    systemctl enable postgresql

    # 创建数据库和用户
    sudo -u postgres psql << EOF
CREATE USER euraflow WITH PASSWORD '$DB_PASSWORD';
CREATE DATABASE euraflow OWNER euraflow;
GRANT ALL PRIVILEGES ON DATABASE euraflow TO euraflow;
EOF

    log_success "PostgreSQL $POSTGRES_VERSION 安装完成"
}

# 创建系统用户
create_user() {
    log_info "创建系统用户..."

    if id "$USER" &>/dev/null; then
        log_info "用户 $USER 已存在"
    else
        useradd -m -s /bin/bash $USER
        usermod -aG sudo $USER
    fi

    # 创建必要的目录
    mkdir -p $INSTALL_DIR
    mkdir -p /var/log/euraflow
    mkdir -p /var/run/euraflow

    chown -R $USER:$GROUP $INSTALL_DIR
    chown -R $USER:$GROUP /var/log/euraflow
    chown -R $USER:$GROUP /var/run/euraflow

    log_success "用户创建完成"
}

# 克隆项目
clone_project() {
    log_info "克隆项目代码..."

    cd /opt

    if [[ -d "$INSTALL_DIR/.git" ]]; then
        log_info "项目已存在，更新代码..."
        cd $INSTALL_DIR
        sudo -u $USER git pull origin $BRANCH
    else
        sudo -u $USER git clone -b $BRANCH $GITHUB_REPO $INSTALL_DIR
    fi

    cd $INSTALL_DIR

    log_success "项目克隆完成"
}

# 设置Python环境
setup_python_env() {
    log_info "设置Python虚拟环境..."

    cd $INSTALL_DIR

    # 确保venv包已安装
    apt-get install -y python3.12-venv

    # 创建虚拟环境
    python3.12 -m venv venv
    chown -R $USER:$GROUP venv

    # 激活虚拟环境并安装依赖
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && python -m ensurepip --upgrade"
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && python -m pip install --upgrade pip setuptools wheel"
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && pip install -r requirements.txt"

    log_success "Python环境设置完成"
}

# 设置前端环境
setup_frontend() {
    log_info "设置前端环境..."

    cd $INSTALL_DIR/web

    # 安装依赖
    sudo -u $USER npm install

    # 构建前端
    sudo -u $USER npm run build

    log_success "前端环境设置完成"
}

# 配置环境变量
setup_env() {
    log_info "配置环境变量..."

    cat > $INSTALL_DIR/.env << EOF
# 基础配置
EF__ENV=production
EF__DEBUG=false
EF__SECRET_KEY=$(openssl rand -hex 32)

# 数据库配置
EF__DATABASE__URL=postgresql://euraflow:${DB_PASSWORD}@localhost:5432/euraflow
EF__DATABASE__POOL_SIZE=20
EF__DATABASE__MAX_OVERFLOW=40

# Redis配置
EF__REDIS__URL=redis://localhost:6379/0
EF__CACHE__TTL=3600

# 服务配置
EF__API__HOST=0.0.0.0
EF__API__PORT=8000
EF__API__WORKERS=4
EF__API__BASE_URL=https://${DOMAIN_NAME}

# 日志配置
EF__LOG__LEVEL=INFO
EF__LOG__FILE=/var/log/euraflow/app.log

# CORS配置
EF__CORS__ORIGINS=["https://${DOMAIN_NAME}"]
EF__CORS__CREDENTIALS=true

# 会话配置
EF__SESSION__SECRET=$(openssl rand -hex 32)
EF__SESSION__EXPIRE=86400
EOF

    chown $USER:$GROUP $INSTALL_DIR/.env
    chmod 600 $INSTALL_DIR/.env

    log_success "环境变量配置完成"
}

# 初始化数据库
init_database() {
    log_info "初始化数据库..."

    cd $INSTALL_DIR

    # 运行数据库迁移
    sudo -u $USER bash -c "source venv/bin/activate && alembic upgrade head"

    log_success "数据库初始化完成"
}

# 配置Nginx
setup_nginx() {
    log_info "配置Nginx..."

    # 生成Nginx配置
    cat > /etc/nginx/sites-available/euraflow << EOF
# HTTP重定向到HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_NAME};

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

# HTTPS配置
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${DOMAIN_NAME};

    # SSL证书（稍后由certbot配置）
    ssl_certificate /etc/letsencrypt/live/${DOMAIN_NAME}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN_NAME}/privkey.pem;

    # SSL配置
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;

    # 日志
    access_log /var/log/nginx/euraflow_access.log;
    error_log /var/log/nginx/euraflow_error.log;

    # 客户端上传限制
    client_max_body_size 50M;
    client_body_timeout 60s;

    # Gzip压缩
    gzip on;
    gzip_vary on;
    gzip_comp_level 4;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml text/javascript application/vnd.ms-fontobject application/x-font-ttf font/opentype;

    # 静态文件
    location /static {
        alias ${INSTALL_DIR}/web/dist;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # API代理
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket支持
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # 前端应用
    location / {
        root ${INSTALL_DIR}/web/dist;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

    # 启用站点
    ln -sf /etc/nginx/sites-available/euraflow /etc/nginx/sites-enabled/
    rm -f /etc/nginx/sites-enabled/default

    # 测试Nginx配置
    nginx -t

    log_success "Nginx配置完成"
}

# 配置SSL证书
setup_ssl() {
    log_info "配置SSL证书..."

    # 创建证书目录
    mkdir -p /var/www/certbot

    # 重启Nginx以应用HTTP配置
    systemctl restart nginx

    # 申请Let's Encrypt证书
    certbot --nginx -d ${DOMAIN_NAME} --non-interactive --agree-tos --email ${EMAIL} --redirect

    # 设置自动更新
    cat > /etc/cron.d/certbot << EOF
0 0,12 * * * root certbot renew --quiet && systemctl reload nginx
EOF

    log_success "SSL证书配置完成"
}

# 配置systemd服务
setup_systemd() {
    log_info "配置systemd服务..."

    # 后端服务
    cat > /etc/systemd/system/euraflow-backend.service << EOF
[Unit]
Description=EuraFlow Backend Service
After=network.target postgresql.service redis.service
Requires=postgresql.service redis.service

[Service]
Type=forking
User=${USER}
Group=${GROUP}
WorkingDirectory=${INSTALL_DIR}
Environment="PATH=${INSTALL_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=${INSTALL_DIR}/venv/bin/gunicorn ef_core.app:app \
    --bind 0.0.0.0:8000 \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --daemon \
    --pid /var/run/euraflow/backend.pid \
    --access-logfile /var/log/euraflow/access.log \
    --error-logfile /var/log/euraflow/error.log
ExecReload=/bin/kill -s HUP \$MAINPID
ExecStop=/bin/kill -s TERM \$MAINPID
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

    # 任务处理器服务
    cat > /etc/systemd/system/euraflow-worker.service << EOF
[Unit]
Description=EuraFlow Worker Service
After=network.target postgresql.service redis.service euraflow-backend.service
Requires=postgresql.service redis.service

[Service]
Type=simple
User=${USER}
Group=${GROUP}
WorkingDirectory=${INSTALL_DIR}
Environment="PATH=${INSTALL_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=${INSTALL_DIR}/venv/bin/python -m plugins.ef.channels.ozon.services.watermark_task_runner
Restart=always
RestartSec=10
StandardOutput=append:/var/log/euraflow/worker.log
StandardError=append:/var/log/euraflow/worker-error.log

[Install]
WantedBy=multi-user.target
EOF

    # 竞品数据处理器服务
    cat > /etc/systemd/system/euraflow-competitor.service << EOF
[Unit]
Description=EuraFlow Competitor Service
After=network.target postgresql.service redis.service euraflow-backend.service
Requires=postgresql.service redis.service

[Service]
Type=simple
User=${USER}
Group=${GROUP}
WorkingDirectory=${INSTALL_DIR}
Environment="PATH=${INSTALL_DIR}/venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
ExecStart=${INSTALL_DIR}/venv/bin/python -m plugins.ef.channels.ozon.services.competitor_task_runner
Restart=always
RestartSec=10
StandardOutput=append:/var/log/euraflow/competitor.log
StandardError=append:/var/log/euraflow/competitor-error.log

[Install]
WantedBy=multi-user.target
EOF

    # 重载systemd配置
    systemctl daemon-reload

    # 启用服务
    systemctl enable euraflow-backend
    systemctl enable euraflow-worker
    systemctl enable euraflow-competitor

    log_success "systemd服务配置完成"
}

# 配置防火墙
setup_firewall() {
    log_info "配置防火墙..."

    # 允许SSH
    ufw allow 22/tcp

    # 允许HTTP和HTTPS
    ufw allow 80/tcp
    ufw allow 443/tcp

    # 启用防火墙
    echo "y" | ufw enable

    log_success "防火墙配置完成"
}

# 启动服务
start_services() {
    log_info "启动所有服务..."

    # 启动Redis
    systemctl start redis-server
    systemctl enable redis-server

    # 启动Nginx
    systemctl start nginx
    systemctl enable nginx

    # 启动EuraFlow服务
    systemctl start euraflow-backend
    systemctl start euraflow-worker
    systemctl start euraflow-competitor

    # 等待服务启动
    sleep 5

    # 检查服务状态
    systemctl status euraflow-backend --no-pager || true
    systemctl status euraflow-worker --no-pager || true
    systemctl status euraflow-competitor --no-pager || true

    log_success "所有服务已启动"
}

# 创建备份脚本
create_backup_script() {
    log_info "创建备份脚本..."

    cat > ${INSTALL_DIR}/deploy/scripts/backup.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/backup/euraflow"
DATE=$(date +%Y%m%d_%H%M%S)
DB_NAME="euraflow"

mkdir -p ${BACKUP_DIR}/{db,files}

# 备份数据库
pg_dump -U euraflow ${DB_NAME} | gzip > ${BACKUP_DIR}/db/euraflow_${DATE}.sql.gz

# 备份文件
tar czf ${BACKUP_DIR}/files/euraflow_files_${DATE}.tar.gz -C /opt/euraflow .env uploads/

# 删除7天前的备份
find ${BACKUP_DIR} -type f -mtime +7 -delete

echo "Backup completed: ${DATE}"
EOF

    chmod +x ${INSTALL_DIR}/deploy/scripts/backup.sh

    # 添加cron任务
    echo "0 2 * * * ${USER} ${INSTALL_DIR}/deploy/scripts/backup.sh" > /etc/cron.d/euraflow-backup

    log_success "备份脚本创建完成"
}

# 创建更新脚本
create_update_script() {
    log_info "创建更新脚本..."

    cat > ${INSTALL_DIR}/deploy/scripts/update.sh << 'EOF'
#!/bin/bash
cd /opt/euraflow

# 停止服务
systemctl stop euraflow-backend euraflow-worker euraflow-competitor

# 备份当前版本
./deploy/scripts/backup.sh

# 更新代码
git pull origin master

# 更新Python依赖
source venv/bin/activate
pip install -r requirements.txt

# 更新前端
cd web
npm install
npm run build
cd ..

# 运行数据库迁移
alembic upgrade head

# 重启服务
systemctl start euraflow-backend euraflow-worker euraflow-competitor

echo "Update completed"
EOF

    chmod +x ${INSTALL_DIR}/deploy/scripts/update.sh

    log_success "更新脚本创建完成"
}

# 显示安装信息
show_info() {
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                    安装完成！                                ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"

    echo -e "${BLUE}访问信息：${NC}"
    echo "  网址: https://${DOMAIN_NAME}"
    echo "  API文档: https://${DOMAIN_NAME}/api/docs"
    echo ""

    echo -e "${BLUE}数据库信息：${NC}"
    echo "  主机: localhost"
    echo "  端口: 5432"
    echo "  数据库: euraflow"
    echo "  用户: euraflow"
    echo "  密码: ${DB_PASSWORD}"
    echo ""

    echo -e "${BLUE}服务管理：${NC}"
    echo "  启动服务: systemctl start euraflow-backend"
    echo "  停止服务: systemctl stop euraflow-backend"
    echo "  重启服务: systemctl restart euraflow-backend"
    echo "  查看状态: systemctl status euraflow-backend"
    echo ""

    echo -e "${BLUE}日志位置：${NC}"
    echo "  应用日志: /var/log/euraflow/"
    echo "  Nginx日志: /var/log/nginx/"
    echo ""

    echo -e "${BLUE}维护脚本：${NC}"
    echo "  更新: ${INSTALL_DIR}/deploy/scripts/update.sh"
    echo "  备份: ${INSTALL_DIR}/deploy/scripts/backup.sh"
    echo ""

    echo -e "${YELLOW}重要提示：${NC}"
    echo "  1. 请妥善保管数据库密码"
    echo "  2. 建议设置定期备份"
    echo "  3. SSL证书将自动续期"
    echo "  4. 配置文件: ${INSTALL_DIR}/.env"
}

# 主函数
main() {
    print_banner
    check_system
    collect_config
    update_system
    install_python
    install_nodejs
    install_postgresql
    create_user
    clone_project
    setup_python_env
    setup_frontend
    setup_env
    init_database
    setup_nginx
    setup_ssl
    setup_systemd
    setup_firewall
    start_services
    create_backup_script
    create_update_script
    show_info

    log_success "EuraFlow 部署完成！"
}

# 运行主函数
main "$@"