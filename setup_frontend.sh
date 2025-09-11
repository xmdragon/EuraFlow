#!/bin/bash
# 前端安装脚本 - 解决EXFAT文件系统问题

echo "🚀 设置前端开发环境..."
echo "解决EXFAT文件系统不支持符号链接的问题"

# 创建临时工作目录
TMP_DIR="$HOME/.euraflow-web"
WEB_DIR="/mnt/e/project/EuraFlow/web"

echo "📦 创建工作目录: $TMP_DIR"
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

echo "📋 复制前端代码..."
cp -r "$WEB_DIR"/* "$TMP_DIR/"
cd "$TMP_DIR"

echo "📦 安装依赖..."
npm install

echo "🔗 创建软链接回原始目录..."
# 复制node_modules回原始目录（不使用符号链接）
cp -r node_modules "$WEB_DIR/"

echo "✅ 前端依赖安装完成！"
echo ""
echo "启动前端服务："
echo "  cd $WEB_DIR"
echo "  npx vite --host"
echo ""
echo "或者在临时目录启动："
echo "  cd $TMP_DIR"
echo "  npm run dev"