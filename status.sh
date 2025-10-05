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

# 显示服务状态（过滤掉未配置启动的服务）
echo -e "\n${YELLOW}Backend Services Status:${NC}"
# 只显示backend服务，worker是可选的
BACKEND_STATUS=$(supervisorctl -c supervisord.conf status euraflow:backend 2>/dev/null)
if [ ! -z "$BACKEND_STATUS" ]; then
    echo "$BACKEND_STATUS"
fi

# 检查worker是否配置为自动启动
WORKER_STATUS=$(supervisorctl -c supervisord.conf status euraflow:worker 2>/dev/null | grep -v "FATAL" || true)
if [ ! -z "$WORKER_STATUS" ]; then
    echo "$WORKER_STATUS"
fi

# 显示前端状态
echo -e "\n${YELLOW}Frontend Status:${NC}"
if systemctl is-active --quiet nginx 2>/dev/null; then
    echo -e "${GREEN}✓${NC} Frontend served by Nginx"
    # 检查静态文件目录
    if [ -d "web/dist" ] && [ -f "web/dist/index.html" ]; then
        echo -e "${GREEN}✓${NC} Static files present in web/dist"
    else
        echo -e "${YELLOW}!${NC} Static files missing in web/dist"
        echo "  Run 'cd web && npm run build' to build frontend"
    fi
else
    echo -e "${YELLOW}!${NC} Nginx not detected"
    if [ -d "web/dist" ] && [ -f "web/dist/index.html" ]; then
        echo -e "${GREEN}✓${NC} Static files built in web/dist (run nginx to serve)"
    else
        echo -e "${YELLOW}!${NC} Static files missing - run 'cd web && npm run build'"
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
echo ""
echo -e "${BLUE}========================================${NC}"