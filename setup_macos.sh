#!/bin/bash

#===============================================================================
# EuraFlow macOS 开发环境配置脚本
# 适用于 macOS (Homebrew 环境)
#
# 使用方法:
#   ./setup_macos.sh
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置变量
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_NAME="euraflow"
PYTHON_VERSION="3.12"
DB_NAME="euraflow"
DB_USER="euraflow"
DB_PASSWORD="${EF__DB_PASSWORD:-euraflow_dev}"

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
║                   macOS 开发环境配置脚本 v1.0                ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 检查系统要求
check_system() {
    log_info "检查系统要求..."

    # 检查是否为macOS
    if [[ "$(uname)" != "Darwin" ]]; then
        log_error "此脚本仅支持 macOS 系统"
    fi

    # 检查Homebrew
    if ! command -v brew &> /dev/null; then
        log_error "Homebrew 未安装，请先安装: /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
    fi

    log_success "系统检查通过"
}

# 检查并启动服务
check_services() {
    log_info "检查必需的服务..."

    # 检查PostgreSQL
    if ! command -v psql &> /dev/null; then
        log_warn "PostgreSQL 未安装，正在安装..."
        brew install postgresql@15
        brew services start postgresql@15
    else
        log_info "PostgreSQL 已安装"
        # 确保服务运行
        if ! brew services list | grep postgresql | grep started &> /dev/null; then
            log_info "启动 PostgreSQL 服务..."
            # 自动检测已安装的 PostgreSQL 版本
            PG_VERSION=$(brew services list | grep postgresql | awk '{print $1}' | head -n1)
            if [ ! -z "$PG_VERSION" ]; then
                brew services start "$PG_VERSION"
            else
                brew services start postgresql
            fi
        else
            log_info "PostgreSQL 服务已运行 ✓"
        fi
    fi

    # 检查Redis
    if ! command -v redis-server &> /dev/null; then
        log_warn "Redis 未安装，正在安装..."
        brew install redis
        brew services start redis
    else
        log_info "Redis 已安装"
        # 确保服务运行
        if ! brew services list | grep redis | grep started &> /dev/null; then
            log_info "启动 Redis 服务..."
            brew services start redis
        fi
    fi

    # 检查Python 3.12
    if ! command -v python3.12 &> /dev/null; then
        log_warn "Python 3.12 未安装，正在安装..."
        brew install python@3.12
    else
        log_info "Python 3.12 已安装"
    fi

    # 检查Node.js
    if ! command -v node &> /dev/null; then
        log_warn "Node.js 未安装，正在安装..."
        brew install node@20
    else
        log_info "Node.js 已安装: $(node -v)"
    fi

    # 注意：不检查 Nginx，因为用户明确表示有其他项目在使用
    if command -v nginx &> /dev/null; then
        log_info "Nginx 已安装 (不会修改配置)"
    fi

    log_success "服务检查完成"
}

# 配置数据库
setup_database() {
    log_info "配置 PostgreSQL 数据库..."

    cd "$SCRIPT_DIR"

    # 检查数据库是否已存在
    if psql postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
        log_warn "数据库 $DB_NAME 已存在，跳过创建"
    else
        log_info "创建数据库和用户..."

        # 创建用户和数据库
        psql postgres << EOF
-- 创建用户（如果不存在）
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_user WHERE usename = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;

-- 创建数据库
CREATE DATABASE $DB_NAME OWNER $DB_USER;

-- 授予权限
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
EOF

        # 连接数据库并设置权限
        psql $DB_NAME << EOF
-- 设置默认权限
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO $DB_USER;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO $DB_USER;
EOF
    fi

    # 测试连接
    log_info "测试数据库连接..."
    if PGPASSWORD="$DB_PASSWORD" psql -h localhost -U $DB_USER -d $DB_NAME -c "SELECT version();" > /dev/null 2>&1; then
        log_success "数据库连接成功"
    else
        log_error "数据库连接失败"
    fi
}

# 检查Python虚拟环境
setup_python_env() {
    log_info "检查 Python 虚拟环境..."

    cd "$SCRIPT_DIR"

    # 检查虚拟环境
    if [ ! -d "venv" ]; then
        log_error "虚拟环境不存在，请先手动创建：python3.12 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    fi

    # 检查虚拟环境中的 Python 版本
    VENV_PYTHON_VERSION=$("$SCRIPT_DIR/venv/bin/python" --version 2>&1 | cut -d' ' -f2 | cut -d'.' -f1,2)
    if [[ "$VENV_PYTHON_VERSION" != "3.12" ]]; then
        log_warn "虚拟环境使用 Python $VENV_PYTHON_VERSION，建议使用 Python 3.12"
    else
        log_info "虚拟环境使用 Python $VENV_PYTHON_VERSION ✓"
    fi

    # 检查依赖是否已安装
    if "$SCRIPT_DIR/venv/bin/python" -c "import fastapi" 2>/dev/null; then
        log_info "Python 依赖已安装 ✓"
    else
        log_error "Python 依赖未安装，请运行：source venv/bin/activate && pip install -r requirements.txt"
    fi

    log_success "Python 环境检查完成"
}

# 设置前端环境
setup_frontend() {
    log_info "设置前端环境..."

    cd "$SCRIPT_DIR/web"

    if [ -f "package.json" ]; then
        if [ -d "node_modules" ]; then
            log_info "前端依赖已安装，跳过 ✓"
        else
            log_info "安装前端依赖（跳过 husky 钩子）..."
            npm install --ignore-scripts
        fi
    else
        log_warn "package.json 不存在"
    fi

    log_success "前端环境配置完成"
}

# 创建环境配置文件
setup_env() {
    log_info "配置环境变量..."

    cd "$SCRIPT_DIR"

    if [ -f ".env" ]; then
        log_warn ".env 文件已存在，跳过创建"
        return
    fi

    cat > .env << EOF
# 基础配置
EF__ENV=development
EF__DEBUG=true
EF__SECRET_KEY=$(openssl rand -hex 32)

# 数据库配置
EF__DB_HOST=localhost
EF__DB_PORT=5432
EF__DB_NAME=$DB_NAME
EF__DB_USER=$DB_USER
EF__DB_PASSWORD=$DB_PASSWORD
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
EF__API_DEBUG=true

# 日志配置
EF__LOG_LEVEL=DEBUG
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

    chmod 600 .env

    log_success "环境变量配置完成"
}

# 初始化数据库
init_database() {
    log_info "初始化数据库..."

    cd "$SCRIPT_DIR"
    source venv/bin/activate

    if [ -f "alembic.ini" ]; then
        log_info "运行数据库迁移..."
        alembic upgrade head
    else
        log_warn "alembic.ini 不存在，跳过迁移"
    fi

    log_success "数据库初始化完成"
}

# 创建 macOS 启动脚本
create_macos_scripts() {
    log_info "创建 macOS 启动脚本..."

    cd "$SCRIPT_DIR"

    # 创建目录
    mkdir -p tmp logs

    # 创建启动脚本（如果不存在）
    if [ ! -f "start_macos.sh" ]; then
        cat > start_macos.sh << 'EOFSCRIPT'
#!/bin/bash

# EuraFlow macOS 启动脚本

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "       启动 EuraFlow 服务 (macOS)"
echo "=========================================="

# 创建必要目录
mkdir -p tmp logs

# 确保服务运行
echo "[1/3] 检查系统服务..."
if ! brew services list | grep postgresql | grep started &> /dev/null; then
    echo "启动 PostgreSQL..."
    brew services start postgresql@15 || brew services start postgresql
fi

if ! brew services list | grep redis | grep started &> /dev/null; then
    echo "启动 Redis..."
    brew services start redis
fi

# 启动后端
echo "[2/3] 启动后端服务..."
source venv/bin/activate

# 检查端口占用
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "端口 8000 已被占用，停止现有进程..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

# 启动后端（后台运行）
nohup venv/bin/gunicorn ef_core.app:app \
    --bind 0.0.0.0:8000 \
    --workers 4 \
    --worker-class uvicorn.workers.UvicornWorker \
    --access-logfile logs/access.log \
    --error-logfile logs/error.log \
    > logs/backend.log 2>&1 &

echo $! > tmp/backend.pid
echo "后端服务已启动 (PID: $(cat tmp/backend.pid))"

# 启动前端
echo "[3/3] 启动前端服务..."
cd web

# 检查端口占用
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
    echo "端口 3000 已被占用，停止现有进程..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi

nohup npm run dev > ../logs/frontend.log 2>&1 &
echo $! > ../tmp/frontend.pid
echo "前端服务已启动 (PID: $(cat ../tmp/frontend.pid))"

cd ..

echo ""
echo "=========================================="
echo "✓ 所有服务已启动"
echo "=========================================="
echo ""
echo "访问地址:"
echo "  - 后端 API: http://localhost:8000"
echo "  - API 文档: http://localhost:8000/docs"
echo "  - 前端应用: http://localhost:3000"
echo ""
echo "管理命令:"
echo "  ./stop_macos.sh    - 停止所有服务"
echo "  ./restart_macos.sh - 重启所有服务"
echo "  ./status_macos.sh  - 查看服务状态"
echo ""
EOFSCRIPT
        chmod +x start_macos.sh
    fi

    # 创建停止脚本
    if [ ! -f "stop_macos.sh" ]; then
        cat > stop_macos.sh << 'EOFSCRIPT'
#!/bin/bash

# EuraFlow macOS 停止脚本

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "       停止 EuraFlow 服务 (macOS)"
echo "=========================================="

# 停止后端
if [ -f "tmp/backend.pid" ]; then
    PID=$(cat tmp/backend.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "停止后端服务 (PID: $PID)..."
        kill $PID 2>/dev/null || true
        sleep 2
        # 确保进程已停止
        kill -9 $PID 2>/dev/null || true
    fi
    rm -f tmp/backend.pid
fi

# 清理可能残留的进程
echo "清理残留进程..."
pkill -f "gunicorn ef_core.app:app" 2>/dev/null || true
pkill -f "uvicorn ef_core.app:app" 2>/dev/null || true

# 清理端口
if lsof -ti:8000 >/dev/null 2>&1; then
    echo "清理端口 8000..."
    lsof -ti:8000 | xargs kill -9 2>/dev/null || true
fi

# 停止前端
if [ -f "tmp/frontend.pid" ]; then
    PID=$(cat tmp/frontend.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "停止前端服务 (PID: $PID)..."
        kill $PID 2>/dev/null || true
        sleep 2
        kill -9 $PID 2>/dev/null || true
    fi
    rm -f tmp/frontend.pid
fi

# 清理前端进程
pkill -f "vite.*web" 2>/dev/null || true

if lsof -ti:3000 >/dev/null 2>&1; then
    echo "清理端口 3000..."
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
fi

echo ""
echo "=========================================="
echo "✓ 所有服务已停止"
echo "=========================================="
EOFSCRIPT
        chmod +x stop_macos.sh
    fi

    # 创建重启脚本
    if [ ! -f "restart_macos.sh" ]; then
        cat > restart_macos.sh << 'EOFSCRIPT'
#!/bin/bash

# EuraFlow macOS 重启脚本

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "       重启 EuraFlow 服务 (macOS)"
echo "=========================================="

./stop_macos.sh
sleep 2
./start_macos.sh
EOFSCRIPT
        chmod +x restart_macos.sh
    fi

    # 创建状态检查脚本
    if [ ! -f "status_macos.sh" ]; then
        cat > status_macos.sh << 'EOFSCRIPT'
#!/bin/bash

# EuraFlow macOS 状态检查脚本

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "       EuraFlow 服务状态 (macOS)"
echo "=========================================="
echo ""

# 检查后端
echo "后端服务:"
if [ -f "tmp/backend.pid" ]; then
    PID=$(cat tmp/backend.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "  ✓ 运行中 (PID: $PID)"
        echo "    http://localhost:8000"
    else
        echo "  ✗ 已停止 (PID 文件存在但进程不存在)"
    fi
else
    if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        PID=$(lsof -ti:8000)
        echo "  ✓ 运行中 (PID: $PID, 但没有 PID 文件)"
    else
        echo "  ✗ 未运行"
    fi
fi

echo ""

# 检查前端
echo "前端服务:"
if [ -f "tmp/frontend.pid" ]; then
    PID=$(cat tmp/frontend.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo "  ✓ 运行中 (PID: $PID)"
        echo "    http://localhost:3000"
    else
        echo "  ✗ 已停止 (PID 文件存在但进程不存在)"
    fi
else
    if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        PID=$(lsof -ti:3000)
        echo "  ✓ 运行中 (PID: $PID, 但没有 PID 文件)"
    else
        echo "  ✗ 未运行"
    fi
fi

echo ""

# 检查系统服务
echo "系统服务:"
echo -n "  PostgreSQL: "
if brew services list | grep postgresql | grep started &> /dev/null; then
    echo "✓ 运行中"
else
    echo "✗ 未运行"
fi

echo -n "  Redis: "
if brew services list | grep redis | grep started &> /dev/null; then
    echo "✓ 运行中"
else
    echo "✗ 未运行"
fi

echo ""
echo "=========================================="
EOFSCRIPT
        chmod +x status_macos.sh
    fi

    log_success "macOS 启动脚本创建完成"
}

# 显示完成信息
show_completion() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                      配置完成！                              ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${BLUE}数据库信息：${NC}"
    echo "  主机: localhost"
    echo "  端口: 5432"
    echo "  数据库: $DB_NAME"
    echo "  用户: $DB_USER"
    echo "  密码: $DB_PASSWORD"
    echo ""
    echo -e "${BLUE}启动服务：${NC}"
    echo "  ./start_macos.sh     - 启动所有服务"
    echo "  ./stop_macos.sh      - 停止所有服务"
    echo "  ./restart_macos.sh   - 重启所有服务"
    echo "  ./status_macos.sh    - 查看服务状态"
    echo ""
    echo -e "${BLUE}访问地址：${NC}"
    echo "  后端 API: http://localhost:8000"
    echo "  API 文档: http://localhost:8000/docs"
    echo "  前端应用: http://localhost:3000"
    echo ""
    echo -e "${YELLOW}注意事项：${NC}"
    echo "  1. 该脚本不会修改现有的 Redis/Nginx 配置"
    echo "  2. 项目使用独立的端口运行，不影响其他项目"
    echo "  3. 配置文件: .env"
    echo "  4. 日志目录: logs/"
    echo ""
}

# 主函数
main() {
    print_banner
    check_system
    check_services
    setup_database
    setup_python_env
    setup_frontend
    setup_env
    init_database
    create_macos_scripts
    show_completion

    log_success "EuraFlow macOS 环境配置完成！"
}

# 运行主函数
main "$@"
