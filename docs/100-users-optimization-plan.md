# EuraFlow 100用户并发优化方案

> **用户确认信息**
> - 当前服务器：2核 4GB（严重不足）
> - 预算范围：1000-2000 元/月
> - 时间目标：1-3 个月内

## 一、当前系统架构分析

### 1.1 现有配置

| 组件 | 当前配置 | 瓶颈分析 |
|------|---------|---------|
| **服务器** | 2核 4GB | 🔴 严重不足，无法扩展 Worker |
| **Celery Worker** | 4 并发 × 150MB = 600MB | 内存已接近上限 |
| **数据库连接池** | 20 + 40 溢出 = 60 连接 | 接近 PostgreSQL 默认上限 |
| **Redis** | 单实例 localhost | 足够，但需监控内存 |
| **任务速率限制** | 100 任务/分钟 | 可能成为瓶颈 |

### 1.2 已识别的代码瓶颈

1. **订单拉取 N+1 查询** - 每个店铺单独查询商品
2. **库存更新循环 UPDATE** - 100个商品 = 100次数据库往返
3. **无任务超时设置** - 可能产生僵尸任务

---

## 二、100用户并发场景分析

### 2.1 负载估算

假设高峰期场景：
- 100 用户同时在线
- 每个用户平均 2-3 个 OZON 店铺
- 高峰期每小时约 50-80 次手动同步请求（订单/库存/标签）
- 定时任务：每小时 ~15 个系统任务

**峰值任务量**：
```
系统定时任务:      15 个/小时
用户手动同步:      80 个/小时（高峰）
总计:            ~100 个任务/小时
峰值瞬时:        ~20-30 个并发任务
```

### 2.2 资源消耗估算

每个任务平均资源消耗：
- **内存**: 100-200MB（API 响应缓存 + 数据处理）
- **CPU**: 0.2-0.5 核心（主要等待 I/O）
- **数据库连接**: 1-3 个/任务
- **执行时间**: 10-60 秒（取决于数据量）

---

## 三、优化方案

### 3.1 代码级优化（P0 - 必须先做）

#### 3.1.1 修复 N+1 查询
```python
# 当前问题代码 (ozon/__init__.py:891-943)
for shop_data in shops:
    products_result = await db.execute(
        select(OzonProduct).where(...)
    )

# 优化方案：预加载所有店铺商品
shop_ids = [s.id for s in shops]
all_products = await db.execute(
    select(OzonProduct).where(OzonProduct.shop_id.in_(shop_ids))
)
products_by_shop = defaultdict(list)
for p in all_products.scalars():
    products_by_shop[p.shop_id].append(p)
```

**预期效果**：减少 90% 数据库查询，API 响应时间降低 50%

#### 3.1.2 批量更新库存
```python
# 当前问题代码
for product_id in product_ids:
    product = await db.get(OzonProduct, product_id)
    product.sync_status = "success"
    await db.commit()

# 优化方案：一次批量更新
await db.execute(
    update(OzonProduct)
    .where(OzonProduct.id.in_(product_ids))
    .values(sync_status="success", updated_at=func.now())
)
await db.commit()
```

**预期效果**：100 个商品从 100 次往返降到 1 次

#### 3.1.3 添加任务超时
```python
@celery_app.task(
    bind=True,
    name="ef.ozon.orders.pull",
    soft_time_limit=300,  # 5 分钟软超时
    time_limit=360        # 6 分钟硬超时
)
def pull_orders_task(self, ...):
    ...
```

### 3.2 Celery 配置优化

#### 3.2.1 增加 Worker 并发

```bash
# supervisord.conf 修改
[program:celery_worker]
command=celery -A ef_core.tasks.celery_app worker \
  --loglevel=info \
  --queues=celery,default,ef_pull,ef_push,ef_core \
  --pool=prefork \
  --concurrency=8 \                    # 4 → 8
  --max-memory-per-child=250000 \      # 150MB → 250MB
  --max-tasks-per-child=50             # 减少内存泄漏风险
```

#### 3.2.2 队列优先级分离

```python
# celery_app.py 修改
task_routes = {
    "ef.core.*": {"queue": "ef_core"},
    "ef.*.pull_orders": {"queue": "ef_pull"},      # 高优先级
    "ef.*.push_*": {"queue": "ef_push"},           # 高优先级
    "ef.*.sync_*": {"queue": "ef_sync"},           # 中优先级
    "ef.*.cleanup*": {"queue": "ef_low"},          # 低优先级
}
```

#### 3.2.3 启动多个专用 Worker

```bash
# supervisord.conf - 多 Worker 配置
[program:celery_worker_high]
command=celery -A ef_core.tasks.celery_app worker \
  --queues=ef_pull,ef_push \
  --concurrency=4 \
  --max-memory-per-child=300000

[program:celery_worker_normal]
command=celery -A ef_core.tasks.celery_app worker \
  --queues=celery,default,ef_sync,ef_core \
  --concurrency=6 \
  --max-memory-per-child=250000

[program:celery_worker_low]
command=celery -A ef_core.tasks.celery_app worker \
  --queues=ef_low \
  --concurrency=2 \
  --max-memory-per-child=200000
```

### 3.3 数据库连接池优化

```python
# database.py 修改
db_pool_size = 30          # 20 → 30
db_max_overflow = 50       # 40 → 50
pool_timeout = 20          # 新增：等待连接超时
```

**总连接数**：30 + 50 = 80（需调整 PostgreSQL max_connections）

### 3.4 速率限制调整

```python
# celery_app.py
task_annotations = {
    "*": {"rate_limit": "200/m"},        # 100 → 200 任务/分钟
    "ef.ozon.orders.pull": {"rate_limit": "20/m"},   # 订单拉取单独限制
}
```

---

## 四、服务器配置建议

### 4.1 配置方案对比

#### 方案 A：单服务器（经济型）

**适用场景**：100 用户，中等并发

| 资源 | 推荐配置 | 说明 |
|------|---------|------|
| **CPU** | 8 核 | 4 核 API + 4 核 Celery |
| **内存** | 16GB | 8GB 应用 + 4GB PostgreSQL + 4GB 缓存 |
| **存储** | 200GB SSD | 数据库 + 日志 + 缓存 |
| **带宽** | 10Mbps | OZON API 调用 |

**资源分配**：
```
FastAPI (2 workers × 2 进程):    ~2GB
Celery Workers (12 并发):        ~3GB (250MB × 12)
PostgreSQL:                      ~4GB
Redis:                           ~1GB
系统 + 缓冲:                      ~6GB
总计:                            ~16GB
```

**月成本估算**：
- 阿里云 ECS ecs.c7.2xlarge：~800 元/月
- 腾讯云 CVM S6.2XLARGE：~750 元/月
- AWS c6i.2xlarge：~$200/月

#### 方案 B：分离部署（推荐）

**适用场景**：100+ 用户，高可用要求

| 服务器 | 配置 | 用途 |
|--------|------|------|
| **Web 服务器** | 4核 8GB | FastAPI + Nginx |
| **Worker 服务器** | 8核 16GB | Celery Workers |
| **数据库服务器** | 4核 16GB | PostgreSQL + Redis |

**优势**：
- 独立扩展各组件
- Worker 不影响 API 响应
- 数据库有独立资源

**月成本估算**：~2000-2500 元/月

#### 方案 C：云原生（高弹性）

**适用场景**：负载波动大，需要自动扩缩

| 组件 | 服务 | 说明 |
|------|------|------|
| **API** | 阿里云 FC / AWS Lambda | 按请求计费 |
| **Worker** | 阿里云 ACK / AWS ECS | 自动扩缩容 |
| **数据库** | 阿里云 RDS / AWS RDS | 托管服务 |
| **Redis** | 阿里云 Redis / ElastiCache | 托管服务 |

**优势**：
- 峰谷自动调节
- 无需运维服务器
- 高可用内置

**月成本估算**：~3000-5000 元/月（取决于用量）

### 4.2 推荐方案（基于 1000-2000 元/月预算）

**首选：方案 A+（单服务器升级版）**

```
服务器配置：8核 32GB 200GB SSD
预估成本：~1200-1500 元/月

理由：
1. 预算充足，建议直接上 32GB（预留扩展空间）
2. 运维简单（单服务器）
3. 可支撑 150-200 用户
4. 未来用户增长不用再升级硬件
```

**具体配置推荐**：

| 云厂商 | 实例规格 | 配置 | 月成本 |
|--------|---------|------|--------|
| 阿里云 | ecs.c7.2xlarge | 8核 16GB | ~800 元 |
| 阿里云 | ecs.c7.4xlarge | 16核 32GB | ~1500 元 |
| 腾讯云 | S6.2XLARGE16 | 8核 16GB | ~750 元 |
| 腾讯云 | S6.4XLARGE32 | 16核 32GB | ~1400 元 |

**强烈建议 32GB 方案**：
- 可运行 16-20 个 Celery Worker
- PostgreSQL 可分配 8GB shared_buffers
- 预留足够缓冲应对突发流量
- 未来 1-2 年无需再升级硬件

---

## 五、PostgreSQL 配置优化

```ini
# postgresql.conf

# 连接数
max_connections = 150              # 默认 100 → 150

# 内存配置（假设 16GB 总内存，4GB 给 PG）
shared_buffers = 1GB               # 25% of PG memory
effective_cache_size = 3GB         # 75% of PG memory
work_mem = 16MB                    # 每个查询的工作内存
maintenance_work_mem = 256MB       # 维护操作内存

# 并发
max_worker_processes = 4
max_parallel_workers_per_gather = 2
max_parallel_workers = 4

# WAL
wal_buffers = 64MB
checkpoint_completion_target = 0.9

# 日志
log_min_duration_statement = 100   # 记录超过 100ms 的查询
```

---

## 六、Redis 配置优化

```ini
# redis.conf

maxmemory 1gb
maxmemory-policy allkeys-lru       # LRU 淘汰策略

# 持久化（可选，Celery 任务可以重试）
save ""                            # 禁用 RDB 快照
appendonly no                      # 禁用 AOF

# 连接
maxclients 1000
timeout 300
```

---

## 七、监控指标

### 必须监控的指标

```yaml
# Prometheus 指标

# 任务队列
ef_celery_queue_length{queue="ef_pull"}      # 队列深度
ef_celery_task_duration_seconds              # 任务执行时间
ef_celery_task_failures_total                # 任务失败数

# 数据库
ef_db_pool_size                              # 当前连接数
ef_db_pool_overflow                          # 溢出连接数
ef_db_query_duration_seconds                 # 查询耗时

# API
ef_api_request_duration_seconds              # 请求耗时
ef_api_requests_total                        # 请求总数
ef_api_errors_total                          # 错误数
```

### 告警阈值

```yaml
# 告警规则

- alert: CeleryQueueBacklog
  expr: ef_celery_queue_length > 50
  for: 5m
  labels:
    severity: warning

- alert: DatabaseConnectionExhausted
  expr: ef_db_pool_size + ef_db_pool_overflow > 70
  for: 1m
  labels:
    severity: critical

- alert: TaskExecutionSlow
  expr: ef_celery_task_duration_seconds > 120
  for: 3m
  labels:
    severity: warning
```

---

## 八、实施路线图（1-3 个月内完成）

### 第一周：代码优化（P0 必做）

**目标**：修复代码瓶颈，在现有硬件上提升 50% 性能

| 天 | 任务 | 预期效果 |
|----|------|---------|
| Day 1-2 | 修复订单拉取 N+1 查询 | 减少 90% 数据库查询 |
| Day 2-3 | 修复库存更新循环 UPDATE | 100次往返 → 1次 |
| Day 3 | 添加任务超时配置 | 防止僵尸任务 |
| Day 4 | 本地测试 + 部署验证 | 确认性能提升 |

**修改文件清单**：
- `plugins/ef/channels/ozon/__init__.py` - 订单拉取优化
- `plugins/ef/channels/ozon/services/inventory.py` - 库存批量更新
- `ef_core/tasks/celery_app.py` - 任务超时配置

### 第二周：服务器升级

**目标**：新服务器上线，支撑 100 用户

| 天 | 任务 | 说明 |
|----|------|------|
| Day 1 | 采购服务器 | 阿里云/腾讯云 8核 32GB |
| Day 1-2 | 环境配置 | Python、PostgreSQL、Redis、Nginx |
| Day 2 | 数据迁移 | pg_dump/restore + Redis 同步 |
| Day 3 | 部署应用 | 代码部署 + supervisord 配置 |
| Day 4 | 测试验证 | 全功能测试 + 压力测试 |
| Day 5 | DNS 切换 | 域名指向新服务器 |

**配置文件修改**：
- `supervisord.conf` - Worker 并发数调整
- `ef_core/database.py` - 连接池扩大
- `.env` - 数据库连接配置

### 第三周：监控与优化

**目标**：建立可观测性，持续优化

| 任务 | 说明 |
|------|------|
| 部署 Prometheus | 收集系统和应用指标 |
| 部署 Grafana | 可视化仪表板 |
| 配置告警 | 队列积压、连接池耗尽、任务超时 |
| 压力测试 | 模拟 100 用户并发 |
| 调优 | 根据监控数据微调配置 |

### 后续：持续优化（可选）

- 考虑将 Celery 任务改为同步 HTTP 客户端
- 评估是否需要分离 Worker 服务器
- 实现自动扩缩容（如果用户增长到 200+）

---

## 九、总结

### 核心结论

1. **代码优化优先**：N+1 查询和循环 UPDATE 是最大瓶颈，修复后性能可提升 50%+
2. **服务器升级必要**：当前 2核 4GB 严重不足，建议升级到 8核 32GB
3. **推荐配置**：阿里云/腾讯云 8核 32GB，月成本 ~1500 元（预算范围内）
4. **监控是关键**：没有监控就无法发现瓶颈，建议同步部署

### 推荐服务器配置

```
规格：8核 32GB 200GB SSD
厂商：阿里云 ecs.c7.4xlarge 或 腾讯云 S6.4XLARGE32
成本：~1500 元/月
扩展能力：可支撑 150-200 用户，未来 1-2 年无需再升级
```

### 预期效果

| 指标 | 当前（2核4GB） | 优化后（8核32GB） |
|------|---------------|------------------|
| Celery 并发数 | 4 | 16-20 |
| 任务队列等待 | 30+ 秒（峰值）| < 5 秒 |
| API 响应时间 | 2-5 秒 | < 1 秒 |
| 数据库查询/请求 | ~100 次 | < 10 次 |
| 最大并发用户 | ~20 | 150-200 |

### 实施优先级

| 优先级 | 任务 | 预期周期 |
|--------|------|---------|
| P0 | 代码优化（N+1 查询、批量更新） | 第 1 周 |
| P0 | 服务器升级 | 第 2 周 |
| P1 | 监控部署 | 第 3 周 |
| P2 | 持续调优 | 持续进行 |
