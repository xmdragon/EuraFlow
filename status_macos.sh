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
