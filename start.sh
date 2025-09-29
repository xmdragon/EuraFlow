#!/bin/bash

# EuraFlow 启动脚本
# 使用项目级 Supervisor 管理服务

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}     Starting EuraFlow Services        ${NC}"
echo -e "${GREEN}========================================${NC}"

# 创建必要的目录
echo -e "${YELLOW}[1/4]${NC} Creating directories..."
mkdir -p tmp logs
echo -e "${GREEN}✓${NC} Directories created"

# 检查虚拟环境
echo -e "${YELLOW}[2/4]${NC} Checking Python virtual environment..."
if [ ! -d "venv" ]; then
    echo -e "${RED}✗${NC} Virtual environment not found!"
    echo "Please run: python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi
echo -e "${GREEN}✓${NC} Virtual environment found"

# 安装 supervisor（如果没有）
echo -e "${YELLOW}[3/4]${NC} Checking supervisor installation..."
if ! venv/bin/pip show supervisor > /dev/null 2>&1; then
    echo "Installing supervisor..."
    venv/bin/pip install supervisor
fi
echo -e "${GREEN}✓${NC} Supervisor is installed"

# 启动 supervisord
echo -e "${YELLOW}[4/4]${NC} Starting supervisord..."
if [ -f "tmp/supervisord.pid" ]; then
    PID=$(cat tmp/supervisord.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo -e "${YELLOW}!${NC} Supervisord is already running (PID: $PID)"
        echo "Reloading configuration..."
        venv/bin/supervisorctl -c supervisord.conf reread
        venv/bin/supervisorctl -c supervisord.conf update
    else
        echo "Starting supervisord..."
        venv/bin/supervisord -c supervisord.conf
        sleep 2
    fi
else
    echo "Starting supervisord..."
    venv/bin/supervisord -c supervisord.conf
    sleep 2
fi

# 启动所有服务
echo -e "\n${GREEN}Starting EuraFlow services...${NC}"
venv/bin/supervisorctl -c supervisord.conf start euraflow:*

# 等待服务启动
echo -e "\n${YELLOW}Waiting for services to start...${NC}"
sleep 3

# 显示服务状态
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}         Service Status                 ${NC}"
echo -e "${GREEN}========================================${NC}"
venv/bin/supervisorctl -c supervisord.conf status

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ EuraFlow services started successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Services:"
echo "  - Backend API: http://localhost:8000"
echo "  - API Docs: http://localhost:8000/docs"
echo "  - Supervisor Web: http://localhost:9001 (admin/admin123)"
echo ""
echo "Management commands:"
echo "  ./status.sh  - Check service status"
echo "  ./restart.sh - Restart all services"
echo "  ./stop.sh    - Stop all services"
echo ""