# EuraFlow—可插拔框架早期架构设计（修订版）
> 目标：在跨境电商（中国→俄罗斯）业务背景下，为 EuraFlow（欧亚流）建立稳定、灵活、可灰度演进的**微内核 + 插件**架构。本文作为“早期架构设计”修订版，与《CODESTYLE.md（修订版）》《RELEASE.md（修订版）》《OPERATIONS.md（修订版）》《风险雷达》《OZON PRD/SRS》《COMPLIANCE.md》保持一致。

---

## 1. 设计目标与原则
- **稳定内核**：最小化内核职责；高内聚、低耦合；暴露清晰接口与事件。
- **可插拔**：功能以插件形式增删；插件运行在受限边界内，仅通过 Hook/Event 与内核交互。
- **演进友好**：版本化契约；兼容迁移（Expand/Contract）；Feature Flag 控制切换与灰度。
- **可观测**：统一日志/指标/Trace；关键链路可追踪；问题可快速定位与回滚。
- **合规**：数据分级、最小化、脱敏与审计；金额 Decimal；时间入库 UTC。

---

## 2. 总体架构
```
+---------------------------+        +--------------------------+
|        ef_core            |        |     外部平台/系统        |
|  - HTTP API (ASGI)        |<------>|  Ozon, 物流商, 结算等    |
|  - Plugin Host            |  Events/HTTP/gRPC/Webhook       |
|  - Event Bus (async)      |        +--------------------------+
|  - Task Runtime           |
|  - Config/RBAC/Audit      |
+----^-------------------^--+
     | Hooks/Events      | Tasks
     |                   |
+----+-------------------+------------------------------+
|                    Plugins                             |
| ef.channels.ozon  ef.channels.wb  ef.ops.wms  ef.fx    |
+--------------------------------------------------------+
```

**边界**：
- 插件**不得**跨目录 import 内核/他插件私有实现；仅使用内核公开的 `Hook API` 与 `Event API`。
- 数据层由内核提供统一访问适配（仓储接口/Unit of Work）；插件仅通过服务接口读写。

---

## 3. 目录结构（建议）
```
/apps/ef_core/
  app/                # ASGI 应用（FastAPI）
  core/               # 内核：插件宿主、事件总线、任务运行时
  domain/             # 领域模型（订单/发运/库存/价格）与服务接口
  infra/              # SQLAlchemy 仓储、队列适配、日志/指标/Trace
  api/                # /api/ef/v1/* 路由（仅调用 domain 服务）
  tasks/              # 定时/异步任务定义
  rbac/ audit/        # 权限与审计
/plugins/
  ef.channels.ozon/   # Ozon 插件（按 PRD/SRS）
  ef.channels.wb/     # 预留：Wildberries
  ef.channels.ae/     # 预留：AliExpress RU
/web/                 # 前端（@ef/*）
/docs/                # 文档与规格
```

---

## 4. 插件模型（Plugin Model）
### 4.1 生命周期
- **发现**：按照命名约定 `ef.<domain>.<subdomain>` 与 `plugin.json` 元数据自动注册。
- **初始化**：注入依赖（配置/服务接口/日志/指标/事件发布器）。
- **启停**：可运行期启停与版本切换（Feature Flag + 兼容契约）。

### 4.2 插件元数据（`plugin.json`）
```json
{
  "name": "ef.channels.ozon",
  "version": "1.0.0",
  "capabilities": ["orders.pull", "shipments.push", "inventory.push", "price.push", "refunds.read"],
  "config_schema": {
    "type": "object",
    "properties": {
      "page_size": { "type": "integer", "minimum": 10, "maximum": 500, "default": 100 },
      "concurrency_per_shop": { "type": "integer", "minimum": 1, "maximum": 8, "default": 2 }
    },
    "additionalProperties": false
  }
}
```

### 4.3 Hook 接口（由内核暴露）
```py
class HookAPI(Protocol):
    def register_cron(self, name:str, cron:str, task:Callable[..., Awaitable]): ...
    def publish_event(self, topic:str, payload:dict, *, key:str|None=None): ...
    def consume(self, topic:str, handler:Callable[[dict], Awaitable]): ...
    def get_service(self, name:str): ...  # 订单/库存等领域服务
```

### 4.4 插件入口（示例）
```py
# plugins/ef.channels.ozon/__init__.py
from .orders import pull_orders

def setup(hooks: HookAPI, cfg: dict):
    hooks.register_cron("ef.ozon.pull_orders", "*/5 * * * *", pull_orders)
```

---

## 5. 领域服务与契约
- **订单服务**：`OrdersService` 提供 `create_or_update(order_dto) -> id`；内部实现幂等、校验、状态机转换。
- **发运服务**：`ShipmentsService.push_tracking(order_id, carrier, tracking, packages)`；记录回执与重试策略。
- **库存/价格服务**：批量入参与分片处理；价格守护（毛利阈值）。
- **退款/退货只读服务**：游标分页读取。

**契约版本化**：`/api/ef/v{n}`；DTO 字段通过 JSON Schema 管理；废弃策略保留 ≥1 小版本过渡。

---

## 6. 事件总线（Event Bus）
- 主题命名：`ef.{domain}.{object}.{verb}`（例：`ef.ozon.order.created`）。
- 事件格式：
```json
{
  "event_id": "uuid",
  "ts": "2025-09-06T03:00:00Z",
  "topic": "ef.ozon.order.created",
  "shop_id": 1001,
  "payload": {"external_id":"316842903", "posting_number":"12345-0001", ...}
}
```
- 语义：**至少一次**投递；消费者需幂等；失败进入重试/死信与告警。

---

## 7. 数据模型（关键表，摘录）
- 与《PRD §3》一致：`orders/order_items/shipments/packages/inventories/listings/returns/refunds`。
- 统一约束：
  - Decimal 金额；E.164 电话与原始字段；RU 6 位邮编正则；UTC 时间戳。
  - 唯一/外键/索引命名规则与检查约束按《CODESTYLE.md》。

---

## 8. 错误模型与幂等
- 错误使用 **Problem Details**（`type/title/status/detail/code`）；统一返回 envelope `{ ok, data|error }`。
- 写入路径**必幂等**：使用业务幂等键（如 `platform+shop_id+external_id`）；对外接口支持 `Idempotency-Key`。

---

## 9. 观测与指标
- 日志：JSON；字段 `ts, level, trace_id, plugin, action, shop_id, latency_ms, result, err`；PII 脱敏。
- 指标：Prometheus 命名 `ef_*`；首批：
  - `ef_ozon_orders_pull_latency_ms` / `..._fail_total`
  - `ef_ozon_shipments_push_latency_ms` / `..._fail_total`
  - `ef_ozon_inventory_push_fail_total`、`ef_ozon_price_push_fail_total`
  - `ef_tasks_backlog{plugin}`
- Trace：OpenTelemetry；HTTP/DB/队列全链路。

---

## 10. 配置与密钥
- 环境变量前缀：`EF__*`；敏感信息不入代码/日志。
- 插件配置：按 `plugin.json` 的 `config_schema` 校验；配置中心/KV 持久化；变更需审计。

---

## 11. 部署与运行（基线）
- 服务由所在平台提供的**进程/服务管理器**托管（API、Worker、Scheduler）。
- Web 服务器提供反向代理与静态资源托管。
- 发布物：代码包、依赖离线包、前端静态；自动化工具分发、切换版本、健康检查与回退。

---

## 12. 开发者体验（DX）
### 12.1 本地开发
- Python 3.12 创建 `venv`，按 `requirements-dev.lock --require-hashes` 安装；`make dev` 或脚本并行启动 API/Worker/Web。
- 前端 `npm ci` + `vite`；使用企业/本地镜像源与缓存。

### 12.2 代码生成与校验
- OpenAPI 代码生成（前后端）；CI 校验 `ruff/black/mypy/pytest`、`eslint/prettier/tsc/vitest`。

---

## 13. 测试策略
- 单元：领域服务/映射/校验；Mock 外部。
- 契约：请求/响应录制回放；未知字段前向兼容。
- 集成：E2E（订单→回传→平台可见）；覆盖 COD/部分发货/长地址/异常码。
- 性能：3× 峰值压测（拉单/回传路径）；观察延迟/错误/积压。

---

## 14. 兼容与迁移
- 模式：Expand → 回填/双写 → Switch → Contract；任意时刻可回退到上一个应用版本。
- 数据迁移必须幂等并提供 `downgrade`；必要时提供只读兼容层。

---

## 15. 安全与合规要点
- 数据分级（L0–L3）与最小化；日志脱敏；密钥托管与轮换（季度）。
- 第三方共享最小化；跨境传输与留存周期遵循《COMPLIANCE.md》。

---

## 16. 性能与扩展性
- 以**店铺/插件**为隔离单元配置并发/速率；任务粒度 100–200/批。
- 退避策略：指数退避（1→2→4→8→16s，≤5 次）；熔断与恢复探针。
- DB：连接池 ≈ `2×vCPU` 初始；慢查询阈值 300ms；热点索引评审。

---

## 17. 路线图（建议）
- M0：Ozon MVP（已在 PRD/SRS）
- M1：WB/AE 接入；价格/库存策略引擎抽象；多店铺限速模板
- M2：促销与评价；售后自动化；多仓智能分配

---

## 18. 附录：最小可用插件示例
```py
# plugins/ef.channels.demo/__init__.py
from ef_core.hooks import HookAPI

async def hello(_: dict):
    print("hello from demo plugin")

def setup(hooks: HookAPI, cfg: dict):
    hooks.register_cron("ef.demo.hello", "*/10 * * * *", hello)
```

---

> 本设计文档以“契约优先”为导向，尽量避免与具体运行形态强绑定；如需变更边界或契约，请先在 PRD/SRS 中提出变更并完成评审。

