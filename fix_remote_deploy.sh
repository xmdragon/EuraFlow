#!/bin/bash
# 修复远程部署问题脚本

echo "==========================================="
echo "修复远程部署问题"
echo "==========================================="

# 1. 停止占用8000端口的进程
echo "1. 检查并停止占用8000端口的进程..."
PORT_PID=$(sudo lsof -t -i:8000)
if [ ! -z "$PORT_PID" ]; then
    echo "   找到占用8000端口的进程: PID=$PORT_PID"
    sudo kill -9 $PORT_PID
    echo "   ✓ 已停止进程"
else
    echo "   ✓ 端口8000未被占用"
fi

# 2. 停止所有supervisor服务
echo "2. 停止所有supervisor服务..."
supervisorctl -c supervisord.conf stop all

# 3. 等待服务停止
sleep 3

# 4. 重新启动服务
echo "3. 重新启动服务..."
supervisorctl -c supervisord.conf reread
supervisorctl -c supervisord.conf update
supervisorctl -c supervisord.conf start all

# 5. 检查服务状态
echo "4. 检查服务状态..."
sleep 2
supervisorctl -c supervisord.conf status

echo "==========================================="
echo "修复完成！"
echo "==========================================="