#!/bin/bash

# EuraFlow 状态检查脚本

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 获取脚本所在目录
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}      EuraFlow Service Status           ${NC}"
echo -e "${BLUE}========================================${NC}"

# 检查 supervisord
echo -e "\n${YELLOW}Supervisor Status:${NC}"
if [ -f "tmp/supervisord.pid" ]; then
    PID=$(cat tmp/supervisord.pid)
    if ps -p $PID > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Supervisord is running (PID: $PID)"
    else
        echo -e "${RED}✗${NC} Supervisord PID file exists but process not found"
        exit 1
    fi
else
    echo -e "${RED}✗${NC} Supervisord is not running"
    echo "  Run './start.sh' to start services"
    exit 1
fi

# 显示服务状态
echo -e "\n${YELLOW}Backend Services Status:${NC}"
supervisorctl -c supervisord.conf status euraflow:*

# 显示前端状态
echo -e "\n${YELLOW}Frontend Status:${NC}"
if systemctl is-active --quiet nginx 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Frontend served by Nginx (Production Mode)"
    # 检查静态文件目录
    if [ -d "web/dist" ] && [ -f "web/dist/index.html" ]; then
        echo -e "${GREEN}✓${NC} Static files present in web/dist"
    else
        echo -e "${YELLOW}!${NC} Static files missing in web/dist"
        echo "  Run 'cd web && npm run build' to build frontend"
    fi
else
    echo -e "${YELLOW}!${NC} Nginx not detected (Development Mode)"
    # 检查是否有开发服务器在运行
    FRONTEND_STATUS=$(supervisorctl -c supervisord.conf status frontend 2>/dev/null | awk '{print $2}')
    if [ "$FRONTEND_STATUS" = "RUNNING" ]; then
        echo -e "${GREEN}✓${NC} Frontend dev server running (npm run dev)"
    else
        echo "  Frontend dev server not running"
        echo "  To start: supervisorctl -c supervisord.conf start frontend"
    fi
fi

# 检查端口占用
echo -e "\n${YELLOW}Port Usage:${NC}"

# 检查后端 API 端口 (8000)
if lsof -Pi :8000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Backend API is listening on port 8000"
else
    echo -e "${RED}✗${NC} Backend API is NOT listening on port 8000"
fi

# 检查 Supervisor Web 端口 (9001)
if lsof -Pi :9001 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo -e "${GREEN}✓${NC} Supervisor Web UI is listening on port 9001"
else
    echo -e "${YELLOW}!${NC} Supervisor Web UI is NOT listening on port 9001"
fi

# 显示日志文件信息
echo -e "\n${YELLOW}Recent Logs:${NC}"

if [ -d "logs" ]; then
    echo -e "\n${BLUE}Backend logs (last 5 lines):${NC}"
    if [ -f "logs/backend.log" ]; then
        tail -5 logs/backend.log | sed 's/^/  /'
    else
        echo "  No backend logs found"
    fi

    # 检查错误日志
    if [ -f "logs/backend-error.log" ] && [ -s "logs/backend-error.log" ]; then
        echo -e "\n${RED}Backend errors (last 3 lines):${NC}"
        tail -3 logs/backend-error.log | sed 's/^/  /'
    fi
else
    echo "  Log directory not found"
fi

# 显示访问信息
echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}         Access Information             ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo "Backend API:     http://localhost:8000"
echo "API Docs:        http://localhost:8000/docs"
echo "Supervisor Web:  http://localhost:9001"
echo "                 (Username: admin, Password: admin123)"
echo ""
echo -e "${BLUE}========================================${NC}"