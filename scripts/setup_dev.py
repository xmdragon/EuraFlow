#!/usr/bin/env python3
"""
EuraFlow 开发环境设置脚本
"""
import os
import sys
import subprocess
import shutil
from pathlib import Path


def run_command(cmd, description="", check=True):
    """运行命令并处理错误"""
    print(f"🔄 {description or cmd}")
    try:
        result = subprocess.run(cmd, shell=True, check=check, capture_output=True, text=True)
        if result.stdout:
            print(f"   {result.stdout.strip()}")
        return result.returncode == 0
    except subprocess.CalledProcessError as e:
        print(f"❌ 错误: {e}")
        if e.stderr:
            print(f"   {e.stderr.strip()}")
        return False


def check_requirements():
    """检查系统要求"""
    print("📋 检查系统要求...")
    
    # 检查 Python 版本
    if sys.version_info < (3, 12):
        print("❌ Python 3.12+ 是必需的")
        return False
    print(f"✅ Python {sys.version.split()[0]}")
    
    # 检查必需的命令
    required_commands = ["git", "python3", "pip"]
    for cmd in required_commands:
        if not shutil.which(cmd):
            print(f"❌ 找不到命令: {cmd}")
            return False
        print(f"✅ {cmd}")
    
    return True


def setup_venv():
    """设置虚拟环境"""
    print("🐍 设置 Python 虚拟环境...")
    
    venv_path = Path("venv")
    
    if venv_path.exists():
        print("   虚拟环境已存在")
        return True
    
    # 创建虚拟环境
    if not run_command(f"{sys.executable} -m venv venv", "创建虚拟环境"):
        return False
    
    return True


def install_dependencies():
    """安装依赖"""
    print("📦 安装依赖包...")
    
    # 确定 pip 路径
    if os.name == "nt":  # Windows
        pip_path = "venv/Scripts/pip"
        python_path = "venv/Scripts/python"
    else:  # Unix/Linux/macOS
        pip_path = "venv/bin/pip"
        python_path = "venv/bin/python"
    
    # 升级 pip
    if not run_command(f"{pip_path} install --upgrade pip", "升级 pip"):
        return False
    
    # 安装生产依赖
    if not run_command(f"{pip_path} install -r requirements.txt", "安装生产依赖"):
        return False
    
    # 安装开发工具
    dev_packages = [
        "pytest>=7.4.3",
        "pytest-asyncio>=0.21.1", 
        "pytest-cov>=4.1.0",
        "mypy>=1.7.1",
        "ruff>=0.1.7",
        "black>=23.12.0",
        "ipython>=8.18.1"
    ]
    
    for package in dev_packages:
        if not run_command(f"{pip_path} install '{package}'", f"安装 {package.split('>=')[0]}"):
            print(f"⚠️  警告: 无法安装 {package}")
    
    return True


def setup_database():
    """设置数据库"""
    print("🗄️  设置数据库...")
    
    # 检查 .env 文件
    env_file = Path(".env")
    if not env_file.exists():
        print("   复制 .env.example 到 .env...")
        shutil.copy(".env.example", ".env")
        print("   ⚠️  请编辑 .env 文件配置数据库连接")
    
    # 初始化 Alembic（如果需要）
    if not Path("alembic/versions").exists():
        print("   初始化数据库迁移...")
        run_command("alembic revision --autogenerate -m 'Initial migration'", 
                   "生成初始迁移文件", check=False)
    
    print("   💡 运行以下命令应用数据库迁移:")
    print("      alembic upgrade head")
    
    return True


def create_directories():
    """创建必要的目录"""
    print("📁 创建目录结构...")
    
    directories = [
        "logs",
        "data", 
        "temp",
        "uploads"
    ]
    
    for directory in directories:
        Path(directory).mkdir(exist_ok=True)
        print(f"   ✅ {directory}/")
    
    return True


def setup_git_hooks():
    """设置 Git 钩子"""
    print("🔗 设置 Git 钩子...")
    
    if not Path(".git").exists():
        print("   不是 Git 仓库，跳过钩子设置")
        return True
    
    # 创建 pre-commit 钩子
    hook_content = '''#!/bin/sh
# EuraFlow pre-commit hook

echo "Running pre-commit checks..."

# 运行代码检查
echo "🔍 Running ruff..."
if ! venv/bin/ruff check .; then
    echo "❌ Ruff check failed"
    exit 1
fi

# 运行类型检查
echo "🔍 Running mypy..."
if ! venv/bin/mypy ef_core --ignore-missing-imports; then
    echo "❌ MyPy check failed" 
    exit 1
fi

echo "✅ Pre-commit checks passed"
'''
    
    hook_path = Path(".git/hooks/pre-commit")
    hook_path.write_text(hook_content)
    hook_path.chmod(0o755)
    
    print("   ✅ 已设置 pre-commit 钩子")
    return True


def main():
    """主函数"""
    print("🚀 EuraFlow 开发环境设置")
    print("=" * 50)
    
    # 检查系统要求
    if not check_requirements():
        print("\n❌ 系统要求检查失败")
        sys.exit(1)
    
    # 设置虚拟环境
    if not setup_venv():
        print("\n❌ 虚拟环境设置失败")
        sys.exit(1)
    
    # 安装依赖
    if not install_dependencies():
        print("\n❌ 依赖安装失败")
        sys.exit(1)
    
    # 设置数据库
    if not setup_database():
        print("\n❌ 数据库设置失败") 
        sys.exit(1)
    
    # 创建目录
    if not create_directories():
        print("\n❌ 目录创建失败")
        sys.exit(1)
    
    # 设置 Git 钩子
    if not setup_git_hooks():
        print("\n❌ Git 钩子设置失败")
        sys.exit(1)
    
    print("\n" + "=" * 50)
    print("🎉 开发环境设置完成!")
    print("\n📝 下一步:")
    print("   1. 编辑 .env 文件配置数据库和 Redis")
    print("   2. 启动 PostgreSQL 和 Redis 服务")
    print("   3. 运行: alembic upgrade head")
    print("   4. 运行: python scripts/run_dev.py")
    print("\n💡 常用命令:")
    print("   - 运行测试: python -m pytest")
    print("   - 代码检查: ruff check .")
    print("   - 类型检查: mypy ef_core")
    print("   - 格式化代码: black .")


if __name__ == "__main__":
    main()