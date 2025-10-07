# EuraFlow - 跨境电商微内核平台

EuraFlow 是一个为中俄跨境电商业务设计的可扩展微内核平台，采用插件化架构支持多平台对接。

## 🚀 快速开始

### 环境要求

- Python 3.12+
- Node.js 18+ / npm
- PostgreSQL 12+
- Redis 6+
- Git
- Nginx（生产环境）

### 开发环境搭建

1. 克隆项目
```bash
git clone <repository-url>
cd EuraFlow
```

2. 设置开发环境
```bash
# Linux/WSL
source activate.sh

# macOS
./setup_macos.sh
```

3. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库和 Redis 连接
```

4. 初始化数据库
```bash
alembic upgrade head
```

5. 构建前端（生产环境）
```bash
cd web && npm install && npm run build
```

6. 启动服务
```bash
# Linux/WSL
./start.sh

# macOS
./start_macos.sh
```

访问 http://localhost:8000/docs 查看 API 文档。

## 📋 常用命令

### 服务管理
```bash
./start.sh         # 启动所有服务（backend + worker）
./stop.sh          # 停止所有服务
./restart.sh       # 重启所有服务
./status.sh        # 查看服务状态
```

### 开发工具
```bash
# 代码质量检查（pre-commit 自动运行）
pre-commit run --all-files

# 数据库迁移
alembic revision -m "description"  # 创建迁移
alembic upgrade head               # 应用迁移
alembic downgrade -1               # 回滚一个版本

# 测试
pytest                             # 运行所有测试
pytest tests/test_specific.py      # 运行特定测试

# 日志查看
tail -f logs/backend.log           # 后端日志
tail -f logs/worker.log            # Worker 日志
tail -f logs/supervisord.log       # Supervisor 日志
```

## 🏗️ 项目结构

```
EuraFlow/
├── ef_core/              # 微内核框架
│   ├── app.py           # FastAPI 主应用
│   ├── config.py        # 配置管理
│   ├── plugin_host.py   # 插件宿主
│   ├── event_bus.py     # 事件总线
│   ├── database.py      # 数据库管理
│   ├── models/          # 数据模型
│   ├── services/        # 核心服务
│   ├── api/             # API 路由
│   ├── tasks/           # 任务系统
│   ├── middleware/      # 中间件
│   └── utils/           # 工具模块
├── plugins/             # 插件目录
│   └── ef/
│       └── channels/
│           └── ozon/    # Ozon 渠道插件
├── web/                 # 前端项目
│   ├── src/            # React 源码
│   ├── dist/           # 构建产物
│   └── package.json    # 前端依赖
├── scripts/            # 开发和部署脚本
├── deploy/             # 部署配置
│   ├── nginx/         # Nginx 配置模板
│   └── systemd/       # Systemd 服务配置
├── docs/              # 项目文档
├── alembic/           # 数据库迁移
├── logs/              # 日志目录
├── config/            # 配置目录
├── supervisord.conf   # Supervisor 配置
└── .pre-commit-config.yaml  # Git hooks 配置
```

## 🔌 插件开发

EuraFlow 采用插件化架构，支持动态加载渠道插件。

### 插件结构

```python
# plugins/ef/channels/example/__init__.py
from typing import Dict, Any

async def setup(hooks, config: Dict[str, Any]):
    # 注册定时任务
    await hooks.register_cron(
        name="ef.example.sync", 
        cron="*/5 * * * *", 
        task=sync_task
    )
    
    # 订阅事件
    await hooks.consume(
        topic="ef.orders.created", 
        handler=handle_order
    )

async def sync_task():
    # 定时同步逻辑
    pass

async def handle_order(payload: Dict[str, Any]):
    # 订单处理逻辑
    pass
```

### 插件配置

```json
{
  "name": "ef.channels.example",
  "version": "1.0.0",
  "capabilities": ["orders.pull", "shipments.push"],
  "required_services": ["orders", "shipments"]
}
```

## 📊 监控和观测

- **健康检查**: `/healthz`
- **API 文档**: `/docs`
- **指标监控**: `/api/ef/v1/system/metrics`
- **系统信息**: `/api/ef/v1/system/info`

## 🛠️ 技术栈

- **后端**: Python 3.12, FastAPI, SQLAlchemy 2.0 (async), Alembic
- **前端**: TypeScript, React, Vite, TanStack Query, Tailwind CSS
- **数据库**: PostgreSQL, Redis
- **任务队列**: 自研任务运行器（基于 Redis）
- **监控**: Prometheus 指标, JSON 结构化日志
- **部署**: Supervisord (开发), systemd (生产), Nginx

## 📝 开发规范

### 代码约束

- API 前缀：`/api/ef/v1/*`
- 环境变量：`EF__*`
- 指标命名：`ef_*`
- 时间处理：统一 UTC
- 金额处理：Decimal(18,4)
- 错误格式：RFC7807 Problem Details

### 提交流程

项目配置了 pre-commit hooks，每次 `git commit` 时会自动运行：

```bash
# pre-commit 会自动执行：
# - ruff（Python 语法检查和自动修复）
# - black（Python 代码格式化）
# - mypy（类型检查）
# - eslint（TypeScript/React 检查）
# - prettier（前端代码格式化）
# - detect-secrets（密钥泄露检测）

git add .
git commit -m "feat: add new feature"

# 如果 pre-commit 检查失败，修复后重新提交
# 手动运行所有检查：
pre-commit run --all-files
```

## 🚀 生产部署

### 系统要求

- Ubuntu 20.04+ / CentOS 8+
- Python 3.12+
- PostgreSQL 12+
- Redis 6+
- Nginx

### 部署步骤

```bash
# 上传代码到 /tmp/euraflow-deploy/
sudo bash scripts/deploy.sh deploy
```

### 服务管理

```bash
# 开发环境（supervisord）
./status.sh                        # 查看服务状态
./restart.sh                       # 重启服务
tail -f logs/backend.log           # 查看日志

# 生产环境（systemd）
systemctl status ef-api ef-worker  # 查看服务状态
systemctl restart ef-api ef-worker # 重启服务
journalctl -u ef-api -f            # 查看日志
```

## 📚 文档

- [架构设计](docs/eura_flow_可插拔框架早期架构设计（修订版）.md)
- [开发规范](docs/eura_flow_codestyle.md)
- [发布流程](docs/eura_flow_release.md)
- [运维手册](docs/eura_flow_operations.md)
- [合规要求](docs/eura_flow_compliance.md)

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交变更
4. 推送到分支
5. 创建 Pull Request

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。