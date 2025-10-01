#!/bin/bash

# EuraFlow macOS 重启脚本

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "=========================================="
echo "       重启 EuraFlow 服务 (macOS)"
echo "=========================================="

./stop_macos.sh
sleep 2
./start_macos.sh
