#!/bin/bash
# EuraFlow 快速安装脚本 - EXFAT/WSL兼容版本
set -e

echo "================================"
echo "EuraFlow 环境设置"
echo "================================"

# 1. 基础检查
if ! command -v python3.12 &> /dev/null; then
    echo "需要Python 3.12，正在安装..."
    sudo apt update
    sudo apt install -y python3.12 python3.12-venv python3.12-dev
fi

# 2. 创建虚拟环境（在Linux文件系统）
VENV_PATH="$HOME/.venvs/euraflow"
echo "创建虚拟环境: $VENV_PATH"
rm -rf "$VENV_PATH"
python3.12 -m venv "$VENV_PATH" --copies

# 3. 激活并升级pip
source "$VENV_PATH/bin/activate"
pip install --upgrade pip setuptools wheel

# 4. 创建激活脚本
cat > activate.sh << EOF
#!/bin/bash
source $VENV_PATH/bin/activate
echo "EuraFlow环境已激活 (Python \$(python --version))"
EOF
chmod +x activate.sh

echo ""
echo "✓ 安装完成!"
echo "================================"
echo "激活环境: source activate.sh"
echo "安装依赖: pip install -r requirements.txt"
echo "================================"