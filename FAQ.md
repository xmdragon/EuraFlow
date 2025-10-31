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
  - [N+1 查询问题导致 API 响应缓慢](#n1-查询问题导致-api-响应缓慢)
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

**最后更新**: 2025-10-30
**维护者**: EuraFlow 开发团队
