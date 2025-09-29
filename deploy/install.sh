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

    # 等待PostgreSQL完全启动
    sleep 3

    # 配置PostgreSQL允许密码认证
    PG_HBA_FILE="/etc/postgresql/${POSTGRES_VERSION}/main/pg_hba.conf"
    if [[ -f "$PG_HBA_FILE" ]]; then
        # 备份原始配置
        cp "$PG_HBA_FILE" "${PG_HBA_FILE}.backup"

        # 确保本地连接允许密码认证
        sed -i 's/^local.*all.*all.*peer$/local   all             all                                     md5/' "$PG_HBA_FILE"
        sed -i 's/^host.*all.*all.*127.0.0.1\/32.*ident$/host    all             all             127.0.0.1\/32            md5/' "$PG_HBA_FILE"

        # 重新加载PostgreSQL配置
        systemctl reload postgresql
        sleep 2
    fi

    # 创建数据库和用户
    log_info "创建数据库用户和数据库..."
    sudo -u postgres psql << EOF
-- 删除用户和数据库（如果存在）
DROP DATABASE IF EXISTS euraflow;
DROP USER IF EXISTS euraflow;

-- 创建新用户和数据库
CREATE USER euraflow WITH PASSWORD '$DB_PASSWORD';
ALTER USER euraflow CREATEDB;
CREATE DATABASE euraflow OWNER euraflow;

-- 连接到euraflow数据库设置权限
\c euraflow;
GRANT ALL PRIVILEGES ON DATABASE euraflow TO euraflow;
GRANT ALL PRIVILEGES ON SCHEMA public TO euraflow;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO euraflow;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO euraflow;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO euraflow;

-- 设置默认权限
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO euraflow;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO euraflow;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO euraflow;
EOF

    # 验证数据库连接
    log_info "验证数据库连接..."
    if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U euraflow -d euraflow -c "SELECT version();" -t -q > /dev/null 2>&1; then
        log_info "数据库连接验证成功"
    else
        log_error "数据库连接验证失败，请检查密码和权限设置"
    fi

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

    # 删除旧的虚拟环境（如果存在）
    if [[ -d "venv" ]]; then
        log_info "删除现有虚拟环境..."
        rm -rf venv
    fi

    # 创建虚拟环境
    log_info "创建Python虚拟环境..."
    if sudo -u $USER python3.12 -m venv venv; then
        log_info "虚拟环境创建成功"
    else
        log_error "虚拟环境创建失败"
    fi

    chown -R $USER:$GROUP venv

    # 激活虚拟环境并安装依赖
    log_info "安装Python包管理工具..."
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && python -m ensurepip --upgrade" || log_error "ensurepip失败"

    log_info "升级pip..."
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && python -m pip install --upgrade pip" || log_error "pip升级失败"

    log_info "安装基础包..."
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && pip install --upgrade setuptools>=68.0.0 wheel" || log_error "setuptools安装失败"

    log_info "安装项目依赖..."
    if sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && pip install -r requirements.txt"; then
        log_info "项目依赖安装成功"
    else
        log_error "项目依赖安装失败"
    fi

    log_info "安装生产环境额外依赖..."
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && pip install gunicorn" || log_error "gunicorn安装失败"

    log_success "Python环境设置完成"
}

# 设置前端环境
setup_frontend() {
    log_info "设置前端环境..."

    cd $INSTALL_DIR/web

    # 跳过prepare脚本安装依赖（生产环境不需要husky）
    sudo -u $USER npm install --ignore-scripts

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

# 数据库配置（使用分离的字段名）
EF__DB_HOST=localhost
EF__DB_PORT=5432
EF__DB_NAME=euraflow
EF__DB_USER=euraflow
EF__DB_PASSWORD=${DB_PASSWORD}
EF__DB_POOL_SIZE=20
EF__DB_MAX_OVERFLOW=40

# Redis配置
EF__REDIS_HOST=localhost
EF__REDIS_PORT=6379
EF__REDIS_DB=0
EF__REDIS_PASSWORD=

# API配置
EF__API_HOST=0.0.0.0
EF__API_PORT=8000
EF__API_PREFIX=/api/ef/v1
EF__API_TITLE=EuraFlow API
EF__API_VERSION=1.0.0
EF__API_DEBUG=false

# 日志配置
EF__LOG_LEVEL=INFO
EF__LOG_FORMAT=json

# 安全配置
EF__ACCESS_TOKEN_EXPIRE_MINUTES=30
EF__ALGORITHM=HS256

# Celery配置
EF__CELERY_BROKER_URL=redis://localhost:6379/0
EF__CELERY_RESULT_BACKEND=redis://localhost:6379/1
EF__CELERY_TASK_DEFAULT_QUEUE=ef_default
EF__CELERY_TASK_SERIALIZER=json
EF__CELERY_RESULT_SERIALIZER=json
EF__CELERY_TIMEZONE=UTC

# 监控配置
EF__METRICS_ENABLED=true
EF__METRICS_PREFIX=ef
EF__TRACE_ENABLED=true

# 插件配置
EF__PLUGIN_DIR=plugins
EF__PLUGIN_AUTO_LOAD=true
EF__PLUGIN_CONFIG_FILE=plugin.json

# 限流配置
EF__RATE_LIMIT_ENABLED=true
EF__RATE_LIMIT_DEFAULT=60/minute

# 守护阈值
EF__INVENTORY_DEFAULT_THRESHOLD=5
EF__PRICE_MIN_MARGIN=0.2
EOF

    chown $USER:$GROUP $INSTALL_DIR/.env
    chmod 600 $INSTALL_DIR/.env

    log_success "环境变量配置完成"
}

# 初始化数据库
init_database() {
    log_info "初始化数据库..."

    cd $INSTALL_DIR

    # 验证.env文件存在和权限
    if [[ ! -f ".env" ]]; then
        log_error ".env文件不存在"
    fi

    # 确保文件权限正确
    chown $USER:$GROUP $INSTALL_DIR/.env
    chmod 640 $INSTALL_DIR/.env

    # 确保目录权限正确
    chown -R $USER:$GROUP $INSTALL_DIR

    # 测试数据库连接（简化版本）
    log_info "测试应用数据库连接..."
    if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U euraflow -d euraflow -c "SELECT 1;" -t -q > /dev/null 2>&1; then
        log_info "应用数据库连接验证成功"
    else
        log_warn "直接数据库连接测试失败，继续进行应用层测试..."
    fi

    # 验证环境变量配置是否正确加载
    log_info "验证环境变量配置..."
    sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && python -c \"
from ef_core.config import get_settings
settings = get_settings()
print(f'Database URL: {settings.sync_database_url}')
print(f'Database Config: host={settings.db_host}, user={settings.db_user}, db={settings.db_name}')
\"" || {
        log_error "环境变量配置验证失败"
    }

    # 运行数据库迁移
    log_info "运行数据库迁移..."
    if sudo -u $USER bash -c "cd $INSTALL_DIR && source venv/bin/activate && alembic upgrade head"; then
        log_info "数据库迁移成功完成"
    else
        log_error "数据库迁移失败"
    fi

    log_success "数据库初始化完成"
}

# 配置Nginx
setup_nginx() {
    log_info "配置Nginx..."

    # 先创建HTTP-only配置（用于Let's Encrypt验证）
    cat > /etc/nginx/sites-available/euraflow << EOF
# HTTP配置（初始配置，用于SSL证书申请）
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN_NAME};

    # Let's Encrypt验证目录
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

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
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml application/vnd.ms-fontobject application/x-font-ttf font/opentype;

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

    # 静态文件
    location /static {
        alias ${INSTALL_DIR}/web/dist;
        expires 30d;
        add_header Cache-Control "public, immutable";
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
    if nginx -t; then
        log_success "Nginx配置语法检查通过"
    else
        log_error "Nginx配置语法错误，请检查配置"
    fi

    log_success "Nginx配置完成"
}

# 配置SSL证书
setup_ssl() {
    log_info "配置SSL证书..."

    # 创建证书目录
    mkdir -p /var/www/certbot

    # 重启Nginx以应用HTTP配置
    systemctl restart nginx

    # 申请Let's Encrypt证书（使用webroot方式，避免nginx插件自动修改配置）
    log_info "申请SSL证书..."
    if certbot certonly --webroot -w /var/www/certbot -d ${DOMAIN_NAME} --non-interactive --agree-tos --email ${EMAIL}; then
        log_info "SSL证书申请成功，更新Nginx配置..."

        # 证书申请成功后，创建包含HTTPS的完整配置
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

    # SSL证书
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
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml application/vnd.ms-fontobject application/x-font-ttf font/opentype;

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

    # 静态文件
    location /static {
        alias ${INSTALL_DIR}/web/dist;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 前端应用
    location / {
        root ${INSTALL_DIR}/web/dist;
        try_files \$uri \$uri/ /index.html;
    }
}
EOF

        # 重新加载Nginx配置
        nginx -t && systemctl reload nginx
        log_success "HTTPS配置已启用"
    else
        log_warn "SSL证书申请失败，继续使用HTTP"
    fi

    # 设置自动更新
    cat > /etc/cron.d/certbot << EOF
0 0,12 * * * root certbot renew --quiet && systemctl reload nginx
EOF

    log_success "SSL证书配置完成"
}

# 配置项目级启动脚本
setup_supervisor() {
    log_info "配置项目级管理脚本..."

    # 确保脚本有执行权限
    chmod +x ${INSTALL_DIR}/start.sh
    chmod +x ${INSTALL_DIR}/stop.sh
    chmod +x ${INSTALL_DIR}/restart.sh
    chmod +x ${INSTALL_DIR}/status.sh

    # 设置脚本所有者
    chown $USER:$GROUP ${INSTALL_DIR}/start.sh
    chown $USER:$GROUP ${INSTALL_DIR}/stop.sh
    chown $USER:$GROUP ${INSTALL_DIR}/restart.sh
    chown $USER:$GROUP ${INSTALL_DIR}/status.sh

    log_success "项目管理脚本配置完成"
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

    # 使用项目级启动脚本启动EuraFlow服务
    log_info "启动EuraFlow服务（使用项目级supervisor）..."
    cd ${INSTALL_DIR}
    sudo -u $USER bash -c "cd ${INSTALL_DIR} && ./start.sh"

    # 等待服务启动
    sleep 5

    # 检查服务状态
    log_info "检查服务状态..."
    sudo -u $USER bash -c "cd ${INSTALL_DIR} && ./status.sh"

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
supervisorctl stop euraflow:*

# 备份当前版本
./deploy/scripts/backup.sh

# 更新代码
git pull origin master

# 更新Python依赖
source venv/bin/activate
pip install -r requirements.txt

# 更新前端
cd web
npm install --ignore-scripts
npm run build
cd ..

# 运行数据库迁移
alembic upgrade head

# 重启服务
supervisorctl restart euraflow:*

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

    echo -e "${BLUE}服务管理（Supervisor）：${NC}"
    echo "  启动所有服务: supervisorctl start euraflow:*"
    echo "  停止所有服务: supervisorctl stop euraflow:*"
    echo "  重启所有服务: supervisorctl restart euraflow:*"
    echo "  查看状态: supervisorctl status"
    echo "  Web管理界面: http://127.0.0.1:9001 (用户名: admin)"
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
    setup_supervisor
    setup_firewall
    start_services
    create_backup_script
    create_update_script
    show_info

    log_success "EuraFlow 部署完成！"
}

# 运行主函数
main "$@"