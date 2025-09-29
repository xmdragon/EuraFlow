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
    echo -e "${RED}✗${NC} Supervisord is not running"
    exit 0
fi

PID=$(cat tmp/supervisord.pid)
if ! ps -p $PID > /dev/null 2>&1; then
    echo -e "${RED}✗${NC} Supervisord process not found (PID: $PID)"
    rm -f tmp/supervisord.pid
    exit 0
fi

# 停止所有服务
echo -e "\n${YELLOW}Stopping all services...${NC}"
supervisorctl -c supervisord.conf stop euraflow:*

# 等待服务停止
sleep 2

# 显示状态
echo -e "\n${YELLOW}Current service status:${NC}"
supervisorctl -c supervisord.conf status

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

    echo -e "${GREEN}✓${NC} Supervisord shutdown complete"
else
    echo -e "${YELLOW}!${NC} Supervisord is still running. Services are stopped."
    echo "Use './start.sh' to restart services"
    echo "Use 'supervisorctl -c supervisord.conf shutdown' to stop supervisord"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ EuraFlow services stopped             ${NC}"
echo -e "${GREEN}========================================${NC}"