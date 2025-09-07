# EuraFlow—CODESTYLE.md（修订版）
> 代码与接口风格统一规范。适用于 ef-core、ef-plugin-*、@ef/* 前端。
>
> 约定：时间一律入库 UTC；指标前缀 `ef_*`；环境变量前缀 `EF__*`；错误响应采用 RFC7807 Problem Details；金额/价格统一使用 Decimal（通常 18,4）。

---

## 1. 目录与命名
- 仓库根：`/apps`（后端）、`/web`（前端）、`/plugins`（插件）、`/infra`（脚本/运维）、`/docs`。
- 插件命名：`ef.<domain>.<subdomain>`（如 `ef.channels.ozon`）。包名前缀与事件主题保持一致。
- 事件主题：`ef.{domain}.{object}.{verb}`，示例：`ef.ozon.order.created`。
- 数据库命名：蛇形；表：`{模块}_{实体}`；索引：`ix_{表}_{列}`；唯一约束：`uq_{表}_{列}`；外键：`fk_{从表}_{到表}`。

---

## 2. Python 后端
### 2.1 基础
- 版本：Python 3.12+；类型检查：`mypy --strict`（插件可降级到 `--strict-optional`）。
- 代码风格：`ruff check`，`black` 120 列；导入分组：标准库/第三方/本地。
- 依赖锁定：`pip-compile --generate-hashes` 生成 `requirements.lock`；CI 产出 wheelhouse，安装使用 `--no-index --find-links wheelhouse --require-hashes`。

### 2.2 Web 与数据访问
- Web 框架：FastAPI（或兼容 ASGI）；路由前缀：`/api/ef/v1/*`。
- ORM：SQLAlchemy 2.x（prefer async）；迁移：Alembic。禁止隐式 N+1；必要时使用 `selectinload/joinedload`。
- 会话：请求级别生命周期；只在 service 层写入；事务粒度明确（避免跨线程共享会话）。

### 2.3 任务/调度
- 消费器：显式并发/速率限制；任务幂等键（业务天然键/去重锁）。
- 重试：指数退避（1→2→4→8→16s，≤5 次）；4xx（除 429）不重试；配置化退避上限。

### 2.4 错误与日志
- 错误模型：Problem Details（`type/title/status/detail/code`）。
- 日志：JSON 结构化，字段：`ts,level,trace_id,plugin,action,shop_id,latency_ms,result,err`；对电话/邮箱/地址进行脱敏。

---

## 3. TypeScript / React 前端
- 语言级：TS `strict: true`；模块：ESM；别名：`@ef/*`。
- 代码风格：ESLint（typescript, react, hooks, import）、Prettier；提交前本地校验必须通过。
- 数据访问：TanStack Query；数据不可变；错误边界明确；网络错误显示 RFC7807 `title/detail`。
- 组件：首字母大写；Hook 以 `use` 前缀；样式以 Tailwind 为主，避免全局样式污染。

---

## 4. API 设计
- 版本：URL 版本化 `/api/ef/v1`，兼容策略见 RELEASE；废弃时提供至少 1 个小版本过渡。
- 分页：cursor 优先，page 作为备选；统一返回 `{ items, next_cursor }`。
- 过滤：显式 Query（`from/to/status/shop_id`）；避免魔法字段。
- 幂等：所有写接口支持 `Idempotency-Key` 头（业务幂等键见各 SRS/PRD）。
- OpenAPI：按 Tag（域/插件）分组；响应示例与错误码齐全。

---

## 5. 安全与合规
- 机密：只从 `EF__*` 环境变量或密钥管家读取；严禁写死在代码/日志；本地用 `.env.example` 模板。
- PII：最小化采集与输出；日志与导出默认脱敏，按白名单暴露。
- 审计：登录、权限变更、手动同步/回传、配置变更需记录审计轨迹（含旧/新值）。
- CORS/CSRF：默认最小开放；跨域来源白名单可配置。

---

## 6. 测试
- 覆盖率：后端/前端 ≥80%，核心路径 ≥90%。
- 级别：单元（mock 依赖）→ 集成（契约/录制回放）→ E2E（关键用户旅程）。
- 数据：固定种子与工厂；时间/汇率等外部依赖打桩；俄语/中文长字符串与极值用例覆盖。

---

## 7. 提交与分支
- 提交规范：Conventional Commits（feat/fix/chore/docs/refactor/test/build）+ 英文祯述。
- 分支：`main`（稳定）/`develop`（集成）/`feature/*`/`hotfix/*`；PR 模板需包含风险/回滚方案。

---

## 8. 本地与 CI 最低门槛（中性表述）
- 后端：`ruff check`、`black --check .`、`mypy`、`pytest -q`、Alembic 检查无意外 diff。
- 前端：`eslint .`、`prettier -c .`、`tsc --noEmit`、`vite build`、`vitest run`。
- 构建产物：`ef-core-vX.Y.Z.tar.gz`（代码包）、`wheelhouse.zip`（Python 依赖离线包，带哈希）、`web-dist.tar.gz`（前端静态）。
- 依赖安全：`pip-audit`/`npm audit`；SBOM 生成与归档。

---

## 9. 国际化与本地化
- 地址/姓名：俄语优先存储；保留原始值与标准化字段。
- 电话：E.164 + 原始字段。
- 货币：RUB/CNY 双记账；Decimal 18,4；汇率快照入库。
- 时间：数据库 UTC；展示按店铺/用户时区。

---

## 10. 片段与参考
### 10.1 FastAPI 错误响应包装
```py
from fastapi import HTTPException

def problem(status:int, code:str, title:str, detail:str|None=None):
    raise HTTPException(status_code=status, detail={
        "type":"about:blank","title":title,"status":status,
        "detail":detail,"code":code
    })
```

### 10.2 Alembic 命名与向后兼容
- 迁移文件：`YYYYMMDD_HHMM_feature_name.py`
- 策略：Expand →（回填/双写）→ Switch → Contract；任何时刻允许回退到上一个应用版本。

### 10.3 Prometheus 指标命名
- `ef_{域或插件}_{对象}_{动作或度量}`，示例：`ef_ozon_orders_pull_latency_ms`、`ef_ozon_price_push_fail_total`。

