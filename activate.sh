#!/bin/bash
# EuraFlow快速激活脚本
if [ -f "$HOME/.venvs/euraflow/bin/activate" ]; then
    source "$HOME/.venvs/euraflow/bin/activate"
    export PYTHONPATH="$(pwd):$PYTHONPATH"
    echo "✓ EuraFlow虚拟环境已激活"
    echo "  Python: $(python --version)"
    echo "  位置: $HOME/.venvs/euraflow"
else
    echo "错误: 虚拟环境未找到"
    echo "请运行: ./scripts/install_exfat.sh"
fi
