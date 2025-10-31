#!/bin/bash

# EuraFlow 重启脚本

# 颜色定义
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}     Restarting EuraFlow Services       ${NC}"
echo -e "${YELLOW}========================================${NC}"

# 检查 supervisord 是否运行
if [ -f "tmp/supervisord.pid" ]; then
    PID=$(cat tmp/supervisord.pid)
    if ps -p $PID > /dev/null 2>&1; then
        # Supervisord 正在运行，重启所有euraflow服务
        echo -e "\n${YELLOW}Restarting services...${NC}"
        supervisorctl -c supervisord.conf restart euraflow:*
    else
        # PID 文件存在但进程不存在
        echo -e "${YELLOW}!${NC} Supervisord not running, starting fresh..."
        rm -f tmp/supervisord.pid tmp/supervisor.sock
        ./start.sh
        exit 0
    fi
else
    # Supervisord 未运行，启动它
    echo -e "${YELLOW}!${NC} Supervisord not running, starting..."
    ./start.sh
    exit 0
fi

# 等待服务重启
echo -e "\n${YELLOW}Waiting for services to restart...${NC}"
sleep 1.5

# 显示服务状态
echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}         Service Status                 ${NC}"
echo -e "${GREEN}========================================${NC}"
# 显示所有euraflow服务的状态
supervisorctl -c supervisord.conf status euraflow:* 2>/dev/null

# 显示前端状态
echo -e "\n${YELLOW}Frontend:${NC}"
if systemctl is-active --quiet nginx 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Served by Nginx (Production)"
else
    echo "  Development mode"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}✓ Services restarted successfully!      ${NC}"
echo -e "${GREEN}========================================${NC}"