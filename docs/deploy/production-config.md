# EuraFlow 生产环境部署配置指南

> 目标：支持 100 用户在线，50+ 并发请求
> 更新日期：2025-12-12

---

## 快速开始

```bash
# 1. 复制生产环境配置模板
cp .env.production.example .env

# 2. 修改配置（必须更换的项）
#    - EF__DB_PASSWORD: 数据库密码
#    - EF__SECRET_KEY: JWT 密钥（64位以上随机字符串）

# 3. 生成安全密钥
python -c "import secrets; print(secrets.token_urlsafe(64))"

# 4. 启动服务
./start.sh
```

---

## 配置项详解

### 数据库连接池

```bash
# .env
EF__DB_POOL_SIZE=40           # 基础连接池大小
EF__DB_MAX_OVERFLOW=60        # 允许的溢出连接数
# 总连接数 = pool_size + max_overflow = 100
```

**计算依据**：
- 100 用户在线，假设 70% 活跃率 = 70 活跃用户
- 每个活跃用户平均占用 1-2 个连接
- 预留 30% 余量用于突发流量

**PostgreSQL 配置**（`/etc/postgresql/*/main/postgresql.conf`）：
```ini
max_connections = 200         # 必须 >= 总连接数 + 系统连接
shared_buffers = 1GB          # 内存的 25%（4GB 服务器）
effective_cache_size = 3GB    # 内存的 75%
work_mem = 16MB
maintenance_work_mem = 256MB
```

### Redis 连接池

```bash
# .env
EF__REDIS_HOST=localhost
EF__REDIS_PORT=6379
EF__REDIS_DB=0
# Redis 连接池 max_connections=50（代码中配置）
```

**Redis 配置**（`/etc/redis/redis.conf`）：
```ini
maxclients 1000
maxmemory 512mb
maxmemory-policy allkeys-lru
```

### Celery Worker

```bash
# .env
EF__CELERY_CONCURRENCY=12    # CPU 核心数 × 2-3
```

**并发数计算**：
- CPU 核心数 × 2-3
- 4 核服务器：8-12 并发
- 8 核服务器：16-24 并发

### Nginx 配置

```nginx
# /etc/nginx/nginx.conf
worker_processes auto;          # 自动检测 CPU 核心数
worker_connections 4096;        # 每个 worker 的最大连接数

# 总并发 = worker_processes × worker_connections
# 4 核服务器：4 × 4096 = 16384 并发
```

**站点配置**（`/etc/nginx/sites-available/euraflow`）：
```nginx
server {
    listen 80;
    server_name euraflow.hjdtrading.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name euraflow.hjdtrading.com;

    # SSL 配置
    ssl_certificate /etc/letsencrypt/live/euraflow.hjdtrading.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/euraflow.hjdtrading.com/privkey.pem;

    # 安全头
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;

    # 客户端上传限制
    client_max_body_size 50M;

    # Gzip 压缩
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    # API 代理
    location /api {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # WebSocket
    location /ws {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;

        proxy_connect_timeout 10s;
        proxy_send_timeout 3600s;
        proxy_read_timeout 3600s;
    }

    # 静态资源（CDN 回源）
    location /downloads {
        alias /opt/euraflow/web/public/downloads;
        expires 1h;
    }

    # 前端应用
    location / {
        root /opt/euraflow/web/dist;
        try_files $uri $uri/ /index.html;
        expires 1d;
    }
}
```

---

## 安全配置清单

### 必须配置

| 配置项 | 生产环境值 | 说明 |
|--------|------------|------|
| `EF__API_DEBUG` | `false` | 禁用调试模式 |
| `EF__SECRET_KEY` | 64位随机字符串 | JWT 签名密钥 |
| `EF__DB_PASSWORD` | 强密码 | 数据库密码 |
| `EF__RATE_LIMIT_ENABLED` | `true` | 启用速率限制 |

### 生成安全密钥

```bash
# 生成 64 位 URL 安全的随机字符串
python -c "import secrets; print(secrets.token_urlsafe(64))"

# 示例输出（请勿使用此示例）：
# aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9dE1fG3hI5jK7lM9nO1pQ3rS5t
```

### 防火墙配置

```bash
# 仅开放必要端口
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP（重定向到 HTTPS）
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# 数据库和 Redis 仅允许本地访问
# PostgreSQL: listen_addresses = 'localhost'
# Redis: bind 127.0.0.1
```

---

## 监控与日志

### 日志轮转配置

```bash
# /etc/logrotate.d/euraflow
/opt/euraflow/logs/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0640 www-data www-data
    postrotate
        supervisorctl restart euraflow:
    endscript
}
```

### 健康检查

```bash
# API 健康检查
curl -s https://euraflow.hjdtrading.com/api/ef/v1/health | jq

# 数据库连接数
PGPASSWORD=xxx psql -h localhost -U euraflow -d euraflow \
    -c "SELECT count(*) FROM pg_stat_activity;"

# Redis 连接数
redis-cli CLIENT LIST | wc -l

# Celery Worker 状态
supervisorctl status euraflow:celery_worker
```

### 压力测试

```bash
# 安装 ab (Apache Benchmark)
sudo apt install apache2-utils

# 测试 API 性能（10000 请求，100 并发）
ab -n 10000 -c 100 -H "Authorization: Bearer <token>" \
    https://euraflow.hjdtrading.com/api/ef/v1/health

# 预期结果：
# - 请求成功率 > 99%
# - 平均响应时间 < 100ms
# - 99% 响应时间 < 500ms
```

---

## 部署检查清单

### 上线前

- [ ] `.env` 文件已配置（密码、密钥已更换）
- [ ] `EF__API_DEBUG=false`
- [ ] `EF__SECRET_KEY` 已设置为 64 位随机字符串
- [ ] PostgreSQL `max_connections >= 200`
- [ ] Redis `maxclients >= 1000`
- [ ] Nginx SSL 证书已配置
- [ ] 防火墙已配置（仅开放 22/80/443）
- [ ] 日志轮转已配置
- [ ] 备份策略已配置

### 上线后

- [ ] 健康检查 API 正常响应
- [ ] WebSocket 连接正常
- [ ] 定时任务正常执行（检查 Celery Beat 日志）
- [ ] 监控告警已配置

---

## 常见问题

### 数据库连接池耗尽

**症状**：API 响应超时，日志显示 "QueuePool limit reached"

**解决**：
1. 增加 `EF__DB_POOL_SIZE` 和 `EF__DB_MAX_OVERFLOW`
2. 增加 PostgreSQL `max_connections`
3. 检查是否有连接泄漏（未关闭的 Session）

### Redis 连接数过多

**症状**：Redis 报错 "max number of clients reached"

**解决**：
1. 增加 Redis `maxclients` 配置
2. 检查代码是否正确使用连接池

### Celery 任务堆积

**症状**：定时任务延迟执行，Redis 队列长度增长

**解决**：
1. 增加 `--concurrency` 参数
2. 检查是否有长时间运行的任务阻塞队列
3. 考虑使用多个队列分离任务优先级

---

## 资源规划

### 最小配置（100 用户）

| 资源 | 配置 |
|------|------|
| CPU | 4 核 |
| 内存 | 8 GB |
| 磁盘 | 100 GB SSD |
| 带宽 | 10 Mbps |

### 推荐配置（500 用户）

| 资源 | 配置 |
|------|------|
| CPU | 8 核 |
| 内存 | 16 GB |
| 磁盘 | 200 GB SSD |
| 带宽 | 50 Mbps |

---

## 相关文档

- [环境变量配置模板](../../.env.production.example)
- [数据库表结构](../database/README.md)
- [API 文档](../OzonAPI/index.html)
