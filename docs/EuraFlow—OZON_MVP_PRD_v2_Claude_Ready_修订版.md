# EuraFlow—OZON MVP PRD（v2：Claude‑Ready）
 **目的**：这是一份**可直接交给 Claude Code 开发**的、细粒度到“不会犯错”的 PRD。所有接口、字段、约束、状态、错误码、配置、指标、验收条目均**明确定义**，并提供“Claude 提示模板（Prompt Harness）”。

 **范围**：仅覆盖 Ozon 渠道 MVP（插件 `ef.channels.ozon`），与 `ef_core` 内核交互。

 **上线窗口**：2025‑10‑03（UTC+8）± 3 天。

---

## 0. 不变量（Claude 必须遵守）
- **前缀**：API `/api/ef/*`；环境变量 `EF__*`；指标 `ef_*`；插件名 `ef.<domain>.<subdomain>`。
- **边界**：插件仅通过 **Hooks/Events/Tasks** 与核心/他插件通信；**禁止跨目录 import 内部实现**。
- **时间**：入库一律 **UTC**；展示再转时区。
- **安全**：禁止在代码中出现密钥/PII；日志必须脱敏（电话、邮箱、token）。
- **幂等**：详见 §4.6；任一写操作都必须满足幂等。

---

## 1. 术语与外部对象（精确定义）
- **order_id**（Ozon）：平台订单唯一 ID（字符串）。
- **posting_number**（Ozon）：买家侧可见编号；可与 order_id 不同。
- **shop_id**：内部店铺主键（int）。
- **carrier_code**：`CDEK` | `BOXBERRY` | `POCHTA`（允许扩展）。
- **payment_method**：`online` | `cod`。

---

## 2. 体系结构（最小图景）
- 插件包：`ef.channels.ozon`（后端）与 `@ef/ozon-ui`（前端）。
- 主要子模块：`pull_orders`、`push_shipments`、`push_inventory`、`push_price`、`read_refunds`。
- 任务命名：`ef.ozon.<action>`（如 `ef.ozon.pull_orders`）。

---

## 3. 数据模型（表定义/约束/索引）
 **注意**：表前缀仅示意；最终以 `ef_core` 既有命名为准。

### 3.1 `orders`
```sql
CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL CHECK (platform='ozon'),
  shop_id BIGINT NOT NULL,
  external_id TEXT NOT NULL,             -- Ozon order_id
  external_no TEXT NOT NULL,             -- posting_number
  status TEXT NOT NULL,                  -- local enum
  external_status TEXT NOT NULL,         -- raw from Ozon
  is_cod BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('online','cod')),
  buyer_name TEXT NOT NULL,
  buyer_phone_raw TEXT,
  buyer_phone_e164 TEXT,
  buyer_email TEXT,
  address_country TEXT NOT NULL,         -- 'RU'
  address_region TEXT NOT NULL,
  address_city TEXT NOT NULL,
  address_street TEXT NOT NULL,
  address_postcode TEXT NOT NULL CHECK (address_postcode ~ '^\\d{6}$'),
  platform_created_ts TIMESTAMPTZ NOT NULL,
  platform_updated_ts TIMESTAMPTZ NOT NULL,
  fx_rate NUMERIC(18,6) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  idempotency_key TEXT NOT NULL,
  UNIQUE (platform, shop_id, external_id),
  UNIQUE (idempotency_key)
);
CREATE INDEX ix_orders_shop_updated ON orders(shop_id, platform_updated_ts);
```

### 3.2 `order_items`
```sql
CREATE TABLE order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT NOT NULL,
  offer_id TEXT,
  qty INTEGER NOT NULL CHECK (qty>0),
  price_rub NUMERIC(18,4) NOT NULL CHECK (price_rub>=0)
);
CREATE INDEX ix_order_items_order ON order_items(order_id);
```

### 3.3 `shipments` / `packages`
```sql
CREATE TABLE shipments (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  carrier_code TEXT NOT NULL CHECK (carrier_code IN ('CDEK','BOXBERRY','POCHTA')),
  tracking_no TEXT NOT NULL,
  pushed BOOLEAN NOT NULL DEFAULT FALSE,
  pushed_at TIMESTAMPTZ,
  push_receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_shipments_tracking ON shipments(tracking_no);

CREATE TABLE packages (
  id BIGSERIAL PRIMARY KEY,
  shipment_id BIGINT NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
  weight_kg NUMERIC(10,3) CHECK (weight_kg>=0),
  dim_l_cm NUMERIC(10,1) CHECK (dim_l_cm>0),
  dim_w_cm NUMERIC(10,1) CHECK (dim_w_cm>0),
  dim_h_cm NUMERIC(10,1) CHECK (dim_h_cm>0)
);
```

### 3.4 `inventories`
```sql
CREATE TABLE inventories (
  id BIGSERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL,
  sku TEXT NOT NULL,
  qty_available INTEGER NOT NULL CHECK (qty_available>=0),
  threshold INTEGER NOT NULL DEFAULT 0 CHECK (threshold>=0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sku)
);
```

### 3.5 `listings`
```sql
CREATE TABLE listings (
  id BIGSERIAL PRIMARY KEY,
  shop_id BIGINT NOT NULL,
  sku TEXT NOT NULL,
  price_rub NUMERIC(18,4) NOT NULL CHECK (price_rub>=0),
  price_old_rub NUMERIC(18,4) CHECK (price_old_rub>=price_rub),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (shop_id, sku)
);
```

### 3.6 `returns` / `refunds`（只读）
```sql
CREATE TABLE returns (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'ozon',
  shop_id BIGINT NOT NULL,
  external_id TEXT NOT NULL,          -- return id
  order_external_id TEXT NOT NULL,
  reason_code TEXT,
  status TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE refunds (
  id BIGSERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'ozon',
  shop_id BIGINT NOT NULL,
  order_external_id TEXT NOT NULL,
  amount_rub NUMERIC(18,4) NOT NULL CHECK (amount_rub>=0),
  created_at TIMESTAMPTZ NOT NULL
);
```

---

## 4. 内部 API（Northbound，给前端/系统使用）
 **统一响应**：`{ ok: boolean, data?: any, error?: { type, title, status, detail, code } }`（RFC7807）。

### 4.1 查询订单
```
GET /api/ef/v1/orders
Query:
  platform=ozon (固定)
  shop_id: int (必填)
  from: ISO8601（UTC） 可选
  to:   ISO8601（UTC） 可选
  status: string[] 可选（本地状态枚举见 §5）
  q: string 可选（posting_number/phone/email 前缀匹配）
  page_size: 10..200，默认 50
  cursor: string 可选（游标）
200 data: {
  items: Order[],
  next_cursor: string|null,
  total?: number (可选)
}
错误：400（参数非法）；403（无权限）；500
```

**Order 模型（响应）**
```json
{
  "id": 123,
  "platform": "ozon",
  "shop_id": 1001,
  "external_id": "316842903",
  "external_no": "12345-0001",
  "status": "picking",
  "external_status": "awaiting_packaging",
  "is_cod": false,
  "payment_method": "online",
  "buyer": {"name":"Иванов Иван","phone":"+79161234567","email":"test@ozon.ru"},
  "address": {"country":"RU","region":"Московская область","city":"Москва","street":"ул. Тверская, д.1","postal_code":"125009"},
  "platform_created_ts": "2025-09-01T03:53:20Z",
  "platform_updated_ts": "2025-09-01T04:10:02Z",
  "items": [
    {"sku":"SKU-12345","offer_id":"OFF-9988","qty":2,"price_rub":"1599.9000"}
  ]
}
```

### 4.2 手动拉单
```
POST /api/ef/v1/ozon/orders/sync
Body: { shop_id: int, from?: ISO8601, to?: ISO8601, dry_run?: boolean }
202 data: { pulled: int, deduped: int, window: {from?: string, to?: string} }
错误：400/403/409（已有进行中的同步）/429（全局限流）/500
```

### 4.3 发货回传（手动触发）
```
POST /api/ef/v1/ozon/shipments/push
Body: {
  order_external_id: string,
  carrier_code: "CDEK"|"BOXBERRY"|"POCHTA",
  tracking_no: string,
  packages?: [{ weight_kg?: number, dim_l_cm?: number, dim_w_cm?: number, dim_h_cm?: number }]
}
202 data: { pushed: true, receipt_id: string|null }
错误：400/403/404（订单不存在）/409（幂等冲突）/422（校验失败）/429/500
```

### 4.4 库存/价格回传（手动）
```
POST /api/ef/v1/ozon/inventory/push { shop_id:int, items: [{sku:string, qty:int}] }
POST /api/ef/v1/ozon/price/push     { shop_id:int, items: [{sku:string, price_rub:string, old_price_rub?:string}] }
202 data: { accepted: int, rejected: int }
```

### 4.5 退款/退货读取
```
GET /api/ef/v1/ozon/refunds   ?shop_id&from&to  → Refund[]
GET /api/ef/v1/ozon/returns   ?shop_id&from&to  → Return[]
```

### 4.6 幂等与速率
- **Idempotency-Key**：对 `POST` 写操作，服务端支持 `Idempotency-Key` 头；同一 `(key,shop_id)` 60 分钟内重复请求**必须无副作用**。
- **全局限流**：`X-Rate-Limit-Remaining` 响应头；默认 `60 req/min`（可配）。

---

## 5. 状态机与映射
### 5.1 本地订单状态（枚举）
`created | confirmed | picking | shipped | delivered | closed | cancelled | on_hold`

### 5.2 外部→本地映射（示例）
 **实现要求**：在 `status_mapping.json` 中维护映射；未知状态落到 `on_hold` 并打告警。

| Ozon external_status           | local.status |
|---|---|
| awaiting_packaging             | picking |
| awaiting_deliver               | shipped |
| delivering                     | shipped |
| delivered                      | delivered |
| cancelled                      | cancelled |
| *unknown*                      | on_hold |

**状态迁移动作**（副作用）：
- `→ shipped`：触发 `push_shipments`（若有 tracking）；
- `→ cancelled`：释放锁定库存；
- `→ delivered/closed`：写入订单完成时间 `closed_at`（如有）。

---

## 6. 任务与调度（Workers）
- `ef.ozon.pull_orders`：Cron：`*/5 * * * *`；并发：每店铺最多 2；分页：`page_size=100`；窗口：默认 `updated_since = now()-1h`。
- `ef.ozon.push_shipments`：触发：`shipment.created` 事件或手动 API；重试：指数退避（1s→2s→4s→8s→16s），最多 5 次。
- `ef.ozon.push_inventory`：Cron：`*/15 * * * *`；阈值守护：`available<threshold → push 0`。
- `ef.ozon.push_price`：Cron：`0 */1 * * *`；毛利守护：见 §7。

---

## 7. 价格与汇率（规则）
- RUB 单价 `price_rub`、划线价 `price_old_rub` 保留 **4 位小数**；**禁止 float**，统一 `Decimal`。
- 价格守护：`(price_rub - cost_rub)/price_rub ≥ min_margin`（默认 `0.2`）。不满足则：**拒绝回传 + 告警**。
- 汇率取自 `ef.fx.rates`：字段 `fx_rate` 写入 `orders`（下单时快照）。

---

## 8. 校验规则（Validation）
- 电话：存 `buyer_phone_e164`，E.164；原值存 `buyer_phone_raw`。
- 邮编：`^\d{6}$`。
- 地址：`country='RU'` 固化；超长字段**截断**同时保留原值到 `*_raw`（如实现）。
- 包裹尺寸：输入允许整数/字符串，统一转换为 `cm/kg`。

---

## 9. 错误码（Problem Details code）
- `OZON_BAD_REQUEST`（400）：参数非法/缺字段
- `OZON_FORBIDDEN`（403）：权限不足
- `OZON_SYNC_CONFLICT`（409）：已有同步在进行
- `OZON_NOT_FOUND`（404）：目标不存在
- `OZON_RATE_LIMITED`（429）：被平台/本系统限流
- `OZON_UPSTREAM_5XX`（502/504）：上游错误/超时
- `OZON_GUARD_PRICE_VIOLATION`（422）：毛利/划线价规则不符
- `OZON_GUARD_STOCK_THRESHOLD`（422）：库存阈值规则命中

**响应示例**
```json
{
  "ok": false,
  "error": {
    "type": "about:blank",
    "title": "Price guard violated",
    "status": 422,
    "detail": "price 1499 < min margin with cost 1300",
    "code": "OZON_GUARD_PRICE_VIOLATION"
  }
}
```

---

## 10. 观测（日志/指标/Trace）
- **日志**（JSON 必含）：`ts, level, trace_id, plugin, action, shop_id, count, latency_ms, result, err`；PII 脱敏（电话/邮箱/地址段）。
- **指标**（Prometheus 名称）：
  - `ef_ozon_orders_pull_latency_ms`（histogram）
  - `ef_ozon_orders_pull_fail_total`
  - `ef_ozon_shipments_push_latency_ms`, `ef_ozon_shipments_push_fail_total`
  - `ef_ozon_inventory_push_fail_total`, `ef_ozon_price_push_fail_total`
  - `ef_tasks_backlog{plugin="ef.channels.ozon"}`
- **Trace**：OpenTelemetry；HTTP/DB/队列自动埋点；`trace_id` 回写日志。

---

## 11. 权限（RBAC）与审计
- 权限点：
  - `orders:read`、`orders:sync`、`shipments:push`、`inventory:push`、`price:update`、`returns:read`。
- 审计事件：登录、权限变更、手动同步/回传、配置变更（含旧/新值）。

---

## 12. 配置（环境变量/插件配置）
- 环境变量（示例）：
  - `EF__DB_URL`、`EF__REDIS_URL`
  - `EF_PLUGIN_OZON__API_KEY`、`EF_PLUGIN_OZON__CLIENT_ID`
- 插件 KV（可通过管理端修改）：
```json
{
  "pull": {"page_size": 100, "window_minutes": 60, "concurrency_per_shop": 2},
  "timeouts": {"upstream": 10, "internal": 3},
  "retries": {"max": 5, "backoff_base_sec": 1},
  "inventory": {"default_threshold": 5},
  "pricing": {"min_margin": 0.2}
}
```

---
- 配置文件（如 `.env.*`）由自动化工具渲染；配置以 `EF__*` 环境变量注入；避免在文档中绑定到特定打包/运行方式的信息。
## 13. 前端（最小页面规范）
- **订单列表**：筛选（店铺/时间窗/状态/关键词）；字段（posting_number、状态、金额、是否 COD、下单时间、更新时间）；批量操作：拉单。
- **回传面板**：发货/库存/价格手动回传；展示最近 24h 成功/失败记录与原因；支持重试按钮。
- **监控面板**：上述指标的图表；最近错误 TopN；告警状态。

---

## 14. 验收条目（Given/When/Then）
 完整 35 条 UAT 用例见附件 CSV。本节列 **必过 12 条 P0**。

1) **新订单端到端**  
Given 店铺授权有效且外部有新单；When 触发 `/ozon/orders/sync`；Then `orders`/`order_items` 正确写入，`status=created|picking` 合理，日志 `result=ok`，指标 `pull_latency_ms` 有记录，且 Ozon 后台可见后续回传数据。

2) **幂等去重**  
Given 同一时间窗重复拉单；When 再次调用同步；Then `deduped>0` 且数据库无重复记录（唯一键不冲突）。

3) **429 退避**  
Given 平台返回 429；When 同步；Then 退避重试≤5 次后成功或熔断，日志含 `retry/backoff` 字段，错误率曲线回落。

4) **10s 超时保护**  
Given 上游响应>10s；When 同步；Then 中止并按策略重试，不占满连接池。

5) **地址/邮编校验**  
Given 俄语长地址+邮编 6 位；When 入库；Then 字段化正确且不过长；无验证错误。

6) **COD 标记**  
Given COD 订单；When 同步；Then `payment_method=cod` 且 `is_cod=true`；对账无误差。

7) **库存阈值守护**  
Given qty<threshold；When 回传；Then 回传 0 或跳过；无超卖。

8) **毛利下限守护**  
Given price 导致毛利<阈值；When 回传；Then 422 错误，`code=OZON_GUARD_PRICE_VIOLATION`，无副作用。

9) **发货回传重试**  
Given 第一次回传失败；When 自动重试；Then 成功且无重复回传。

10) **分页无漏重**  
Given 多页数据；When 拉单；Then 无丢失/重复（抽样核对 count/ids）。

11) **向前兼容未知字段**  
Given 平台返回新增字段；When 解析；Then 忽略但不报错；日志记录 `extra_fields=true`。

12) **RBAC 生效**  
Given 无权限用户；When 调用写接口；Then 403 并产生审计记录。

---

## 15. 附件与样例
- **附表 A：OZON 字段映射（CSV）** — *权威字段与校验*  
  下载：`EuraFlow_OZON_Field_Mapping_v1.csv`
- **附表 B：OZON UAT 用例（CSV）** — *35 条完整用例集*  
  下载：`EuraFlow_OZON_UAT_Cases_v1.csv`

---

## 16. Claude 提示模板（Prompt Harness）
> 复制以下模板作为每次让 Claude 写代码的开场白，避免越界与误改。

```
角色：你是 EuraFlow 的 Ozon 插件开发助手。先给出计划与影响面，不要直接改代码。
不变量：API 前缀 /api/ef/*；EF__* 环境变量；指标 ef_*；UTC；禁止跨目录 import；Problem Details；Decimal。
任务：实现 {子功能}（对应 PRD §x.y）。
上下文：
- 入口模块：ef.channels.ozon.{module}
- 涉及接口：{接口列表}
- 数据模型：PRD §3
- 状态/错误码：PRD §5/§9
约束：
- 不引入新依赖；仅改动以下文件：{白名单}
- 覆盖测试：引用附件 B 中的用例编号 {ids}
验收：
- 本地命令全部通过（参照 CODESTYLE.md §8）
- 指标/日志字段齐全（PRD §10）
```

---

## 17. 开放参数（由 PM/Tech Lead 赋值）
- 店铺数量：__；预估日单量峰值：__；拉单并发/速率：__。
- 回传并发（发货/库存/价格）：__；批量大小：__。
- 定价守护阈值：__；库存安全阈值默认：__。
- 告警阈值：失败 5 分钟累计 > __；backlog > __。

---

> **备注**：本 PRD 为实现一切“唯一可信来源”。若与其它文档冲突，以本 PRD 为准；如需变更，提交变更 PR 并同步更新附件与用例。
---

## 18. 环境与部署基线（信息化标准）
- 服务管理：使用所在平台的进程/服务管理器运行 API、Worker、Scheduler（例如 system 级服务）。
- 反向代理：Web 服务器提供（如 Nginx/Caddy 或等价能力）。
- 发布物：代码包、依赖离线包、前端静态产物；通过自动化工具分发与切换；支持回退。
- 健康检查：`/healthz`、关键接口抽测、自检仪表盘。

---

## 19. 备注
- 本 PRD 的技术约束以接口契约、数据模型与非功能需求为主，避免与具体打包/运行形态强绑定。
