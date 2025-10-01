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
