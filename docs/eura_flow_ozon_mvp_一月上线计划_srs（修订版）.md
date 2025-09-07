# EuraFlow—OZON MVP 一月上线计划 & SRS（修订版）
> 面向 **Ozon 渠道首发（MVP）** 的系统需求规格与上线计划。适配 EuraFlow 微内核+插件架构（插件：`ef.channels.ozon`）。
>
> - **目标上线窗口**：2025‑10‑03（UTC+8）± 3 天  
> - **本文角色**：作为实现与验收的“唯一可信来源”（与 PRD、CODESTYLE、RELEASE、OPERATIONS 对齐）

---

## 0. 目标与成功标准
**业务目标**：一个月内打通 **订单→仓配→回传** 全链路，满足运营与对账。

**成功指标（上线后 7 天内）**
- 新订单 TTD（平台→入库）P95 ≤ **5 分钟**
- 发货回传成功率 ≥ **99.5%**；回传延迟 P95 ≤ **3 分钟**
- 重复/漏单率 ≤ **0.1‰**（与 Ozon 对账）
- COD 相关异常率不高于历史基线

---

## 1. 范围冻结（Scope）
### 1.1 In‑Scope（MVP）
1) **订单拉取**：`created/updated` 增量、分页连续性、幂等写入  
2) **发货回传**：承运商/运单/包裹（支持部分发货）  
3) **库存同步**：单仓可售库存回传，安全阈值守护  
4) **价格同步**：基础价（RUB）、CNY→RUB 汇率换算、毛利下限守护  
5) **退货/退款读取**：只读可见（不产生平台侧写操作）  
6) **观测与告警**：指标/日志/Trace 与仪表盘、阈值告警  
7) **权限与审计**：`orders:read/sync`、`shipments:push`、`inventory:push`、`price:update`、`returns:read`

### 1.2 Out‑of‑Scope（M1/M2）
- 促销/优惠券、评价管理、多仓智能分配、自动售后审批/赔付、消息中心等

### 1.3 依赖
- 店铺授权与配额；承运商账号（CDEK/Boxberry/Почта）；汇率服务 `ef.fx.rates`；Staging 环境可用

---

## 2. 里程碑（4 周）
**Week 1**（定稿/准备）  
- 输出数据字典与映射初稿；建 Staging；接口契约草案与错误码  
- **Exit**：映射 v1 评审通过；Staging 能空跑

**Week 2**（闭环打通）  
- 拉单→入库→出库→发货回传→库存/价格回传；幂等/重试/限流完善  
- **Exit**：E2E 在 Staging 稳定 48h；仪表盘/告警生效

**Week 3**（对账/UAT/压测）  
- 历史样本随机 ≥1000 单对账；3× 峰值压测；Runbook 完成  
- **Exit**：对账偏差≤0.1‰；压测达标

**Week 4**（灰度/发布）  
- 金丝雀：10%→30%→100%；回滚演练；上线沟通与值班排班  
- **Exit**：Go/No‑Go 全绿

---

## 3. 体系与流程
- **插件结构**：`ef.channels.ozon/{pull_orders,push_shipments,push_inventory,push_price,read_refunds}`
- **任务命名**：`ef.ozon.<action>`（如 `ef.ozon.pull_orders`）
- **核心流程**：
  1) **拉单**：按 `updated_since` 增量拉取 → 幂等去重（`platform+shop_id+external_id`）→ 写入 `orders/order_items` → 发事件  
  2) **仓配**：WMS 出库生成运单/包裹 → 写 `shipments/packages`  
  3) **回传**：监听 `shipment.created` → 调用 Ozon API → 存回执/重试  
  4) **库存/价格**：策略求值 → 回传 → 记录结果与告警

---

## 4. 内部接口（Northbound API）
> 统一响应 envelope：`{ ok: boolean, data?: any, error?: { type,title,status,detail,code } }`（Problem Details）

### 4.1 查询订单
```
GET /api/ef/v1/orders?platform=ozon&shop_id={int}&from={ISO8601}&to={ISO8601}&status={csv}&q={str}&page_size=50&cursor=...
```
- 响应含 `items[]`、`next_cursor`；`Order` 模型见 PRD（附带买家/地址/行项目）

### 4.2 手动拉单
```
POST /api/ef/v1/ozon/orders/sync
Body: { shop_id:int, from?:string, to?:string, dry_run?:boolean }
```
- 202 接收：`{ pulled:int, deduped:int, window:{from?,to?} }`；409 表示已有同步在执行

### 4.3 发货回传
```
POST /api/ef/v1/ozon/shipments/push
Body: { order_external_id:string, carrier_code:"CDEK"|"BOXBERRY"|"POCHTA", tracking_no:string, packages?:[{weight_kg?:number, dim_l_cm?:number, dim_w_cm?:number, dim_h_cm?:number}] }
```
- 422 表示校验失败（示例：缺运单号/承运商不支持）

### 4.4 库存/价格回传
```
POST /api/ef/v1/ozon/inventory/push { shop_id:int, items:[{sku:string, qty:int}] }
POST /api/ef/v1/ozon/price/push     { shop_id:int, items:[{sku:string, price_rub:string, old_price_rub?:string}] }
```

### 4.5 退货/退款读取
```
GET /api/ef/v1/ozon/refunds?shop_id&from&to   → Refund[]
GET /api/ef/v1/ozon/returns?shop_id&from&to   → Return[]
```

### 4.6 幂等/速率
- 支持 `Idempotency-Key` 头；相同 `(key, shop_id)` 60 分钟内重复请求无副作用  
- 响应含 `X-Rate-Limit-Remaining`；默认 60 req/min（可配）

---

## 5. 数据模型与映射
> 完整字段请参见 **附表 A（CSV）**。本节仅列关键字段与约束。

### 5.1 订单（orders）
- 唯一键：`(platform='ozon', shop_id, external_id)`；`idempotency_key` 全局唯一
- 地址：`country='RU'`、邮编 `^\d{6}$`；电话存 `buyer_phone_e164` 与 `buyer_phone_raw`
- `platform_created_ts/platform_updated_ts` 入库统一 UTC

### 5.2 订单行（order_items）
- `qty>0`；`price_rub` 为 Decimal(18,4)

### 5.3 发运/包裹（shipments/packages）
- `carrier_code ∈ {CDEK, BOXBERRY, POCHTA}`；`tracking_no` 唯一索引
- 包裹尺寸重量统一 `cm/kg`

### 5.4 库存/价格（inventories/listings）
- `qty_available≥0`，带 `threshold`；`price_old_rub ≥ price_rub`

### 5.5 汇率与会计
- `fx_rate` 写入订单（下单时快照）；金额使用 Decimal，不得使用 float

**附件下载**：  
- 附表 A：字段映射 CSV — [EuraFlow_OZON_Field_Mapping_v1.csv](sandbox:/mnt/data/EuraFlow_OZON_Field_Mapping_v1.csv)

---

## 6. 状态机与映射
**本地订单状态**：`created | confirmed | picking | shipped | delivered | closed | cancelled | on_hold`

**外部→本地映射（示例）**  
- `awaiting_packaging → picking`  
- `awaiting_deliver/delivering → shipped`  
- `delivered → delivered`；`cancelled → cancelled`  
- 未识别 → `on_hold`（记录外部状态并告警）

**副作用**：
- `→ shipped` 触发发货回传任务  
- `→ cancelled` 释放锁定库存  
- `→ delivered/closed` 写入完成时间

---

## 7. 可靠性（幂等/重试/限流/超时）
- **幂等键**：订单 `platform+shop_id+external_id`；库存 `shop_id+sku+ts_bucket`；价格 `shop_id+sku`
- **重试**：指数退避（1→2→4→8→16s，≤5 次）；429/5xx 重试；4xx（非 429）不重试
- **超时**：外部 API 10s；内部 3s；超时中止并记录
- **限流**：按店铺/接口配置；出现异常自动下调
- **熔断**：连续失败达阈值熔断 60s，恢复后逐步放量

---

## 8. 观测与告警
**指标（Prometheus）**：
- `ef_ozon_orders_pull_latency_ms`（P50/P95）、`ef_ozon_orders_pull_fail_total`  
- `ef_ozon_shipments_push_latency_ms`、`ef_ozon_shipments_push_fail_total`  
- `ef_ozon_inventory_push_fail_total`、`ef_ozon_price_push_fail_total`  
- `ef_tasks_backlog{plugin="ef.channels.ozon"}`

**日志（JSON）**：`ts,level,trace_id,plugin,action,shop_id,latency_ms,result,err`；电话/邮箱/地址脱敏  
**告警阈值（范例）**：5 分钟失败 > 50 次 → P1；Backlog > 5k 且上升 → P2

---

## 9. 测试计划（UAT/对账/性能）
- **契约测试**：请求/响应录制回放；未知字段向前兼容  
- **E2E**：新单→出库→回传→平台可见；覆盖 COD/部分发货/长地址  
- **对账回归**：随机抽 ≥1000 单，金额/行数/状态一致  
- **性能**：3× 峰值压测（含拉单/回传）

**附件下载**：  
- 附表 B：UAT 用例 CSV — [EuraFlow_OZON_UAT_Cases_v1.csv](sandbox:/mnt/data/EuraFlow_OZON_UAT_Cases_v1.csv)

---

## 10. 上线前清单（Go/No‑Go）
- [ ] 店铺授权/配额确认；证书/回调可用  
- [ ] 配置与密钥经审阅，统一以环境变量 `EF__*` 注入  
- [ ] 迁移脚本与回滚脚本演练通过（Expand/Contract）  
- [ ] 仪表盘与告警通路验证；Runbook 演练（拉单延迟高/回传失败）  
- [ ] 金丝雀名单、灰度计划与回退路径清晰

---

## 11. 回滚预案
1) 关闭相关功能开关或禁用 `ef.channels.ozon` 插件  
2) 应用版本回退（保留数据库兼容）；必要时执行 `downgrade`  
3) 队列排空与补偿任务（重放/重算）  
4) 观察 2 小时；T+1 复盘

---

## 12. RACI（样例）
| 项目 | R | A | C | I |
|---|---|---|---|---|
| 需求与映射 | 运营 | PM | RD/QA | 财务/合规 |
| 接口实现 | RD | Tech Lead | QA | 运维 |
| 观测与告警 | SRE | Tech Lead | RD | PM |
| 上线审批 | PM | 负责人 | 合规/财务 | 全员 |

---

## 13. 风险与缓解（摘录）
- **429/限流**：并发/批量可配；指数退避；熔断与降级  
- **分页丢单**：窗口重叠与去重；抽样对账  
- **地址/编码**：俄语标准化、邮编/电话校验  
- **汇率风险**：毛利阈值守护+审批；异常报警  
- **单点依赖**：外部不可用时队列缓存并切人工流程

---

## 14. 环境与部署信息（基线）
- **服务管理**：使用所在平台提供的**进程/服务管理器**运行 API、Worker、Scheduler（如 system 级服务）  
- **反向代理**：Web 服务器提供（如 Nginx/Caddy 或等价能力）  
- **发布物**：代码包、依赖离线包、前端静态产物；通过自动化工具分发与切换；支持回退  
- **健康检查**：`/healthz`、关键接口抽测、自检仪表盘

---

## 15. 交付清单
- 接口文档（OpenAPI）与错误码表  
- 数据字典/映射（CSV/Markdown）  
- 仪表盘与告警规则（导出 JSON）  
- Runbook（两份故障场景）  
- UAT 报告与对账报告  
- 发布与回滚脚本（含演练记录）

