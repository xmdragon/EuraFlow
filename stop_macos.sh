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
