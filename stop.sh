#!/bin/bash

# EuraFlow 停止脚本

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}      Stopping EuraFlow Services        ${NC}"
echo -e "${YELLOW}========================================${NC}"

# 检查 supervisord 是否运行
if [ ! -f "tmp/supervisord.pid" ]; then
    echo -e "${YELLOW}!${NC} Supervisord is not running"

    # 检查是否有其他进程占用8000端口
    PORT_PID=$(lsof -t -i:8000 2>/dev/null)
    if [ ! -z "$PORT_PID" ]; then
        echo -e "${YELLOW}!${NC} Found process using port 8000 (PID: $PORT_PID)"
        echo -e "${YELLOW}Killing process...${NC}"
        kill -9 $PORT_PID 2>/dev/null || sudo kill -9 $PORT_PID 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Port 8000 cleared"
    fi
    exit 0
fi

PID=$(cat tmp/supervisord.pid)
if ! ps -p $PID > /dev/null 2>&1; then
    echo -e "${RED}✗${NC} Supervisord process not found (PID: $PID)"
    rm -f tmp/supervisord.pid

    # 清理可能占用端口的进程
    PORT_PID=$(lsof -t -i:8000 2>/dev/null)
    if [ ! -z "$PORT_PID" ]; then
        echo -e "${YELLOW}!${NC} Found process using port 8000 (PID: $PORT_PID)"
        echo -e "${YELLOW}Killing process...${NC}"
        kill -9 $PORT_PID 2>/dev/null || sudo kill -9 $PORT_PID 2>/dev/null || true
        echo -e "${GREEN}✓${NC} Port 8000 cleared"
    fi
    exit 0
fi

# 停止所有服务
echo -e "\n${YELLOW}Stopping all services...${NC}"
supervisorctl -c supervisord.conf stop all

# 等待服务停止
sleep 2

# 强制清理可能残留的进程
echo -e "\n${YELLOW}Cleaning up any remaining processes...${NC}"

# 清理gunicorn进程（旧的daemon模式）
GUNICORN_PIDS=$(pgrep -f "gunicorn ef_core.app:app" 2>/dev/null)
if [ ! -z "$GUNICORN_PIDS" ]; then
    echo -e "${YELLOW}Found old gunicorn processes: $GUNICORN_PIDS${NC}"
    kill -9 $GUNICORN_PIDS 2>/dev/null || sudo kill -9 $GUNICORN_PIDS 2>/dev/null
    echo -e "${GREEN}✓${NC} Killed old gunicorn processes"
fi

# 清理uvicorn进程
UVICORN_PIDS=$(pgrep -f "uvicorn ef_core.app:app" 2>/dev/null)
if [ ! -z "$UVICORN_PIDS" ]; then
    echo -e "${YELLOW}Found uvicorn processes: $UVICORN_PIDS${NC}"
    kill -9 $UVICORN_PIDS 2>/dev/null || sudo kill -9 $UVICORN_PIDS 2>/dev/null
    echo -e "${GREEN}✓${NC} Killed uvicorn processes"
fi

# 清理task runner进程
pkill -9 -f "watermark_task_runner" 2>/dev/null || true
pkill -9 -f "competitor_task_runner" 2>/dev/null || true

# 清理旧的PID文件
rm -f /var/run/euraflow/backend.pid 2>/dev/null || true

# 再次清理8000端口
PORT_PID=$(lsof -t -i:8000 2>/dev/null)
if [ ! -z "$PORT_PID" ]; then
    echo -e "${YELLOW}!${NC} Found process using port 8000 (PID: $PORT_PID)"
    kill -9 $PORT_PID 2>/dev/null || sudo kill -9 $PORT_PID 2>/dev/null || true
    echo -e "${GREEN}✓${NC} Port 8000 cleared"
fi

# 显示状态（只显示实际运行的服务）
echo -e "\n${YELLOW}Service status:${NC}"
# 获取服务状态，过滤掉未启动的worker
STATUS_OUTPUT=$(supervisorctl -c supervisord.conf status euraflow:* 2>/dev/null | grep -v "FATAL" | grep -v "worker" || true)
if [ ! -z "$STATUS_OUTPUT" ]; then
    echo "$STATUS_OUTPUT"
else
    echo -e "${GREEN}✓${NC} All services stopped"
fi

# 询问是否停止 supervisord
echo ""
read -p "Do you want to shutdown supervisord completely? (y/N): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "\n${YELLOW}Shutting down supervisord...${NC}"
    supervisorctl -c supervisord.conf shutdown
    sleep 2

    # 清理 PID 文件
    rm -f tmp/supervisord.pid
    rm -f tmp/supervisor.sock

    # 清理所有相关进程
    echo -e "\n${YELLOW}Final cleanup...${NC}"

    # 再次清理gunicorn（确保完全清理）
    FINAL_GUNICORN=$(pgrep -f "gunicorn ef_core.app:app" 2>/dev/null)
    if [ ! -z "$FINAL_GUNICORN" ]; then
        kill -9 $FINAL_GUNICORN 2>/dev/null || sudo kill -9 $FINAL_GUNICORN 2>/dev/null
        echo -e "${GREEN}✓${NC} Final gunicorn cleanup"
    fi

    # 最后再检查并清理端口占用
    for PORT in 8000 9001; do
        PORT_PID=$(lsof -t -i:$PORT 2>/dev/null)
        if [ ! -z "$PORT_PID" ]; then
            echo -e "${YELLOW}!${NC} Port $PORT still in use (PID: $PORT_PID)"
            kill -9 $PORT_PID 2>/dev/null || sudo kill -9 $PORT_PID 2>/dev/null || true
            echo -e "${GREEN}✓${NC} Port $PORT cleared"
        fi
    done

    # 清理旧的PID文件
    rm -f /var/run/euraflow/backend.pid 2>/dev/null || true

    echo -e "${GREEN}✓${NC} Supervisord shutdown complete"
else
    echo -e "${YELLOW}!${NC} Supervisord is still running. Services are stopped."
    echo "Use './start.sh' to restart services"
    echo "Use 'supervisorctl -c supervisord.conf shutdown' to stop supervisord"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ EuraFlow services stopped             ${NC}"
echo -e "${GREEN}========================================${NC}"