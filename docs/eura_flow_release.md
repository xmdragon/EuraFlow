# EuraFlow—RELEASE.md（修订版）
> 统一 EuraFlow 的发版、放量、数据库迁移与回滚实践；目标：**可安全上线、可快速回撤、可观测可追溯**。

---

## 1. 版本与分支
- **SemVer**：`MAJOR.MINOR.PATCH`；Core 与各插件独立版本，维护兼容矩阵。
- **分支模型**：`main`（稳定）/`develop`（集成）/`feature/*`（单需求）/`hotfix/*`（紧急修复）。
- **标签**：发布时打 `vX.Y.Z`，附发布说明与变更日志链接。

---

## 2. Release Train（列车制）
- 固定节奏：每周一次（例如周四 16:00 UTC+8）。紧急热修单独发车。
- 车次清单：变更列表、风险评估、开关策略、迁移/回滚脚本、监控与告警计划、灰度方案。

---

## 3. 发布物（Artifacts）
- 后端代码包：`ef-core-vX.Y.Z.tar.gz`
- Python 依赖离线包：`wheelhouse.zip`（与 `requirements.lock` 哈希一致）
- 前端静态产物：`web-dist.tar.gz`
- SBOM：后端/前端各生成一份并归档（供合规与审计）。

---

## 4. 预发布检查（Go/No‑Go 前置）
- ✅ 测试：单元/集成/契约/回归全部通过；覆盖率达标（≥80%，核心≥90%）。
- ✅ 文档：OpenAPI、迁移说明、变更日志已更新；Runbook 完整。
- ✅ 观测：新增日志/指标/Trace 接入；仪表盘与告警阈值更新并验证通路。
- ✅ 数据库：采用 **Expand/Contract** 策略；迁移、回填与回滚演练通过。
- ✅ 安全：依赖审计（pip/npm）、SBOM 生成；密钥/配置通过审阅。

---

## 5. 发布步骤（标准化脚本）
1) 生成版本号并打 Tag：`vX.Y.Z`。
2) CI 构建第 3 节发布物并签名/校验哈希。
3) 将发布物分发到目标节点的 `/opt/euraflow/releases/vX.Y.Z/` 并解压。
4) 停变更窗口内执行：
   - 切换软链接：`/opt/euraflow/ef-core -> releases/vX.Y.Z`
   - 数据库迁移：`alembic upgrade head`
   - 重启服务：`systemctl restart ef-api ef-worker ef-scheduler`
5) 健康检查：
   - 存活探针：`/healthz` 200
   - 关键接口抽测（读/写各 1 条）
6) 启动灰度（见第 6 节）。

> 以上步骤由自动化脚本/平台执行，保证可重复、可审计。

---

## 6. 灰度与放量
- 维度：**按店铺**、**按插件**、或**按地区**逐步放量。
- 建议阶梯：10% → 30% → 100%，每档观察 ≥ 30–60 分钟或覆盖 ≥ N 笔订单。
- 验收信号：
  - 错误率不过阈（详见仪表盘）；拉单/回传延迟满足 SLO；队列积压可回落。
  - 随机抽测业务流程通过（下单→出库→回传→对账）。

---

## 7. 数据库迁移策略（Expand/Contract）
- **Expand**（向后兼容）：加列/加索引 → 回填 → 新代码读新列（必要时双写）。
- **Switch**：功能开关切换读写路径。
- **Contract**（清理）：稳定后删除旧列/索引。
- 原则：任一时刻允许回退到上一个应用版本；迁移脚本必须幂等并提供 downgrade。

---

## 8. 影子写与对账（可选但推荐）
- 关键路径采用影子表/双写比对：数量、金额、字段散列。
- 对账差异进入**悬挂账**；有人工复核与闭环处置界面。

---

## 9. 回滚策略
**触发条件**：P1 事故、错误预算瞬间耗尽、指标持续恶化且 30 分钟内无改观。

**步骤**：
1) 关闭相关功能开关或禁用目标插件。
2) 切回上一个版本软链接：`ln -sfn /opt/euraflow/releases/vX.Y.(Z-1) /opt/euraflow/ef-core`。
3) 如需要，执行迁移回滚：`alembic downgrade -1`（或相应版本）。
4) 重启服务：`systemctl restart ef-api ef-worker ef-scheduler`。
5) 触发补偿流程（重放/重算/对账），并在 2 小时内持续观察关键指标。
6) T+1 复盘：时间线、根因 5 Whys、行动项与责任人/截止日。

---

## 10. 发布后监控与验收
- 指标：
  - `ef_ozon_orders_pull_latency_ms`（P50/P95）、`ef_ozon_orders_pull_fail_total`
  - `ef_ozon_shipments_push_latency_ms` / `..._fail_total`
  - `ef_ozon_inventory_push_fail_total`、`ef_ozon_price_push_fail_total`
  - `ef_tasks_backlog{plugin}` 队列积压
- 验收窗口：发布后 24 小时持续绿灯；抽检订单/运单/价格/库存 5×N 样本对账无异常。

---

## 11. 变更日志（Changelog）规范
- 分类：Added / Changed / Deprecated / Removed / Fixed / Security。
- 标注影响：是否需要迁移、是否破坏兼容、是否需要操作手册更新。

---

## 12. 安全与合规闸门
- 依赖安全：`pip-audit`、`npm audit`、SBOM 产出；高危漏洞必须在发布前处置或豁免说明。
- 访问与密钥：配置以 `EF__*` 环境变量传入；禁止硬编码；变更需审计。
- 日志与隐私：日志默认脱敏；导出数据留存与访问有审计轨迹。

---

## 13. 发布模板（Release PR 模板）
```markdown
### 版本
- ef-core vX.Y.Z
- ef-plugin-ozon-orders vA.B.C

### 变更清单
-

### 风险与缓解
-

### 数据库迁移
- Expand→回填→Switch→Contract；回滚脚本：...

### 灰度与观测
- 放量 10%→30%→100%
- 关注指标：错误率/延迟/队列积压；告警路由：...

### 回滚预案
- 关闭开关/回退版本/迁移 downgrade；补偿任务：...
```

---

## 14. 附录：操作脚本骨架
**发布（release.sh）**
```bash
#!/usr/bin/env bash
set -euo pipefail
ver="$1"
base=/opt/euraflow
mkdir -p $base/releases/$ver
# 解压发布物到 $base/releases/$ver（略）
ln -sfn $base/releases/$ver $base/ef-core
alembic upgrade head
systemctl restart ef-api ef-worker ef-scheduler
```

**回滚（roll_back.sh）**
```bash
#!/usr/bin/env bash
set -euo pipefail
prev="$1"
ln -sfn /opt/euraflow/releases/$prev /opt/euraflow/ef-core
alembic downgrade -1 || true
systemctl restart ef-api ef-worker ef-scheduler
```

---

## 15. 术语与责任
- **R/A/C/I**：Owner 明确；需要会签的变更必须有业务/技术/运维三方确认。
- **变更窗口**：工作日 18:00–22:00；周末 10:00–18:00；特批需二线批准。

