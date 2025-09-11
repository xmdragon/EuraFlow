#!/bin/bash
# EuraFlow 开发环境安装脚本 (WSL + EXFAT)
set -e

echo "=============================="
echo "EuraFlow 开发环境设置"
echo "=============================="

# 安装系统依赖
echo "[1/4] 安装系统依赖..."
sudo apt update
sudo apt install -y \
    python3.12 python3.12-venv python3.12-dev \
    postgresql-client redis-tools \
    git curl wget

# 创建虚拟环境 (在Linux文件系统避免EXFAT问题)
echo "[2/4] 创建Python虚拟环境..."
VENV_DIR="$HOME/.venvs/euraflow"
rm -rf "$VENV_DIR"
python3.12 -m venv "$VENV_DIR" --copies
source "$VENV_DIR/bin/activate"
pip install --upgrade pip setuptools wheel

# 安装Python依赖
echo "[3/4] 安装Python依赖..."
cat > requirements.txt << 'EOF'
fastapi==0.109.0
uvicorn[standard]==0.27.0
sqlalchemy==2.0.25
asyncpg==0.29.0
alembic==1.13.1
redis==4.6.0
celery[redis]==5.3.4
pydantic==2.5.3
pydantic-settings==2.1.0
httpx==0.26.0
structlog==24.1.0
python-jose[cryptography]==3.3.0
python-dotenv==1.0.0
pytest==7.4.4
pytest-asyncio==0.23.3
mypy==1.8.0
ruff==0.1.11
EOF
pip install -r requirements.txt

# 创建配置文件
echo "[4/4] 创建配置文件..."
cat > .env << 'EOF'
# EuraFlow 开发环境配置
EF__DB_HOST=localhost
EF__DB_PORT=5432
EF__DB_NAME=euraflow
EF__DB_USER=euraflow
EF__DB_PASSWORD=euraflow_dev
EF__REDIS_HOST=localhost
EF__REDIS_PORT=6379
EF__API_HOST=0.0.0.0
EF__API_PORT=8000
EF__API_DEBUG=true
EF__SECRET_KEY=dev-secret-key
EF__LOG_LEVEL=DEBUG
EOF

# 创建便捷激活脚本
cat > activate.sh << EOF
#!/bin/bash
source $VENV_DIR/bin/activate
export PYTHONPATH="\$(pwd):\$PYTHONPATH"
echo "✓ EuraFlow开发环境已激活"
EOF
chmod +x activate.sh

echo ""
echo "=============================="
echo "✓ 开发环境安装完成!"
echo "=============================="
echo "激活环境: source activate.sh"
echo "启动服务: python scripts/run_dev.py"
echo "=============================="