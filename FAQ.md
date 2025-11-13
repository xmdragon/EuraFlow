# EuraFlow 常见问题与解决方案 (FAQ)

> **用途**：记录项目开发中反复出现的疑难问题、排查思路和解决方案
>
> **使用原则**：遇到问题时先查阅本文档，避免重复踩坑

---

## 目录

- [前端问题](#前端问题)
  - [Ant Design Modal.confirm 不弹出](#ant-design-modalconfirm-不弹出)
  - [Ant Design notification 不显示或显示位置错误](#ant-design-notification-不显示或显示位置错误)
- [后端问题](#后端问题)
  - [Celery 异步任务报错 "Future attached to a different loop"](#celery-异步任务报错-future-attached-to-a-different-loop)
  - [如何添加新的后台定时任务服务](#如何添加新的后台定时任务服务)
  - [N+1 查询问题导致 API 响应缓慢](#n1-查询问题导致-api-响应缓慢)
  - [Celery 定时任务报错 "got an unexpected keyword argument '_plugin'"](#celery-定时任务报错-got-an-unexpected-keyword-argument-_plugin)
- [数据库问题](#数据库问题)
- [部署问题](#部署问题)

---

## 前端问题

### Ant Design Modal.confirm 不弹出

**问题描述**：
- 点击按钮后，`Modal.confirm()` 被调用（控制台有日志）
- 但确认对话框不显示
- 部分页面正常，部分页面异常

**根本原因**：
1. **模块级别解构** - 在组件函数外部使用 `const { confirm } = Modal;`
2. **缺少 App 上下文** - Ant Design v5 需要 `<App>` 组件提供上下文

**排查步骤**：

```bash
# 1. 检查是否有模块级解构
grep -rn "const { confirm } = Modal" web/src/

# 2. 检查 App.tsx 是否使用了 Ant Design 的 App 组件
grep -n "import.*App.*from.*antd" web/src/App.tsx
grep -n "<App>" web/src/App.tsx
```

**标准解决方案**：

#### 方法1：使用 App.useApp() hook（推荐 ✅）

这是 **Ant Design v5 官方推荐**的方式，通过 hook 获取 modal 实例：

```typescript
// ✅ 推荐：使用 useApp hook
import { App } from 'antd';

const MyComponent = () => {
  const { modal } = App.useApp();  // 获取 modal 实例

  const handleDelete = () => {
    modal.confirm({  // 使用 modal.confirm()
      title: '确认删除？',
      onOk: async () => { /* ... */ }
    });
  };

  return <Button onClick={handleDelete}>删除</Button>;
};
```

**优点**：
- ✅ 不依赖全局上下文，更可靠
- ✅ TypeScript 类型安全
- ✅ 符合 React Hooks 最佳实践
- ✅ 官方推荐方式

#### 方法2：直接调用 Modal.confirm()（不推荐 ⚠️）

```typescript
// ⚠️ 不推荐：直接调用静态方法（需要 App 上下文）
import { Modal } from 'antd';

const MyComponent = () => {
  const handleDelete = () => {
    Modal.confirm({ title: '确认删除？' });
  };
};
```

**缺点**：
- ❌ 必须在 App.tsx 中添加 `<App>` 组件包裹才能工作
- ❌ 依赖全局上下文，容易出问题
- ❌ 不符合 React Hooks 理念

**如果使用方法2，需要在 App.tsx 中添加：**

```typescript
// 文件：web/src/App.tsx
import { Spin, App as AntApp } from 'antd';

function App() {
  return (
    <AntApp>  {/* 必须：提供 Modal.confirm 所需的上下文 */}
      {/* 其他组件 */}
    </AntApp>
  );
}
```

#### ❌ 错误方式：模块级别解构

```typescript
// ❌ 错误：在组件外部解构（永远不要这样做）
const { confirm } = Modal;

const MyComponent = () => {
  const handleDelete = () => {
    confirm({ title: '确认删除？' }); // 不会弹出
  };
};
```

**验证方法**：

```typescript
// 添加调试日志
const handleClick = () => {
  console.log('Modal object:', Modal);
  console.log('Modal.confirm:', Modal.confirm);
  Modal.confirm({ title: '测试' });
};

// 预期输出：
// - Modal object: [Object]
// - Modal.confirm: function
// - 对话框弹出
```

**相关文件**：
- `web/src/App.tsx` - 主应用组件
- `web/src/pages/ozon/ProductList.tsx:73,1182` - 已修复
- `web/src/pages/system/components/OzonShopTab.tsx:67,302` - 已修复
- `web/src/components/ozon/shop/WebhookConfiguration.tsx:28,183` - 已修复

**防止复发**：
- ✅ 代码审查：禁止在模块级别解构 Ant Design 组件方法
- ✅ 文档规范：已在 `CLAUDE.md` 中明确标注此反模式（"禁止行为" 和 "Ant Design 规范" 章节）
- ✅ ESLint 规则（可选）：添加以下规则到 `web/.eslintrc.cjs`
  ```javascript
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: 'VariableDeclaration[kind=/const|let|var/] > VariableDeclarator > ObjectPattern > Property[key.name=/confirm|info|success|error|warning/] > Identifier',
        message: '禁止在模块级别解构 Ant Design 组件方法（如 Modal.confirm、message.success 等），请在组件函数内直接调用。详见 FAQ.md'
      }
    ]
  }
  ```

**参考资料**：
- [Ant Design v5 App 组件文档](https://ant.design/components/app-cn)
- [React Context 原理](https://react.dev/learn/passing-data-deeply-with-context)

---

### Ant Design notification 不显示或显示位置错误

**问题描述**：
- 调用 `notification.open()` 后通知不显示
- 或者通知显示在错误的位置（例如右上角而不是右下角）
- 控制台显示代码执行了，但用户看不到通知
- 用户多次反馈"没有进度提示框"

**根本原因**：
1. **直接 import notification** - 在 Ant Design v5 中，直接 `import { notification }` 可能无法正确获取上下文
2. **缺少 App 上下文** - 需要使用 `App.useApp()` hook 获取 notification 实例
3. **未指定位置** - 默认位置是 `topRight`，需要显式指定 `placement: 'bottomRight'`

**排查步骤**：

```bash
# 1. 检查是否直接 import notification
grep -rn "import.*notification.*from.*antd" web/src/

# 2. 检查是否使用了 App.useApp()
grep -rn "App.useApp()" web/src/

# 3. 检查 notification.open() 调用
grep -rn "notification.open" web/src/
```

**错误方式示例**（❌ 错误）：

```typescript
// ❌ 错误：直接 import notification
import { notification } from 'antd';

const MyComponent = () => {
  const handleSync = () => {
    notification.open({  // 可能不显示或显示位置错误
      message: '同步进行中',
      description: '正在同步数据...'
    });
  };
};
```

**标准解决方案**（✅ 正确）：

#### 步骤1：更改 import 语句

```typescript
// ✅ 正确：import App 而不是 notification
import { App } from 'antd';  // 改为 App

// 不再需要：
// import { notification } from 'antd';
```

#### 步骤2：在组件内使用 App.useApp() hook

```typescript
const MyComponent = () => {
  const { notification } = App.useApp();  // 在组件函数内获取

  const handleSync = () => {
    notification.open({
      message: '同步进行中',
      description: '正在同步数据...',
      placement: 'bottomRight',  // 重要：指定位置
      duration: 0,  // 可选：0 表示不自动关闭
    });
  };

  return <Button onClick={handleSync}>开始同步</Button>;
};
```

#### 步骤3：确保 App.tsx 使用了 App 组件包裹

```typescript
// 文件：web/src/App.tsx
import { App as AntApp } from 'antd';

function App() {
  return (
    <AntApp>  {/* 必须：提供 notification 所需的上下文 */}
      {/* 其他组件 */}
    </AntApp>
  );
}
```

**完整示例（实际修复案例）**：

```typescript
// 文件：web/src/pages/system/components/GlobalSettingsTab.tsx

// 修改前（❌ 不显示）
import { notification, Progress, ... } from 'antd';

const CategoryFeaturesSection = () => {
  const handleSync = () => {
    notification.open({  // 不显示！
      message: '批量同步进行中',
      // ...
    });
  };
};

// 修改后（✅ 正常显示）
import { App, Progress, ... } from 'antd';  // 改为 App

const CategoryFeaturesSection = () => {
  const { notification } = App.useApp();  // 添加这一行

  const handleSync = () => {
    notification.open({
      message: '批量同步进行中',
      description: <Progress percent={0} />,
      placement: 'bottomRight',  // 添加位置
      duration: 0,
      // ...
    });
  };
};
```

**notification.open() 的常用配置**：

```typescript
notification.open({
  key: 'unique-key',           // 唯一标识，用于更新通知
  message: '标题',              // 必填：通知标题
  description: '详细内容',      // 可选：通知内容
  placement: 'bottomRight',    // 重要：位置（bottomRight/topRight/bottomLeft/topLeft）
  duration: 0,                 // 0 = 不自动关闭；默认 4.5 秒
  icon: <SyncOutlined spin />, // 可选：自定义图标
  onClose: () => {},           // 可选：关闭回调
});

// 更新已存在的通知
notification.open({
  key: 'unique-key',  // 相同的 key 会更新通知而不是创建新的
  description: <Progress percent={50} />,
  // ...
});

// 关闭通知
notification.destroy('unique-key');
```

**验证方法**：

```typescript
// 添加调试日志
const handleSync = () => {
  console.log('notification object:', notification);
  console.log('notification.open:', notification.open);

  notification.open({
    message: '测试通知',
    placement: 'bottomRight',
  });

  // 检查 DOM
  setTimeout(() => {
    const notificationElement = document.querySelector('.ant-notification-bottomRight');
    console.log('通知元素:', notificationElement);
  }, 100);
};

// 预期输出：
// - notification object: { open: function, ... }
// - notification.open: function
// - 通知在右下角显示
// - 通知元素: <div class="ant-notification-bottomRight">...</div>
```

**相关文件**：
- `web/src/pages/system/components/GlobalSettingsTab.tsx:21,189,229-261` - 已修复
- `web/src/App.tsx` - 确保使用 `<App>` 组件包裹

**常见位置选项**：

| placement      | 描述       | 适用场景                |
|----------------|----------|---------------------|
| `bottomRight`  | 右下角（推荐）| 进度通知、成功提示         |
| `topRight`     | 右上角（默认）| 一般通知              |
| `bottomLeft`   | 左下角     | 次要通知              |
| `topLeft`      | 左上角     | 系统通知              |

**防止复发**：
- ✅ 统一使用 `App.useApp()` 获取 notification 实例
- ✅ 明确指定 `placement: 'bottomRight'` 避免位置错误
- ✅ 在 `CLAUDE.md` 中补充 notification 使用规范
- ✅ 代码审查：检查所有 notification 调用是否使用了 App.useApp()

**与 Modal.confirm 的对比**：

| 特性           | Modal.confirm()         | notification.open()      |
|--------------|------------------------|--------------------------|
| 用途          | 确认对话框（阻塞式）          | 通知提示（非阻塞式）            |
| 获取方式       | `App.useApp().modal`   | `App.useApp().notification` |
| 位置          | 屏幕中央                  | 四个角落（可配置）             |
| 自动关闭       | 否                      | 是（可配置）                |
| 用户交互       | 必须点击确认/取消            | 可选（可点击关闭或自动消失）       |

**参考资料**：
- [Ant Design v5 notification 组件文档](https://ant.design/components/notification-cn)
- [Ant Design v5 App 组件文档](https://ant.design/components/app-cn)
- [notification API 完整参数](https://ant.design/components/notification-cn#api)

---

## 后端问题

### Celery 异步任务报错 "Future attached to a different loop"

**问题描述**：
- Celery 任务执行失败，错误信息：`Task <Task pending ...> got Future <Future pending> attached to a different loop`
- 任务涉及异步操作（如使用 `asyncio`、`httpx.AsyncClient`、数据库异步会话等）
- 在 gevent pool 环境下运行时触发错误

**根本原因**：
1. **Celery Worker 使用 gevent pool** - gevent 会 monkey patch Python 标准库（包括 asyncio）
2. **多个 event loop 混用** - gevent 环境中创建的 asyncio event loop 与代码中的 event loop 不兼容
3. **Future 对象绑定到错误的 loop** - gevent patch 后，asyncio 的 Future 对象可能被绑定到不同的 event loop

**错误示例**：
```
Task <Task pending name='Task-62' coro=<_batch_sync_async()> ...>
got Future <Future pending cb=[Protocol._on_waiter_completed()]>
attached to a different loop
```

**排查步骤**：

```bash
# 1. 检查 Celery Worker 配置
grep "pool=gevent" supervisord.conf

# 2. 检查任务是否使用了 asyncio
grep -rn "async def\|await\|asyncio" plugins/ef/*/tasks/

# 3. 检查是否在多个地方创建了 event loop
grep -rn "asyncio.run\|asyncio.get_event_loop" ef_core/ plugins/
```

**解决方案**：

#### 方案 1（推荐 ✅）：改为 prefork pool

**优点**：
- ✅ 完全兼容 asyncio，无需额外配置
- ✅ Celery 的默认 pool，稳定可靠
- ✅ 支持 CPU 密集型任务
- ✅ 进程隔离，任务之间互不影响

**缺点**：
- ⚠️ 并发能力略低于 gevent（但对大多数场景足够）

**步骤**：

1. 修改 `supervisord.conf`，将 `--pool=gevent` 改为 `--pool=prefork`：

```ini
# 修改前
command=... --pool=gevent --concurrency=100

# 修改后
command=... --pool=prefork --concurrency=10
```

2. 重启 Celery Worker：

```bash
supervisorctl -c /path/to/supervisord.conf restart euraflow:celery_worker
```

3. 验证配置生效：

```bash
# 查看 worker 日志，确认使用的 pool 类型
supervisorctl tail -50 euraflow:celery_worker stdout | grep pool
```

#### 方案 2（不推荐 ❌）：配置 gevent 兼容 asyncio

**仅在必须使用 gevent 的场景下考虑**：

```python
# 在 celery_app.py 顶部添加
import gevent.monkey
gevent.monkey.patch_all(thread=False, socket=False)

# 或使用 gevent-friendly 的 asyncio 循环
import asyncio
import gevent_asyncio
asyncio.set_event_loop_policy(gevent_asyncio.EventLoopPolicy())
```

**风险**：
- ⚠️ 配置复杂，容易出错
- ⚠️ 可能导致其他兼容性问题
- ⚠️ 增加调试难度

#### 方案 3（特殊场景 ⚠️）：在线程池中创建新 event loop 时重置数据库引擎

**适用场景**：
- 已使用 prefork pool 但仍报 event loop 错误
- 任务代码使用 `ThreadPoolExecutor` 创建新线程运行异步代码
- 使用全局 `DatabaseManager` 单例

**问题根源**：
- `DatabaseManager` 是全局单例，其 `_async_engine` 绑定到创建时的 event loop
- 在新线程中创建新 event loop 后，旧的 engine 仍绑定到原 loop
- 导致 "Future attached to a different loop" 错误

**解决方法**：

在异步任务函数开始时，强制重置数据库引擎：

```python
async def _batch_sync_async(...):
    """异步批量同步（内部实现）"""
    from ef_core.database import get_db_manager

    try:
        db_manager = get_db_manager()

        # 强制重新创建异步引擎（确保绑定到当前 event loop）
        if db_manager._async_engine is not None:
            await db_manager._async_engine.dispose()
            db_manager._async_engine = None
            db_manager._async_session_factory = None
            logger.info("Disposed old async engine, creating new one for current event loop")

        async with db_manager.get_session() as db:
            # 正常的任务逻辑
            ...
```

**注意事项**：
- ⚠️ 这会关闭旧的数据库连接，可能影响其他正在使用的会话
- ⚠️ 仅在确实需要在新线程中运行异步代码时使用
- ✅ 更好的做法是避免在线程池中创建新 event loop，直接使用 Celery 的 prefork pool

**并发数建议**：

| Pool 类型 | 推荐并发数 | 适用场景 |
|----------|-----------|---------|
| prefork  | CPU 核心数 × 2-4（通常 8-16） | 通用任务，CPU 密集型任务 |
| gevent   | 100-500 | I/O 密集型任务（仅在不使用 asyncio 时） |
| solo     | 1 | 调试、测试 |

**防止复发**：
- ✅ 文档规范：已在 `FAQ.md` 中记录此问题
- ✅ 禁止混用：禁止在 gevent 环境中使用 asyncio（除非有明确配置）
- ✅ 优先 prefork：除非有特殊需求，否则统一使用 prefork pool

**相关文件**：
- `supervisord.conf:66` - Celery Worker 配置
- `ef_core/tasks/celery_app.py:314` - 插件初始化（使用 `asyncio.run()`）
- `plugins/ef/channels/ozon/tasks/batch_sync_task.py` - 批量同步任务

**参考资料**：
- [Celery Pool Types](https://docs.celeryq.dev/en/stable/userguide/workers.html#pool)
- [Gevent vs Asyncio](https://stackoverflow.com/questions/48622514/gevent-vs-asyncio)

---

### 如何添加新的后台定时任务服务

**问题描述**：
- 需要添加一个新的定时任务（如数据备份、定期同步等）
- 不清楚完整的添加流程
- 容易遗漏关键步骤导致任务不执行

**系统架构说明**：

EuraFlow 使用 **Celery Beat** 作为唯一的定时任务调度器：

```
插件 setup()
  ↓ 调用 hooks.register_cron()
  ↓ 注册到 TaskRegistry
  ↓ 添加到 Celery Beat schedule
  ↓ Celery Beat 定时触发
  ↓ Celery Worker 执行任务
```

**关键点**：
- ✅ 使用 Celery Beat（不要使用已废弃的 APScheduler）
- ✅ 通过插件的 `setup()` 函数注册任务
- ✅ 同时注册 Handler（用于 Web UI 手动触发）和 Celery Beat 任务（用于定时自动执行）
- ✅ 在数据库中创建服务记录（用于在 Web UI 展示）

**完整添加流程**：

#### 步骤1：在插件中注册 Handler 和 Celery Beat 任务

```python
# 文件：plugins/ef/{domain}/{plugin_name}/__init__.py

async def setup(hooks) -> None:
    """插件初始化函数"""
    from plugins.ef.system.sync_service.services.handler_registry import get_registry
    registry = get_registry()

    # 导入服务类
    from .my_service import MyService
    my_service = MyService()

    # 1. 注册 Handler（用于 Web UI 手动触发）
    registry.register(
        service_key="my_service_key",  # 唯一标识，必须与数据库记录一致
        handler=my_service.execute,    # 实际执行的函数
        name="我的服务",
        description="服务描述（会显示在 Web UI 中）",
        plugin="ef.domain.plugin_name",
        config_schema={  # 可选：配置参数的 JSON Schema
            "type": "object",
            "properties": {
                "max_count": {
                    "type": "integer",
                    "description": "最大数量",
                    "default": 100
                }
            }
        }
    )

    logger.info("✓ Registered handler: my_service_key")

    # 2. 注册 Celery Beat 定时任务（用于自动定时执行）
    async def my_service_task():
        """Celery Beat 定时任务包装函数"""
        return await my_service.execute({})

    await hooks.register_cron(
        name="ef.domain.my_service",  # Celery 任务名（格式：ef.{domain}.{service}）
        cron="0 2 * * *",              # Cron 表达式（UTC 时区）
        task=my_service_task
    )

    logger.info("✓ Registered Celery Beat task: ef.domain.my_service")
    logger.info(f"  - Schedule: 0 2 * * * (UTC)")
```

**Cron 表达式格式**：
```
┌───────────── 分钟 (0 - 59)
│ ┌─────────── 小时 (0 - 23)
│ │ ┌───────── 日期 (1 - 31)
│ │ │ ┌─────── 月份 (1 - 12)
│ │ │ │ ┌───── 星期 (0 - 6，0 = 周日)
│ │ │ │ │
* * * * *
```

**常用 Cron 表达式示例**：
- `*/5 * * * *` - 每 5 分钟
- `0 * * * *` - 每小时整点
- `0 2 * * *` - 每天 UTC 02:00（北京时间 10:00）
- `0 17,5 * * *` - 每天 UTC 17:00 和 05:00（北京时间 01:00 和 13:00）
- `0 0 * * 0` - 每周日午夜

#### 步骤2：在数据库中创建服务记录

```sql
-- 使用 psql 或通过 FastAPI 接口创建
INSERT INTO sync_services (
    service_key,          -- 必须与步骤1中的 service_key 一致
    service_name,
    service_description,
    service_type,         -- 固定为 'cron'
    schedule_config,      -- Cron 表达式（同步骤1）
    is_enabled,           -- true = 启用，false = 禁用
    run_count,            -- 初始为 0
    success_count,        -- 初始为 0
    error_count,          -- 初始为 0
    config_json,          -- JSON 配置（可选）
    created_at,
    updated_at
) VALUES (
    'my_service_key',
    '我的服务',
    '服务描述',
    'cron',
    '0 2 * * *',
    true,
    0,
    0,
    0,
    '{"max_count": 100}'::jsonb,
    NOW(),
    NOW()
);
```

#### 步骤3：在 routes.py 中添加任务名映射（用于手动触发）

```python
# 文件：plugins/ef/system/sync_service/api/routes.py

# 在 trigger_sync_service() 函数中的 task_name_mapping 字典中添加：
task_name_mapping = {
    # ... 其他映射 ...
    "my_service_key": "ef.domain.my_service",  # service_key -> Celery 任务名
}
```

**验证方法**：

```bash
# 1. 重启服务
./restart.sh

# 2. 检查 Celery Beat 日志，确认任务已注册
tail -100 logs/celery-beat.log | grep "my_service"

# 预期输出：
# 2025-11-01 14:51:05 [info] Plugin ef.domain.plugin_name registering cron task cron=0 2 * * * task_name=ef.domain.my_service
# 2025-11-01 14:51:05 [info] Added task to beat schedule: ef.domain.my_service
# 2025-11-01 14:51:05 [info]   📋 Registered task: ef.domain.my_service

# 3. 在 Web UI 中检查
# 访问：系统管理 → 后台服务管理
# 应该能看到新添加的服务，可以手动触发

# 4. 检查数据库
PGPASSWORD=euraflow_dev psql -h localhost -U euraflow -d euraflow \
  -c "SELECT service_key, service_name, is_enabled FROM sync_services WHERE service_key='my_service_key';"
```

**常见陷阱与错误**：

| 错误 | 症状 | 原因 | 解决方法 |
|------|------|------|----------|
| ❌ 只注册了 Handler，没注册 Celery Beat 任务 | Web UI 能看到服务，手动触发正常，但不会自动执行 | 忘记调用 `hooks.register_cron()` | 在 `setup()` 中添加 `hooks.register_cron()` |
| ❌ 只注册了 Celery Beat，没注册 Handler | 任务自动执行，但在 Web UI 中看不到，也无法手动触发 | 忘记调用 `registry.register()` | 在 `setup()` 中添加 `registry.register()` |
| ❌ 数据库记录的 service_key 与代码中不一致 | Web UI 显示错误，手动触发失败 | service_key 拼写错误或不匹配 | 确保 3 处 service_key 完全一致：代码 Handler、代码 Celery Beat、数据库 |
| ❌ task_name_mapping 中缺少映射 | 手动触发时报错 "Task not registered" | routes.py 中未添加映射 | 在 task_name_mapping 中添加映射 |
| ❌ Cron 表达式错误 | 任务不在预期时间执行 | Cron 格式错误或时区混淆 | 使用 [Crontab Guru](https://crontab.guru/) 验证表达式；注意 Celery 使用 UTC 时区 |
| ❌ 数据库记录缺少必填字段 | INSERT 失败，报 NOT NULL 约束错误 | 缺少 run_count、success_count、error_count | 初始化时设置为 0 |

**实际案例：database_backup 服务**

```python
# 文件：plugins/ef/system/database_backup/__init__.py

async def setup(hooks) -> None:
    from plugins.ef.system.sync_service.services.handler_registry import get_registry
    registry = get_registry()
    from .backup_service import DatabaseBackupService
    backup_service = DatabaseBackupService()

    # 1. 注册 Handler
    registry.register(
        service_key="database_backup",
        handler=backup_service.backup_database,
        name="数据库备份",
        description="备份PostgreSQL数据库到backups目录（每天北京时间01:00和13:00执行）",
        plugin="ef.system.database_backup"
    )

    # 2. 注册 Celery Beat 任务
    async def database_backup_task():
        return await backup_service.backup_database({})

    await hooks.register_cron(
        name="ef.system.database_backup",
        cron="0 17,5 * * *",  # UTC 17:00 和 05:00 = 北京时间 01:00 和 13:00
        task=database_backup_task
    )
```

```sql
-- 数据库记录
INSERT INTO sync_services (
    service_key, service_name, service_description,
    service_type, schedule_config, is_enabled,
    run_count, success_count, error_count, config_json,
    created_at, updated_at
) VALUES (
    'database_backup',
    '数据库备份',
    '备份PostgreSQL数据库到backups目录（每天北京时间01:00和13:00执行）',
    'cron',
    '0 17,5 * * *',
    true,
    0, 0, 0,
    '{"max_backups": 14}'::jsonb,
    NOW(), NOW()
);
```

```python
# routes.py 中的映射
task_name_mapping = {
    "database_backup": "ef.system.database_backup",
    # ...
}
```

**相关文件**：
- 插件入口：`plugins/ef/{domain}/{plugin}/__init__.py` - setup() 函数
- Handler 注册器：`plugins/ef/system/sync_service/services/handler_registry.py`
- 任务触发接口：`plugins/ef/system/sync_service/api/routes.py:157-226` - trigger_sync_service()
- Celery 配置：`ef_core/tasks/celery_app.py` - 自动加载插件注册的任务
- 数据库表：`sync_services` - 服务记录
- 日志位置：`logs/celery-beat.log` - Celery Beat 调度日志

**检查清单**：

在添加新服务后，确认以下事项：

- [ ] 在插件 `setup()` 中调用了 `registry.register()`（Handler 注册）
- [ ] 在插件 `setup()` 中调用了 `hooks.register_cron()`（Celery Beat 注册）
- [ ] service_key 在 3 处保持一致（Handler、Celery Beat、数据库）
- [ ] 在 routes.py 的 task_name_mapping 中添加了映射
- [ ] 在数据库中创建了服务记录（包含所有必填字段）
- [ ] Cron 表达式格式正确且符合预期（使用 UTC 时区）
- [ ] 重启服务后在 celery-beat.log 中看到 "Registered task: ef.xxx"
- [ ] 在 Web UI 的"后台服务管理"页面能看到新服务
- [ ] 手动触发测试成功（点击"触发"按钮后任务正常执行）
- [ ] 等待定时时间到达，确认任务自动执行

**防止复发**：
- ✅ 使用本检查清单验证每个新增服务
- ✅ 代码审查时确认 Handler 和 Celery Beat 任务都已注册
- ✅ 使用统一的服务模板（复制现有服务如 database_backup 作为起点）

**时区说明**：

Celery Beat 使用 **UTC 时区**，需要手动转换：

| 北京时间 | UTC 时间 | Cron 表达式 | 说明 |
|---------|---------|------------|------|
| 01:00   | 17:00（前一天） | `0 17 * * *` | 北京时间 - 8 小时 |
| 10:00   | 02:00   | `0 2 * * *` | 北京时间 - 8 小时 |
| 13:00   | 05:00   | `0 5 * * *` | 北京时间 - 8 小时 |
| 22:00   | 14:00   | `0 14 * * *` | 北京时间 - 8 小时 |

**参考资料**：
- [Celery Beat 文档](https://docs.celeryproject.org/en/stable/userguide/periodic-tasks.html)
- [Crontab Guru - Cron 表达式生成器](https://crontab.guru/)
- [SQLAlchemy AsyncSession](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html)

---

### N+1 查询问题导致 API 响应缓慢

**问题描述**：
- API 接口响应非常慢，像卡住了（例如 `/api/ef/v1/ozon/shops` 需要几秒甚至超时）
- 数据量不大（如几十个店铺），但查询速度随记录数线性增长
- 数据库 CPU 占用高，大量小查询并发执行

**根本原因**：
在循环中对每条记录执行单独的数据库查询（N+1 模式）：
- 1 次查询主表（如 shops）
- N 次查询关联数据（如每个 shop 的 products count 和 orders count）
- 总查询数：1 + (N × M)，其中 N 是记录数，M 是每条记录的关联查询数

**排查步骤**：

```python
# 1. 启用 SQLAlchemy 查询日志
# 在配置中添加：
import logging
logging.basicConfig()
logging.getLogger('sqlalchemy.engine').setLevel(logging.INFO)

# 2. 检查日志中是否有大量相似查询
# 示例：看到 50 个类似的 SELECT COUNT(*) FROM ozon_products WHERE shop_id = ?

# 3. 使用 Python 内置的性能分析工具
import time
start = time.time()
# ... 执行查询 ...
print(f"查询耗时: {time.time() - start:.2f}s")

# 4. 检查代码中的循环查询模式
# 搜索：for ... in ... 后面紧跟着 db.execute() 或 await db.execute()
```

**反模式示例**（❌ 错误）：

```python
# 文件：plugins/ef/channels/ozon/api/shop_routes.py (修复前)
async def get_shops_with_stats():
    # 1 次查询获取所有店铺
    shops = await db.execute(select(OzonShop))

    result = []
    for shop in shops:
        # N 次查询 - 每个店铺查询商品数量
        products_count = await db.execute(
            select(func.count()).select_from(OzonProduct)
            .where(OzonProduct.shop_id == shop.id)
        )

        # N 次查询 - 每个店铺查询订单数量
        orders_count = await db.execute(
            select(func.count()).select_from(OzonOrder)
            .where(OzonOrder.shop_id == shop.id)
        )

        result.append({
            "shop": shop,
            "products_count": products_count.scalar(),
            "orders_count": orders_count.scalar()
        })

    return result
    # 总查询数：1 + (N × 2)，如果 N=50，则 101 次查询！
```

**标准解决方案**（✅ 正确）：

```python
# 使用 GROUP BY 聚合批量查询
async def get_shops_with_stats():
    # 1. 查询所有店铺
    shops_result = await db.execute(select(OzonShop))
    shops = shops_result.scalars().all()
    shop_ids = [shop.id for shop in shops]

    # 2. 一次性查询所有店铺的商品数量（使用 GROUP BY）
    products_stmt = (
        select(
            OzonProduct.shop_id,
            func.count(OzonProduct.id).label('count')
        )
        .where(OzonProduct.shop_id.in_(shop_ids))
        .group_by(OzonProduct.shop_id)
    )
    products_result = await db.execute(products_stmt)
    products_count_map = {row.shop_id: row.count for row in products_result}

    # 3. 一次性查询所有店铺的订单数量（使用 GROUP BY）
    orders_stmt = (
        select(
            OzonOrder.shop_id,
            func.count(OzonOrder.id).label('count')
        )
        .where(OzonOrder.shop_id.in_(shop_ids))
        .group_by(OzonOrder.shop_id)
    )
    orders_result = await db.execute(orders_stmt)
    orders_count_map = {row.shop_id: row.count for row in orders_result}

    # 4. 组装结果（内存操作，不再查询数据库）
    result = []
    for shop in shops:
        result.append({
            "shop": shop,
            "products_count": products_count_map.get(shop.id, 0),
            "orders_count": orders_count_map.get(shop.id, 0)
        })

    return result
    # 总查询数：3 次（无论 N 多大）
```

**性能对比**：

| 店铺数量 | N+1 模式查询次数 | GROUP BY 查询次数 | 性能提升 |
|---------|----------------|------------------|---------|
| 10      | 21             | 3                | 7x      |
| 50      | 101            | 3                | 33x     |
| 100     | 201            | 3                | 67x     |

**验证方法**：

```python
# 方法1：统计实际执行的 SQL 查询数量
import logging
from sqlalchemy import event
from sqlalchemy.engine import Engine

query_count = 0

@event.listens_for(Engine, "before_cursor_execute")
def receive_before_cursor_execute(conn, cursor, statement, params, context, executemany):
    global query_count
    query_count += 1

# 执行测试
query_count = 0
result = await get_shops_with_stats()
print(f"总查询次数: {query_count}")  # 预期：3

# 方法2：测量响应时间
import time
start = time.time()
result = await get_shops_with_stats()
print(f"响应时间: {(time.time() - start) * 1000:.0f}ms")  # 预期：< 100ms
```

**相关文件**：
- `plugins/ef/channels/ozon/api/shop_routes.py:77-117` - 已优化
- `plugins/ef/channels/ozon/services/ozon_sync.py:321-328` - 仓库映射查询（已使用预加载）

**通用优化模式**：

```python
# 模式1：使用 IN 查询 + GROUP BY
ids = [item.id for item in items]
counts = await db.execute(
    select(RelatedTable.item_id, func.count())
    .where(RelatedTable.item_id.in_(ids))
    .group_by(RelatedTable.item_id)
)
count_map = {row.item_id: row.count for row in counts}

# 模式2：使用 joinedload (适用于 ORM 关系)
stmt = select(Parent).options(joinedload(Parent.children))
results = await db.execute(stmt)

# 模式3：使用 selectinload (适用于一对多关系)
stmt = select(Parent).options(selectinload(Parent.children))
results = await db.execute(stmt)

# 模式4：使用子查询
subquery = (
    select(RelatedTable.parent_id, func.count().label('count'))
    .group_by(RelatedTable.parent_id)
    .subquery()
)
stmt = select(Parent, subquery.c.count).outerjoin(subquery)
```

**防止复发**：
- ✅ 代码审查：识别 `for` 循环内的数据库查询
- ✅ 性能测试：API 响应时间必须 < 500ms（单接口）
- ✅ 查询监控：统计每个接口的数据库查询次数
- ✅ 开发规范：禁止在循环中执行同步/异步数据库查询（除非有明确理由并注释说明）

**参考资料**：
- [SQLAlchemy Loading Techniques](https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html)
- [The N+1 Query Problem](https://stackoverflow.com/questions/97197/what-is-the-n1-selects-problem)
- [FastAPI Performance Best Practices](https://fastapi.tiangolo.com/async/)

---

### Celery 定时任务报错 "got an unexpected keyword argument '_plugin'"

**问题描述**：
- 所有定时任务执行失败，Celery Worker 日志中出现 `TypeError`
- 错误信息：`xxx_task() got an unexpected keyword argument '_plugin'`
- 新添加的定时任务从未执行过（显示为"未运行"）

**根本原因**：
- 任务注册表 `ef_core/tasks/registry.py` 会自动向所有任务函数注入 `_plugin` 参数（用于插件上下文传递）
- 但插件中定义的任务函数没有接收此参数，导致 Python 抛出 `TypeError`

**技术细节**：

```python
# ef_core/tasks/registry.py:76
def _create_celery_task(async_func, plugin_name=None):
    def task_func(*args, **kwargs):
        if plugin_name:
            kwargs["_plugin"] = plugin_name  # ⚠️ 自动注入 _plugin 参数
        result = asyncio.run(async_func(*args, **kwargs))
        return result
    return task_func

# 插件中的任务函数（错误）
async def my_task() -> None:  # ❌ 缺少 **kwargs
    """我的任务"""
    # ...
```

**排查步骤**：

```bash
# 1. 检查 Celery Worker 错误日志
supervisorctl tail -200 euraflow:celery_worker stderr

# 预期输出（错误示例）：
# [ERROR/ForkPoolWorker-1] Task ef.ozon.orders.pull[xxx] raised unexpected: TypeError('pull_orders_task() got an unexpected keyword argument '_plugin'')

# 2. 检查 Celery Beat 日志，确认任务是否正常调度
supervisorctl tail -100 euraflow:celery_beat stdout | grep "Scheduler: Sending"

# 预期输出：
# [2025-11-04 14:00:00,123: INFO] Scheduler: Sending due task ef.ozon.orders.pull

# 3. 检查任务函数签名
grep -A 5 "async def.*task(" plugins/ef/channels/ozon/__init__.py

# 4. 查看已注册的任务列表
./venv/bin/python -c "from ef_core.tasks.celery_app import celery_app; print(list(celery_app.conf.beat_schedule.keys()))"
```

**标准解决方案**：

#### 方案 A：修改任务函数签名（推荐 ✅）

所有通过 `hooks.register_cron()` 注册的任务函数必须接受 `**kwargs` 参数：

```python
# ✅ 正确：接受 **kwargs 参数
async def my_task(**kwargs) -> None:
    """我的任务"""
    # 可选：获取插件名称
    plugin_name = kwargs.get('_plugin')
    logger.info(f"Task running from plugin: {plugin_name}")

    # 任务逻辑
    # ...

# 注册任务
await hooks.register_cron(
    name="ef.my.task",
    cron="0 * * * *",
    task=my_task
)
```

**修复清单（受影响的任务）**：

```python
# 需要修改的任务函数：

# 1. plugins/ef/channels/ozon/__init__.py
async def pull_orders_task(**kwargs) -> None:  # 添加 **kwargs
async def sync_inventory_task(**kwargs) -> None:
async def kuajing84_material_cost_task(**kwargs):
async def ozon_finance_sync_task(**kwargs):
async def ozon_finance_transactions_task(**kwargs):

# 2. plugins/ef/channels/ozon/tasks/promotion_sync_task.py
async def sync_all_promotions(**kwargs) -> Dict[str, Any]:  # 替换原有的 config 参数
async def promotion_health_check(**kwargs) -> Dict[str, Any]:
```

**验证方法**：

```bash
# 1. 本地测试
./restart.sh

# 2. 检查 Celery Beat 日志，确认任务已加载
supervisorctl tail -100 euraflow:celery_beat stdout | grep "Registered task"

# 预期输出：
#   📋 Registered task: ef.ozon.orders.pull
#   📋 Registered task: ef.ozon.inventory.sync
#   📋 Registered task: ef.ozon.category.sync
#   📋 Registered task: ef.ozon.attributes.sync

# 3. 手动触发任务（测试执行）
./venv/bin/python -c "from ef_core.tasks.celery_app import celery_app; celery_app.send_task('ef.ozon.orders.pull')"

# 4. 检查 Celery Worker 日志，确认任务执行成功
supervisorctl tail -50 euraflow:celery_worker stdout

# 预期输出：
# [INFO] Task ef.ozon.orders.pull[xxx] succeeded in 2.5s

# 5. 检查数据库，验证任务有执行记录
PGPASSWORD=euraflow_dev psql -h localhost -U euraflow -d euraflow \
  -c "SELECT task_id, status, started_at FROM task_results ORDER BY started_at DESC LIMIT 10;"
```

**常见错误与解决**：

| 错误症状 | 原因 | 解决方法 |
|---------|------|----------|
| `TypeError: xxx() got an unexpected keyword argument '_plugin'` | 任务函数缺少 `**kwargs` 参数 | 在函数签名中添加 `**kwargs` |
| 任务从未执行过（"未运行"） | 函数签名不匹配导致任务启动就失败 | 修复签名后重启服务 |
| 部分任务正常，部分任务失败 | 只修复了部分任务函数 | 检查所有任务函数，确保都有 `**kwargs` |

**相关文件**：
- 任务注册表：`ef_core/tasks/registry.py:76` - `_create_celery_task()` 自动注入 `_plugin`
- 插件入口：`plugins/ef/channels/ozon/__init__.py:555-590` - 任务函数定义
- 促销任务：`plugins/ef/channels/ozon/tasks/promotion_sync_task.py:28,245` - `sync_all_promotions()`, `promotion_health_check()`
- Celery 日志：`logs/celery-worker-stderr.log` - 错误日志
- Celery Beat 日志：`logs/celery-beat.log` - 调度日志

**防止复发**：
- ✅ 所有新增的任务函数必须包含 `**kwargs` 参数（即使不使用）
- ✅ 代码审查：检查任务函数签名是否正确
- ✅ 在 `CLAUDE.md` 中补充任务函数签名规范
- ✅ 添加单元测试：验证所有注册的任务可以接受 `_plugin` 参数

**参考资料**：
- [Celery Task Signatures](https://docs.celeryproject.org/en/stable/userguide/calling.html#signatures)
- [Python **kwargs](https://realpython.com/python-kwargs-and-args/)

---

---

## 数据库问题

### (待补充)

---

## 部署问题

### (待补充)

---

## 如何贡献

遇到新的疑难问题时，请按以下格式添加到对应分类：

```markdown
### 问题标题（简洁描述）

**问题描述**：
- 现象1
- 现象2

**根本原因**：
（技术原理层面的解释）

**排查步骤**：
（如何定位问题的命令/方法）

**标准解决方案**：
（分步骤的修复方法，附代码示例）

**验证方法**：
（如何确认问题已解决）

**相关文件**：
（涉及的文件路径和行号）

**防止复发**：
（预防措施）

**参考资料**：
（相关文档链接）
```

---

**最后更新**: 2025-11-13
**维护者**: EuraFlow 开发团队
