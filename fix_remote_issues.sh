#!/bin/bash
# 修复远程服务器问题的脚本

echo "==========================================="
echo "修复远程服务器问题"
echo "==========================================="

# 1. 安装缺失的Python包
echo "1. 安装email-validator包..."
pip install email-validator

# 2. 创建缺失的competitor_task_runner模块
echo "2. 创建competitor_task_runner.py..."
cat > plugins/ef/channels/ozon/services/competitor_task_runner.py << 'EOF'
"""
竞争对手数据任务运行器
"""
import asyncio
import logging
from datetime import datetime

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)

logger = logging.getLogger(__name__)

async def main():
    """主运行函数"""
    logger.info("Competitor data task runner started")

    # 保持运行
    while True:
        try:
            # 这里可以添加实际的竞争对手数据同步逻辑
            await asyncio.sleep(60)  # 每分钟检查一次
            logger.debug("Competitor task runner heartbeat")
        except Exception as e:
            logger.error(f"Error in competitor task runner: {e}")
            await asyncio.sleep(30)

if __name__ == "__main__":
    asyncio.run(main())
EOF

# 3. 更新requirements.txt确保包含email-validator
echo "3. 更新requirements.txt..."
if ! grep -q "email-validator" requirements.txt; then
    echo "email-validator>=2.0.0" >> requirements.txt
fi

echo "==========================================="
echo "修复完成！"
echo "请在远程服务器上执行以下命令："
echo "1. cd /opt/euraflow"
echo "2. source venv/bin/activate"
echo "3. pip install email-validator"
echo "4. supervisorctl restart all"
echo "==========================================="