#!/bin/bash
# EuraFlow 生产环境部署脚本 (纯Linux)
set -e

if [[ $EUID -ne 0 ]]; then
   echo "错误: 需要root权限"
   exit 1
fi

echo "=============================="
echo "EuraFlow 生产环境部署"
echo "=============================="

APP_USER="euraflow"
APP_DIR="/opt/euraflow"

# 创建用户和目录
echo "[1/6] 创建应用用户..."
id "$APP_USER" &>/dev/null || useradd -r -s /bin/false "$APP_USER"
mkdir -p "$APP_DIR" "$APP_DIR/logs"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# 部署代码
echo "[2/6] 部署应用代码..."
systemctl stop ef-api ef-worker 2>/dev/null || true
cp -r . "$APP_DIR/app"
chown -R "$APP_USER:$APP_USER" "$APP_DIR/app"

# 安装依赖
echo "[3/6] 安装Python依赖..."
cd "$APP_DIR/app"
sudo -u "$APP_USER" python3.12 -m venv venv
sudo -u "$APP_USER" venv/bin/pip install --upgrade pip
sudo -u "$APP_USER" venv/bin/pip install -r requirements.txt

# 数据库迁移
echo "[4/6] 运行数据库迁移..."
sudo -u "$APP_USER" venv/bin/alembic upgrade head

# 配置systemd服务
echo "[5/6] 配置系统服务..."
cat > /etc/systemd/system/ef-api.service << EOF
[Unit]
Description=EuraFlow API
After=postgresql.service redis.service

[Service]
Type=exec
User=$APP_USER
WorkingDirectory=$APP_DIR/app
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/app/venv/bin/uvicorn ef_core.app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/ef-worker.service << EOF
[Unit]
Description=EuraFlow Worker
After=postgresql.service redis.service

[Service]
Type=exec
User=$APP_USER
WorkingDirectory=$APP_DIR/app
EnvironmentFile=$APP_DIR/.env
ExecStart=$APP_DIR/app/venv/bin/celery -A ef_core.tasks.celery_app worker
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable ef-api ef-worker

# 启动服务
echo "[6/6] 启动服务..."
systemctl start ef-api ef-worker

echo ""
echo "=============================="
echo "✓ 生产环境部署完成!"
echo "=============================="
echo "API服务: http://localhost:8000"
echo "查看日志: journalctl -u ef-api -f"
echo "=============================="