# EuraFlow Makefile

.PHONY: help setup dev test lint format clean build docker

# 默认目标
help: ## 显示帮助信息
	@echo "EuraFlow 开发工具"
	@echo "==================="
	@echo "可用命令:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-15s\033[0m %s\n", $$1, $$2}'

setup: ## 设置开发环境
	@echo "🚀 设置开发环境..."
	python3 scripts/setup_dev.py

dev: ## 启动开发服务器
	@echo "🏃 启动开发服务器..."
	python3 scripts/run_dev.py

test: ## 运行测试
	@echo "🧪 运行测试..."
	@if [ -d "venv" ]; then \
		venv/bin/python -m pytest tests/ -v --cov=ef_core --cov-report=term-missing; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

lint: ## 代码检查
	@echo "🔍 运行代码检查..."
	@if [ -d "venv" ]; then \
		echo "运行 ruff..."; \
		venv/bin/ruff check ef_core/ || exit 1; \
		echo "运行 mypy..."; \
		venv/bin/mypy ef_core/ --ignore-missing-imports || exit 1; \
		echo "✅ 代码检查通过"; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

format: ## 格式化代码
	@echo "🎨 格式化代码..."
	@if [ -d "venv" ]; then \
		venv/bin/black ef_core/ tests/; \
		venv/bin/ruff check --fix ef_core/ tests/; \
		echo "✅ 代码格式化完成"; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

clean: ## 清理生成的文件
	@echo "🧹 清理文件..."
	find . -type f -name "*.pyc" -delete
	find . -type d -name "__pycache__" -delete
	find . -type d -name ".pytest_cache" -delete
	find . -type f -name ".coverage" -delete
	rm -rf htmlcov/
	rm -rf .mypy_cache/
	rm -rf dist/
	rm -rf build/
	rm -rf *.egg-info/
	@echo "✅ 清理完成"

db-init: ## 初始化数据库
	@echo "🗄️ 初始化数据库..."
	@if [ -d "venv" ]; then \
		if [ ! -f "alembic/versions/*.py" ]; then \
			venv/bin/alembic revision --autogenerate -m "Initial migration"; \
		fi; \
		venv/bin/alembic upgrade head; \
		echo "✅ 数据库初始化完成"; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

db-migrate: ## 创建数据库迁移
	@echo "📝 创建数据库迁移..."
	@if [ -d "venv" ]; then \
		read -p "迁移描述: " desc; \
		venv/bin/alembic revision --autogenerate -m "$$desc"; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

db-upgrade: ## 应用数据库迁移
	@echo "⬆️ 应用数据库迁移..."
	@if [ -d "venv" ]; then \
		venv/bin/alembic upgrade head; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

db-downgrade: ## 回滚数据库迁移
	@echo "⬇️ 回滚数据库迁移..."
	@if [ -d "venv" ]; then \
		venv/bin/alembic downgrade -1; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

install: ## 安装到系统（生产环境）
	@echo "📦 安装 EuraFlow..."
	@if [ "$$USER" = "root" ]; then \
		bash scripts/deploy.sh deploy; \
	else \
		echo "❌ 生产安装需要 root 权限"; \
		exit 1; \
	fi

api-only: ## 只启动 API 服务器（调试用）
	@echo "🌐 启动 API 服务器..."
	@if [ -d "venv" ]; then \
		PYTHONPATH=. venv/bin/python -m ef_core.app; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

worker-only: ## 只启动 Celery Worker（调试用）
	@echo "👷 启动 Celery Worker..."
	@if [ -d "venv" ]; then \
		PYTHONPATH=. venv/bin/celery -A ef_core.tasks.celery_app worker --loglevel=info; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

beat-only: ## 只启动 Celery Beat（调试用）
	@echo "⏰ 启动 Celery Beat..."
	@if [ -d "venv" ]; then \
		PYTHONPATH=. venv/bin/celery -A ef_core.tasks.celery_app beat --loglevel=info; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

shell: ## 启动 Python shell
	@echo "🐚 启动 Python shell..."
	@if [ -d "venv" ]; then \
		PYTHONPATH=. venv/bin/python -c "from ef_core.config import get_settings; print('EuraFlow shell ready'); import IPython; IPython.start_ipython()"; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi

logs: ## 查看服务日志（生产环境）
	@echo "📋 查看服务日志..."
	journalctl -u ef-api -u ef-worker -u ef-scheduler -f

status: ## 查看服务状态（生产环境）
	@echo "📊 查看服务状态..."
	systemctl status ef-api ef-worker ef-scheduler --no-pager

build: ## 构建发布包
	@echo "📦 构建发布包..."
	@if [ -d "venv" ]; then \
		venv/bin/python -m build; \
		echo "✅ 发布包构建完成"; \
	else \
		echo "❌ 虚拟环境不存在，请先运行 make setup"; \
		exit 1; \
	fi