#!/bin/bash

# EuraFlow 诊断脚本
# 用于诊断服务启动问题

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
echo -e "${BLUE}     EuraFlow 诊断工具                 ${NC}"
echo -e "${BLUE}========================================${NC}"

# 1. 检查端口占用
echo -e "\n${YELLOW}[1] 检查端口占用:${NC}"
echo "Port 8000 (Backend API):"
lsof -i:8000 2>/dev/null || echo "  - Port 8000 is free"
echo ""
echo "Port 9001 (Supervisor Web):"
lsof -i:9001 2>/dev/null || echo "  - Port 9001 is free"

# 2. 检查Python环境
echo -e "\n${YELLOW}[2] 检查Python环境:${NC}"
if [ -d "venv" ]; then
    echo -e "${GREEN}✓${NC} Virtual environment exists"
    source venv/bin/activate
    python --version

    # 检查关键包
    echo -e "\n${YELLOW}检查关键Python包:${NC}"
    for pkg in fastapi uvicorn sqlalchemy alembic pydantic; do
        if python -c "import $pkg" 2>/dev/null; then
            echo -e "${GREEN}✓${NC} $pkg installed"
        else
            echo -e "${RED}✗${NC} $pkg NOT installed"
        fi
    done
else
    echo -e "${RED}✗${NC} Virtual environment not found!"
fi

# 3. 测试模块导入
echo -e "\n${YELLOW}[3] 测试模块导入:${NC}"
source venv/bin/activate 2>/dev/null
python -c "
try:
    from ef_core.app import app
    print('✓ ef_core.app imported successfully')
except Exception as e:
    print(f'✗ Import error: {e}')
"

# 4. 检查数据库连接
echo -e "\n${YELLOW}[4] 检查数据库连接:${NC}"
if [ -f ".env" ]; then
    echo -e "${GREEN}✓${NC} .env file exists"

    # 测试数据库连接
    source venv/bin/activate 2>/dev/null
    python -c "
import os
from dotenv import load_dotenv
load_dotenv()

db_host = os.getenv('EF__DB_HOST', 'Not set')
db_name = os.getenv('EF__DB_NAME', 'Not set')
db_user = os.getenv('EF__DB_USER', 'Not set')

print(f'  DB Host: {db_host}')
print(f'  DB Name: {db_name}')
print(f'  DB User: {db_user}')

# 尝试连接
try:
    import asyncpg
    import asyncio

    async def test_conn():
        try:
            conn = await asyncpg.connect(
                host=os.getenv('EF__DB_HOST'),
                database=os.getenv('EF__DB_NAME'),
                user=os.getenv('EF__DB_USER'),
                password=os.getenv('EF__DB_PASSWORD')
            )
            await conn.close()
            return True
        except Exception as e:
            print(f'  Connection error: {e}')
            return False

    result = asyncio.run(test_conn())
    if result:
        print('  ✓ Database connection successful')
except Exception as e:
    print(f'  ✗ Test failed: {e}')
"
else
    echo -e "${RED}✗${NC} .env file not found!"
fi

# 5. 检查日志文件
echo -e "\n${YELLOW}[5] 最近的错误日志:${NC}"
if [ -f "logs/backend-error.log" ]; then
    echo "Last 10 lines of backend-error.log:"
    tail -10 logs/backend-error.log | sed 's/^/  /'
else
    echo "  No backend-error.log found"
fi

# 6. 尝试手动启动backend
echo -e "\n${YELLOW}[6] 尝试手动启动backend (5秒测试):${NC}"
echo "Starting uvicorn..."
timeout 5 venv/bin/python -m uvicorn ef_core.app:app --host 0.0.0.0 --port 8000 2>&1 | head -20

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}     诊断完成                           ${NC}"
echo -e "${BLUE}========================================${NC}"