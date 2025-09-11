# EuraFlow - 跨境电商微内核平台

EuraFlow 是一个为中俄跨境电商业务设计的可扩展微内核平台，采用插件化架构支持多平台对接。

## 🚀 快速开始

### 环境要求

- Python 3.12+
- PostgreSQL 12+
- Redis 6+
- Git

### 开发环境搭建

1. 克隆项目
```bash
git clone <repository-url>
cd EuraFlow
```

2. 设置开发环境
```bash
make setup
```

3. 配置环境变量
```bash
cp .env.example .env
# 编辑 .env 文件，配置数据库和 Redis 连接
```

4. 初始化数据库
```bash
make db-init
```

5. 启动开发服务器
```bash
make dev
```

访问 http://localhost:8000/docs 查看 API 文档。

## 📋 常用命令

```bash
make help          # 查看所有可用命令
make setup         # 设置开发环境
make dev           # 启动开发服务器
make test          # 运行测试
make lint          # 代码检查
make format        # 格式化代码
make clean         # 清理生成文件
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
│   ├── api/            # API 路由
│   ├── tasks/          # Celery 任务
│   ├── middleware/     # 中间件
│   └── utils/          # 工具模块
├── plugins/            # 插件目录
│   └── ef/channels/ozon/  # Ozon 插件（待实现）
├── scripts/           # 开发和部署脚本
├── tests/            # 测试用例
├── docs/             # 项目文档
└── alembic/          # 数据库迁移
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

- **后端**: Python 3.12, FastAPI, SQLAlchemy 2.0, Celery
- **数据库**: PostgreSQL, Redis
- **消息队列**: Redis Streams
- **监控**: Prometheus, 结构化日志
- **部署**: systemd, Nginx

## 📝 开发规范

### 代码约束

- API 前缀：`/api/ef/v1/*`
- 环境变量：`EF__*`
- 指标命名：`ef_*`
- 时间处理：统一 UTC
- 金额处理：Decimal(18,4)
- 错误格式：RFC7807 Problem Details

### 提交流程

```bash
make lint          # 代码检查
make test          # 运行测试
make format        # 格式化代码
git commit -m "feat: add new feature"
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
make status        # 查看服务状态
make logs         # 查看服务日志
systemctl restart ef-api ef-worker ef-scheduler
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