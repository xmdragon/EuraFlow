# EuraFlow 常见问题与解决方案 (FAQ)

> **用途**：记录项目开发中反复出现的疑难问题、排查思路和解决方案
>
> **使用原则**：遇到问题时先查阅本文档，避免重复踩坑

---

## 目录

- [前端问题](#前端问题)
  - [Ant Design Modal.confirm 不弹出](#ant-design-modalconfirm-不弹出)
  - [Ant Design notification 不显示或显示位置错误](#ant-design-notification-不显示或显示位置错误)
  - [浏览器扩展 CORS 跨域请求错误](#浏览器扩展-cors-跨域请求错误)
  - [Ant Design Table 页面出现横向滚动条](#ant-design-table-页面出现横向滚动条)
- [后端问题](#后端问题)
  - [Celery 异步任务报错 "Future attached to a different loop"](#celery-异步任务报错-future-attached-to-a-different-loop)
  - [Celery 插件初始化时的事件循环冲突导致数据库连接失败](#celery-插件初始化时的事件循环冲突导致数据库连接失败)
  - [如何添加新的后台定时任务服务](#如何添加新的后台定时任务服务)
  - [N+1 查询问题导致 API 响应缓慢](#n1-查询问题导致-api-响应缓慢)
  - [Celery 定时任务报错 "got an unexpected keyword argument '_plugin'"](#celery-定时任务报错-got-an-unexpected-keyword-argument-_plugin)
  - [前端传日期范围导致时区理解错误](#前端传日期范围导致时区理解错误)
  - [如何正确实现 OZON API 请求（新手必读）](#如何正确实现-ozon-api-请求新手必读)
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

### 浏览器扩展 CORS 跨域请求错误

**问题描述**：
- 浏览器扩展的 content script 直接使用 `fetch()` 发送 API 请求时，被 CORS 策略阻止
- 控制台报错：`Access to fetch at 'https://euraflow.hjdtrading.com/api/...' from origin 'https://www.ozon.ru' has been blocked by CORS policy`
- 错误详情：`No 'Access-Control-Allow-Origin' header is present on the requested resource`
- 请求状态：`net::ERR_FAILED`

**根本原因**：
1. **浏览器 CORS 策略** - Content script 在网页上下文中运行，受同源策略限制
2. **跨域请求被阻止** - 从 `ozon.ru` 向 `euraflow.hjdtrading.com` 发送请求是跨域行为
3. **fetch() 受限** - Content script 中的 `fetch()` 无法绕过 CORS 限制

**错误示例**：

```typescript
// ❌ 错误：在 content script 中直接使用 fetch（会触发 CORS 错误）
// 文件：src/content/price-calculator/display.ts

const response = await fetch(`${config.apiUrl}/api/ef/v1/ozon/collection-records/collect`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': config.apiKey,
  },
  body: JSON.stringify(requestData),
});

// ❌ 报错：
// Access to fetch at 'https://euraflow.hjdtrading.com/...'
// from origin 'https://www.ozon.ru' has been blocked by CORS policy
```

**排查步骤**：

```bash
# 1. 检查是否在 content script 中直接使用 fetch
grep -rn "fetch.*api/ef" plugins/ef/channels/ozon/browser_extension/src/content/

# 2. 检查浏览器控制台的 Network 面板
# 查看请求状态是否为 CORS error 或 (failed)

# 3. 检查是否已经在 background service worker 中添加消息处理
grep -n "COLLECT_PRODUCT\|QUICK_PUBLISH" plugins/ef/channels/ozon/browser_extension/src/background/service-worker.ts
```

**标准解决方案**：

#### 方法1：通过 Background Service Worker 发送请求（推荐 ✅）

浏览器扩展的 **background service worker** 不受 CORS 限制，可以向任意域发送请求。

**实现步骤**：

**步骤1：在 service-worker.ts 中添加消息处理**

```typescript
// 文件：src/background/service-worker.ts

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'COLLECT_PRODUCT') {
    // 处理采集商品请求
    handleCollectProduct(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // 保持消息通道开启（异步响应）
  }

  // 其他消息处理...
});

/**
 * 采集商品
 */
async function handleCollectProduct(data: {
  apiUrl: string;
  apiKey: string;
  source_url: string;
  product_data: any
}) {
  const { apiUrl, apiKey, source_url, product_data } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/ozon/collection-records/collect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({ source_url, product_data })
  });

  if (!response.ok) {
    let errorMessage = '采集失败';
    try {
      const errorData = await response.json();
      // 多层级解析错误信息
      if (errorData.detail?.detail) {
        errorMessage = errorData.detail.detail;
      } else if (typeof errorData.detail === 'string') {
        errorMessage = errorData.detail;
      }
    } catch {
      errorMessage = `服务器错误 (HTTP ${response.status})`;
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}
```

**步骤2：在 content script 中发送消息**

```typescript
// 文件：src/content/price-calculator/display.ts

// ✅ 正确：通过 chrome.runtime.sendMessage 发送消息
const response = await chrome.runtime.sendMessage({
  type: 'COLLECT_PRODUCT',
  data: {
    apiUrl: config.apiUrl,
    apiKey: config.apiKey,
    source_url: window.location.href,
    product_data: product
  }
});

if (!response.success) {
  throw new Error(response.error || '采集失败');
}

alert('✓ 商品已采集，请到系统采集记录中查看');
```

**优点**：
- ✅ 不受 CORS 限制（service worker 拥有特殊权限）
- ✅ 代码清晰，职责分离（content script 负责 UI，service worker 负责请求）
- ✅ 安全（API Key 在 service worker 中处理，不暴露给页面）
- ✅ 统一管理所有 API 请求

#### 方法2：使用 ApiClient 封装（最佳实践 ⭐）

对于需要频繁发送请求的场景，建议封装成 `ApiClient` 类：

```typescript
// 文件：src/shared/api-client.ts

/**
 * EuraFlow API 客户端
 *
 * 通过 background service worker 发送请求（绕过 CORS 限制）
 */
export class ApiClient {
  constructor(
    private apiUrl: string,
    private apiKey: string
  ) {}

  /**
   * 采集商品
   */
  async collectProduct(source_url: string, product_data: any): Promise<any> {
    return this.sendRequest('COLLECT_PRODUCT', { source_url, product_data });
  }

  /**
   * 快速上架商品
   */
  async quickPublish(data: QuickPublishRequest): Promise<QuickPublishResponse> {
    return this.sendRequest('QUICK_PUBLISH', { data });
  }

  /**
   * 通过 Service Worker 发送 API 请求（绕过 CORS 限制）
   */
  private async sendRequest(type: string, payload: any): Promise<any> {
    const response = await chrome.runtime.sendMessage({
      type,
      data: {
        apiUrl: this.apiUrl,
        apiKey: this.apiKey,
        ...payload
      }
    });

    if (!response.success) {
      throw new Error(response.error || '请求失败');
    }

    return response.data;
  }
}
```

**使用示例**：

```typescript
// 在 content script 中使用
import { ApiClient } from '../../shared/api-client';
import { getApiConfig } from '../../shared/storage';

const config = await getApiConfig();
const apiClient = new ApiClient(config.apiUrl, config.apiKey);

// 发送请求
const result = await apiClient.collectProduct(window.location.href, productData);
```

**为什么这样可以解决 CORS 问题？**

浏览器扩展的 **background service worker** 拥有特殊权限：
- ✅ 不受 CORS 策略限制
- ✅ 可以向任意域发送请求
- ✅ 在 `manifest.json` 中声明了 `host_permissions`

**请求路径对比**：

```
❌ 直接请求（会触发 CORS 错误）：
Content Script (ozon.ru) → fetch() → API (euraflow.hjdtrading.com) ✗ CORS error

✅ 通过 service worker 请求（不受 CORS 限制）：
Content Script (ozon.ru)
  → chrome.runtime.sendMessage
    → Background Service Worker
      → fetch() → API (euraflow.hjdtrading.com) ✓ Success
```

**manifest.json 配置**：

确保 `manifest.json` 中声明了 `host_permissions`：

```json
{
  "manifest_version": 3,
  "name": "EuraFlow OZON Selector",
  "version": "1.0.0",
  "permissions": [
    "storage",
    "activeTab"
  ],
  "host_permissions": [
    "https://euraflow.hjdtrading.com/*",
    "https://*.ozon.ru/*"
  ],
  "background": {
    "service_worker": "service-worker-loader.js",
    "type": "module"
  }
}
```

**检查清单**：

- [ ] ✅ service-worker.ts 中已添加消息处理（如 `COLLECT_PRODUCT`）
- [ ] ✅ content script 使用 `chrome.runtime.sendMessage` 发送消息
- [ ] ✅ manifest.json 中声明了 `host_permissions`
- [ ] ✅ 所有 API 请求都通过 service worker 发送（不在 content script 中直接使用 `fetch`）

**相关文件**：
- 浏览器扩展目录：`plugins/ef/channels/ozon/browser_extension/`
- Service Worker：`src/background/service-worker.ts`
- API Client：`src/shared/api-client.ts`
- Content Script：`src/content/price-calculator/display.ts`

**参考资料**：
- [Chrome Extension Manifest V3 - Cross-origin requests](https://developer.chrome.com/docs/extensions/mv3/xhr/)
- [Chrome Extension - Message passing](https://developer.chrome.com/docs/extensions/mv3/messaging/)
- [MDN - CORS](https://developer.mozilla.org/zh-CN/docs/Web/HTTP/CORS)

**防止复发**：
- ✅ 所有浏览器扩展的 API 请求统一使用 `ApiClient` 类
- ✅ 禁止在 content script 中直接使用 `fetch()` 发送跨域请求
- ✅ 在 `CLAUDE.md` 中补充浏览器扩展开发规范
- ✅ 代码审查：检查所有 content script 是否使用了 `chrome.runtime.sendMessage`

---

### Ant Design Table 页面出现横向滚动条

**问题描述**：
- 页面出现横向滚动条，影响用户体验
- 表格列宽度总和超过容器宽度
- 在小屏幕或窄屏设备上尤其明显

**根本原因**：
- Table 组件的列宽度固定值总和过大（如：100px + 200px + 180px + 280px = 760px）
- 加上自适应列的宽度，总宽度可能超过视口
- 没有配置 `scroll` 属性，导致整个页面产生横向滚动条

**解决方案**：

1. **添加 `scroll={{ x: true }}` 配置**（推荐）：
```tsx
<Table
  columns={columns}
  dataSource={data}
  scroll={{ x: true }}  // 启用表格内横向滚动
  pagination={...}
/>
```

**效果**：
- 表格内容在 Card 容器内横向滚动
- 页面本身不会出现横向滚动条
- 在小屏幕上可以左右滑动查看完整表格

2. **优化列宽度**（可选）：
```tsx
const columns = [
  {
    title: '商品图片',
    width: 100,  // 固定宽度
  },
  {
    title: '商品标题',
    ellipsis: true,  // 超长文本显示省略号
    // 不设置 width，自适应剩余空间
  },
  {
    title: '操作',
    width: 200,  // 适当减小固定宽度
    fixed: 'right',  // 固定在右侧（可选）
  },
];
```

**参考示例**：
- `web/src/pages/ozon/ProductList.tsx:437` - 商品列表使用 `scroll={{ x: true }}`
- `web/src/pages/ozon/ChatDetail.tsx:815` - 聊天详情使用 `scroll={{ x: true }}`

**验证方法**：
```bash
# 查找项目中所有使用 scroll 的 Table
grep -rn "scroll.*x.*true" web/src/pages/ozon/*.tsx
```

**防止复发**：
- ✅ 所有包含多列的 Table 组件都应添加 `scroll={{ x: true }}`
- ✅ 合理设置列宽度，避免固定宽度列过多
- ✅ 对超长文本列启用 `ellipsis: true`
- ✅ 代码审查：检查新增的 Table 组件是否配置了 scroll 属性

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

### Celery 插件初始化时的事件循环冲突导致数据库连接失败

**问题描述**：
- Celery Worker 导入 `celery_app.py` 时，报 `RuntimeError: asyncio.run() cannot be called from a running event loop`
- 尝试使用线程隔离初始化后，FastAPI 应用启动失败：`RuntimeError: Database connection failed`
- 数据库连接检查 `db_manager.check_connection()` 失败，但数据库本身运行正常

**发生场景**：
1. Celery Worker 使用 uvloop 作为事件循环
2. 导入 `ef_core.tasks.celery_app` 时，模块级代码执行插件初始化
3. 插件初始化需要执行异步操作（`asyncio.run()`）
4. 但此时 Celery Worker 的 uvloop 已经在运行中

**根本原因**：

#### 第一层问题：事件循环冲突
- Celery Worker（特别是 Beat）在导入模块时已有运行中的事件循环（uvloop）
- 模块级代码调用 `asyncio.run()` 时，检测到已有运行中的事件循环，抛出错误

#### 第二层问题：线程隔离导致数据库管理器单例失效
当使用线程隔离方案（在新线程中创建独立事件循环）时：

1. **插件初始化访问数据库**：
   - OZON 插件的 `setup()` 函数会从数据库读取店铺配置
   - 调用 `get_db_manager()` 创建数据库管理器单例
   - 数据库引擎绑定到**子线程的事件循环**

2. **子线程结束后，数据库引擎失效**：
   - 子线程关闭事件循环后退出
   - 数据库管理器单例仍然存在，但其 `_async_engine` 绑定到已关闭的事件循环

3. **主进程无法使用数据库**：
   - FastAPI 应用启动，调用 `db_manager.check_connection()`
   - 尝试使用已有的数据库管理器单例
   - 但其异步引擎绑定到已关闭的事件循环
   - 数据库连接检查失败

**错误示例**：

```
# Celery Worker 启动时
RuntimeError: asyncio.run() cannot be called from a running event loop

# 使用线程隔离后，FastAPI 启动时
ERROR:    Database connection check failed
RuntimeError: Database connection failed
```

**排查步骤**：

```bash
# 1. 确认 Celery Worker 使用的事件循环类型
supervisorctl tail -100 euraflow:celery_worker stdout | grep -i "uvloop\|eventloop"

# 2. 检查插件初始化是否访问数据库
grep -A 20 "async def setup" plugins/ef/channels/ozon/__init__.py | grep "get_db_manager"

# 3. 检查数据库管理器何时被创建
grep -rn "get_db_manager()" ef_core/tasks/celery_app.py plugins/ef/channels/ozon/__init__.py

# 4. 验证数据库本身是否正常（排除数据库问题）
psql -h localhost -U <user> -d <database> -c "SELECT 1;"
```

**解决方案对比**：

| 方案 | 优点 | 缺点 | 是否采用 |
|-----|------|------|---------|
| **简单新建事件循环** | 实现简单，远程已验证可行 | 理论上可能与 uvloop 冲突 | ✅ 当前使用 |
| **线程隔离** | 完全隔离事件循环 | 数据库管理器单例失效 | ❌ 失败 |
| **延迟初始化** | 避免模块级异步操作 | 需重构初始化流程 | 🔄 长期方案 |
| **分离 Beat/Worker** | Beat 不需要初始化插件 | 架构调整较大 | 🔄 长期方案 |

**当前采用方案**（简单新建事件循环 ✅）：

```python
# ef_core/tasks/celery_app.py

try:
    task_registry = asyncio.run(async_init())
except RuntimeError as e:
    if "cannot be called from a running event loop" in str(e):
        # Celery worker 环境中已有运行中的事件循环
        # 创建新的事件循环来执行初始化
        logger.warning("Detected running event loop, creating new event loop for plugin initialization")
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            task_registry = loop.run_until_complete(async_init())
        finally:
            loop.close()
    else:
        raise
```

**优点**：
- ✅ 实现简单，代码改动最小
- ✅ 远程生产环境已验证稳定运行（40+ 分钟无错误）
- ✅ 不影响现有架构

**理论风险**：
- ⚠️ 在 uvloop 环境中创建 asyncio 原生事件循环，理论上可能有兼容性问题
- ⚠️ 但实际部署中未出现问题

**长期优化方案**（避免问题根源）：

#### 方案 1：延迟初始化（推荐 ✅）

不在模块级别执行插件初始化，而是在 Celery Worker 完全启动后初始化：

```python
# ef_core/tasks/celery_app.py

# 模块级别：不执行初始化，只定义函数
task_registry = None

@signals.worker_ready.connect
def initialize_plugins_on_worker_ready(**kwargs):
    """Worker 启动完成后初始化插件"""
    global task_registry

    # 此时 Celery Worker 已完全启动，可以安全地执行异步操作
    task_registry = asyncio.run(async_init())
    logger.info(f"Initialized {len(task_registry.registered_tasks)} tasks")
```

**优点**：
- ✅ 避免模块导入时执行异步操作
- ✅ Worker 启动完成后，事件循环状态稳定
- ✅ 符合 Celery 最佳实践

**需要调整**：
- 确保 Beat 调度器能访问任务注册表
- 可能需要分离 Beat 和 Worker 的初始化逻辑

#### 方案 2：插件初始化不访问数据库（推荐 ✅）

插件的 `setup()` 函数应该只注册任务，不应该从数据库读取配置：

```python
# 当前实现（不推荐 ❌）
async def setup(hooks) -> None:
    """插件初始化函数"""
    from ef_core.database import get_db_manager  # ❌ 访问数据库
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        shops = await db.execute(select(OzonShop))  # ❌ 查询数据库
        for shop in shops:
            await hooks.register_cron(...)  # 为每个店铺注册任务

# 改进实现（推荐 ✅）
async def setup(hooks) -> None:
    """插件初始化函数"""
    # ✅ 只注册任务函数，不访问数据库
    await hooks.register_cron(
        name="ef.ozon.orders.pull",
        cron="*/5 * * * *",
        task=pull_orders_for_all_shops  # 任务内部再查询店铺列表
    )

async def pull_orders_for_all_shops():
    """拉取所有店铺的订单（任务执行时查询店铺列表）"""
    from ef_core.database import get_db_manager
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        shops = await db.execute(select(OzonShop))
        for shop in shops:
            await pull_orders_for_shop(shop.id)
```

**优点**：
- ✅ 插件初始化不访问数据库，避免单例绑定问题
- ✅ 任务执行时才访问数据库，事件循环状态稳定
- ✅ 符合"延迟初始化"原则

#### 方案 3：分离 Beat 和 Worker 初始化

Celery Beat 只需要调度配置，不需要初始化完整的插件系统：

```python
# ef_core/tasks/celery_app.py

import sys

if "celery" in sys.argv and "beat" in sys.argv:
    # Celery Beat 进程：只加载调度配置，不初始化插件
    logger.info("Celery Beat: Loading schedule from database")
    # 加载调度配置的逻辑
else:
    # Celery Worker 进程：完整初始化插件
    logger.info("Celery Worker: Initializing plugins")
    _initialize_plugins_for_celery()
```

**优点**：
- ✅ Beat 进程更轻量，启动更快
- ✅ 减少 Beat 进程的依赖和潜在错误

**防止复发**：

1. **短期**（已完成 ✅）：
   - ✅ 使用简单的新建事件循环方案
   - ✅ 记录到 FAQ.md（本章节）

2. **中期**（建议实施 🔄）：
   - 🔄 重构插件 `setup()` 函数，不访问数据库
   - 🔄 任务执行时动态查询配置

3. **长期**（可选 ⚠️）：
   - ⚠️ 使用 `worker_ready` 信号延迟初始化
   - ⚠️ 分离 Beat 和 Worker 的初始化逻辑

**相关文件**：
- `ef_core/tasks/celery_app.py:433-450` - 事件循环冲突处理
- `plugins/ef/channels/ozon/__init__.py:setup()` - 插件初始化（访问数据库）
- `ef_core/database.py:145-153` - 数据库管理器单例

**相关问题**：
- [Celery 异步任务报错 "Future attached to a different loop"](#celery-异步任务报错-future-attached-to-a-different-loop) - 类似的事件循环问题

**参考资料**：
- [Celery Signals](https://docs.celeryq.dev/en/stable/userguide/signals.html#worker-ready)
- [Asyncio Event Loop](https://docs.python.org/3/library/asyncio-eventloop.html)
- [SQLAlchemy Async Engine](https://docs.sqlalchemy.org/en/20/orm/extensions/asyncio.html#binding-metadata-to-an-engine)

---

### 如何添加新的 Celery 定时任务（最佳实践 - 避免事件循环冲突）

**问题描述**：
- 需要添加新的 Celery 定时任务
- 想避免重复踩坑（事件循环冲突、数据库连接失败等）
- 希望遵循项目最佳实践

**本章节目标**：
- ✅ 提供完整的代码模板（可直接复制粘贴）
- ✅ 明确禁止事项和正确做法
- ✅ 提供检查清单（Code Review 用）
- ✅ 避免将来重复犯错

---

#### 禁止事项（❌ 必须避免）

##### ❌ 禁止 1：插件 setup() 中访问数据库

```python
# ❌ 错误示例
async def setup(hooks) -> None:
    from ef_core.database import get_db_manager
    db_manager = get_db_manager()  # ❌ 创建数据库管理器单例

    async with db_manager.get_session() as db:
        # ❌ 查询数据库获取配置
        config = await db.execute(select(Config))
```

**后果**：
- 导致数据库管理器单例绑定到错误的事件循环
- FastAPI 应用启动时数据库连接检查失败
- 详见 FAQ："Celery 插件初始化时的事件循环冲突导致数据库连接失败"

##### ❌ 禁止 2：在同一任务中多次创建事件循环

```python
# ❌ 错误示例
@celery_app.task
def bad_task():
    loop1 = asyncio.new_event_loop()
    loop1.run_until_complete(task1())
    loop1.close()

    loop2 = asyncio.new_event_loop()  # ❌ 多次创建
    loop2.run_until_complete(task2())
    loop2.close()
```

**后果**：
- 浪费资源
- 可能导致事件循环状态混乱

##### ❌ 禁止 3：使用 gevent pool

```bash
# supervisord.conf
# ❌ 错误
command=celery worker --pool=gevent
```

**后果**：
- gevent 与 asyncio 冲突
- 触发 "Future attached to a different loop" 错误

---

#### 正确做法（✅ 标准模板）

##### ✅ 步骤 1：插件 setup() 注册任务（不访问数据库）

```python
# plugins/ef/xxx/__init__.py

async def setup(hooks) -> None:
    """
    插件初始化函数

    ✅ 只注册任务，不访问数据库
    """

    # 直接注册任务，使用硬编码的默认 cron
    await hooks.register_cron(
        name="ef.xxx.my_task",
        cron="*/30 * * * *",  # 硬编码默认值（每30分钟）
        task=my_task
    )
```

##### ✅ 步骤 2：任务函数使用标准模板

```python
# plugins/ef/xxx/tasks/my_task.py

from ef_core.tasks.celery_app import celery_app
import asyncio
import logging

logger = logging.getLogger(__name__)

@celery_app.task(bind=True, name="ef.xxx.my_task")
def my_task(self, **kwargs):
    """
    Celery 任务标准模板

    说明：
    1. 任务函数本身是同步的（def，不是 async def）
    2. 内部创建独立的事件循环来运行异步逻辑
    3. 任务结束时正确清理事件循环
    """

    def run_async():
        """在独立事件循环中运行异步逻辑"""
        # 创建新的事件循环
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

        try:
            # 运行异步逻辑
            return loop.run_until_complete(async_logic())
        finally:
            # 关闭事件循环
            loop.close()
            # 清理事件循环引用（重要！）
            asyncio.set_event_loop(None)

    return run_async()


async def async_logic():
    """异步业务逻辑"""
    from ef_core.database import get_db_manager
    from plugins.ef.system.sync_service.models.sync_service import SyncService
    from sqlalchemy import select

    db_manager = get_db_manager()

    # 第一步：检查任务是否启用
    async with db_manager.get_session() as db:
        result = await db.execute(
            select(SyncService).where(SyncService.service_key == "my_service")
        )
        service = result.scalar_one_or_none()

        # 如果任务被禁用，直接返回
        if service and not service.is_enabled:
            logger.info("Task ef.xxx.my_task is disabled, skipping")
            return

    # 第二步：执行任务逻辑
    async with db_manager.get_session() as db:
        # 查询业务数据
        result = await db.execute(select(MyModel))
        items = result.scalars().all()

        # 处理数据
        for item in items:
            await process_item(item)

    logger.info("Task ef.xxx.my_task completed successfully")
```

##### ✅ 步骤 3：在数据库中创建服务记录（可选）

如果希望支持前端动态开关任务：

```sql
-- 在 sync_services 表中插入记录
INSERT INTO sync_services (service_key, service_name, description, is_enabled, schedule_config)
VALUES ('my_service', '我的定时任务', '任务描述', true, '*/30 * * * *');
```

---

#### 完整示例：订单同步任务

```python
# plugins/ef/channels/ozon/__init__.py

async def setup(hooks) -> None:
    """OZON 插件初始化"""

    # ✅ 正确：注册订单拉取任务
    await hooks.register_cron(
        name="ef.ozon.orders.pull",
        cron="*/5 * * * *",  # 每5分钟
        task=pull_orders_task
    )


# plugins/ef/channels/ozon/tasks/pull_orders_task.py

from ef_core.tasks.celery_app import celery_app
import asyncio
import logging

logger = logging.getLogger(__name__)

@celery_app.task(bind=True, name="ef.ozon.orders.pull")
def pull_orders_task(self, **kwargs):
    """订单拉取任务"""

    def run_async():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            return loop.run_until_complete(async_pull_orders())
        finally:
            loop.close()
            asyncio.set_event_loop(None)

    return run_async()


async def async_pull_orders():
    """异步订单拉取逻辑"""
    from ef_core.database import get_db_manager
    from plugins.ef.channels.ozon.models.shops import OzonShop
    from plugins.ef.system.sync_service.models.sync_service import SyncService
    from sqlalchemy import select

    db_manager = get_db_manager()

    # 检查任务是否启用
    async with db_manager.get_session() as db:
        result = await db.execute(
            select(SyncService).where(SyncService.service_key == "ozon_orders_pull")
        )
        service = result.scalar_one_or_none()

        if service and not service.is_enabled:
            logger.info("Task ef.ozon.orders.pull is disabled, skipping")
            return

    # 获取所有活跃店铺
    async with db_manager.get_session() as db:
        result = await db.execute(
            select(OzonShop).where(OzonShop.status == "active")
        )
        shops = result.scalars().all()

    # 对每个店铺拉取订单
    for shop in shops:
        logger.info(f"Pulling orders for shop {shop.shop_name}")
        await pull_orders_for_shop(shop)

    logger.info("Orders pull completed")


async def pull_orders_for_shop(shop):
    """为单个店铺拉取订单"""
    # 具体的业务逻辑
    pass
```

---

#### 代码审查清单

在添加新任务或 Code Review 时，必须检查：

- [ ] **插件 setup() 规范**
  - [ ] 不调用 `get_db_manager()`
  - [ ] 不执行数据库查询
  - [ ] 使用硬编码的默认 cron 表达式

- [ ] **任务函数规范**
  - [ ] 任务函数是同步的（`def`，不是 `async def`）
  - [ ] 使用标准模板（创建独立事件循环）
  - [ ] 正确清理事件循环（`loop.close()` + `set_event_loop(None)`）
  - [ ] 任务开始时检查 `is_enabled` 状态
  - [ ] 任务执行时再查询数据库

- [ ] **Celery Worker 配置**
  - [ ] 使用 `prefork` pool（不使用 gevent）
  - [ ] `supervisord.conf` 中的配置正确

- [ ] **错误处理**
  - [ ] 有完善的日志记录
  - [ ] 有合理的异常捕获

---

#### 测试验证步骤

##### 1. 本地测试

```bash
# 1. 重启服务
./restart.sh

# 2. 检查任务是否成功注册
supervisorctl tail -100 euraflow:celery_beat stdout | grep "ef.xxx.my_task"

# 3. 检查是否有事件循环错误
supervisorctl tail -100 euraflow:celery_worker stderr | grep -i "event loop"

# 4. 手动触发任务测试
./venv/bin/celery -A ef_core.tasks.celery_app call ef.xxx.my_task

# 5. 观察任务执行日志
supervisorctl tail -f euraflow:celery_worker stdout | grep "ef.xxx.my_task"
```

##### 2. 验证任务禁用功能

```bash
# 1. 在数据库中禁用任务
psql -d euraflow -c "UPDATE sync_services SET is_enabled = false WHERE service_key = 'my_service';"

# 2. 触发任务
./venv/bin/celery -A ef_core.tasks.celery_app call ef.xxx.my_task

# 3. 确认任务被跳过
supervisorctl tail -f euraflow:celery_worker stdout | grep "is disabled, skipping"
```

##### 3. 远程部署验证

```bash
# 1. 提交代码
git add . && git commit -m "feat: add new task" && git push

# 2. 远程部署
ssh ozon "cd /opt/euraflow && git pull && ./restart.sh"

# 3. 检查服务状态
ssh ozon "supervisorctl status"

# 4. 检查任务是否注册
ssh ozon "supervisorctl tail -100 euraflow:celery_beat stdout | grep 'ef.xxx.my_task'"
```

---

#### 常见问题排查

##### 问题 1：任务没有被调度

**现象**：Celery Beat 日志中看不到任务

**排查**：
```bash
# 检查任务是否注册
supervisorctl tail -100 euraflow:celery_beat stdout | grep "Registered task"

# 检查插件初始化日志
supervisorctl tail -100 euraflow:celery_beat stdout | grep "Plugin"
```

**可能原因**：
- 插件 `setup()` 函数中没有调用 `hooks.register_cron()`
- 任务名称拼写错误
- 插件初始化失败

##### 问题 2：任务执行报错

**现象**：任务被触发，但执行失败

**排查**：
```bash
# 查看 Worker 错误日志
supervisorctl tail -200 euraflow:celery_worker stderr
```

**可能原因**：
- 事件循环没有正确关闭
- 数据库连接失败
- 业务逻辑错误

##### 问题 3：数据库连接失败

**现象**：FastAPI 启动失败，报 "Database connection failed"

**排查**：
```bash
# 检查插件 setup() 是否访问数据库
grep -A 20 "async def setup" plugins/ef/xxx/__init__.py | grep "get_db_manager"
```

**解决方案**：
- 移除 `setup()` 中的数据库访问代码
- 改为任务执行时查询数据库

---

#### 外部 API 调用优化（可选）

如果任务中需要调用外部 API，可以考虑改为同步 HTTP 客户端：

```python
# 当前（异步）
async def fetch_data():
    async with httpx.AsyncClient() as client:
        response = await client.post(url, json=data, timeout=30.0)
        return response.json()

# 优化（同步）
def fetch_data():
    import httpx
    with httpx.Client() as client:
        response = client.post(url, json=data, timeout=30.0)
        return response.json()
```

**优点**：
- 代码更简单
- 减少事件循环开销
- 避免事件循环冲突风险

**注意**：
- 仅适用于 Celery 任务（不适用于 FastAPI 路由）
- 需要逐个任务评估

---

#### 相关文档

- `CLAUDE.md` - 第 22 节："Celery 与 Asyncio 混用规范"
- `FAQ.md` - "Celery 插件初始化时的事件循环冲突导致数据库连接失败"
- `FAQ.md` - "Celery 异步任务报错 'Future attached to a different loop'"

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

### 前端传日期范围导致时区理解错误

**问题描述**：
- 用户在系统设置中切换时区后，统计图表的数据没有变化
- 前端基于浏览器时区计算日期，后端基于用户配置的时区解析日期
- 当两者不一致时（如浏览器时区是 UTC+0，用户设置时区是 Asia/Shanghai），会导致日期理解错误
- 用户选择"最近7天"，但实际查询的时间范围与预期不符

**根本原因**：
1. **前端计算日期** - 使用 `dayjs()` 基于浏览器当前时区计算日期范围（如 2025-11-12 到 2025-11-19）
2. **后端解析日期** - 基于用户配置的时区（如 Asia/Shanghai）解析前端传来的日期字符串
3. **时区不一致** - 前端和后端对同一个日期字符串的理解不一致，导致查询范围错误

**技术细节**：

```typescript
// ❌ 错误方式：前端计算日期（基于浏览器时区）
const startDate = dayjs().subtract(6, 'days').format('YYYY-MM-DD');  // 浏览器时区
const endDate = dayjs().format('YYYY-MM-DD');

// 发送给后端
const params = { start_date: startDate, end_date: endDate };
```

```python
# 后端解析（基于用户配置的时区）
from zoneinfo import ZoneInfo
tz = ZoneInfo('Asia/Shanghai')  # 用户配置的时区

# 解析前端传来的日期
start_date_dt = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=tz)
# 问题：前端的 '2025-11-12' 是基于 UTC 的，后端理解为上海时区的 2025-11-12
# 实际时间差了 8 小时
```

**排查步骤**：

```bash
# 1. 检查前端如何计算日期
grep -rn "dayjs().*subtract\|dayjs().*add" web/src/pages/

# 2. 检查后端如何解析日期
grep -rn "datetime.strptime.*replace.*tzinfo" plugins/ef/

# 3. 检查 API 日志，对比前端传的日期和后端查询的日期范围
# 看日志中是否有时间偏差

# 4. 检查系统设置的时区和浏览器时区是否一致
# 浏览器控制台运行：
# Intl.DateTimeFormat().resolvedOptions().timeZone
```

**标准解决方案**（✅ 推荐）：

#### 架构原则：前端传 range_type，后端统一计算日期

**优点**：
- ✅ 前端逻辑简化，不需要关心时区
- ✅ 时区计算集中在后端，保证一致性
- ✅ 用户切换时区后立即生效（无需前端感知）
- ✅ 避免前后端时区不一致导致的错误

**实现步骤**：

#### 步骤1：前端发送 range_type 而不是日期

```typescript
// ✅ 正确：发送 range_type
// 文件：web/src/pages/ozon/OzonOverview.tsx

const dateRangeParams = useMemo(() => {
  switch (timeRangeType) {
    case '7days':
    case '14days':
    case 'thisMonth':
    case 'lastMonth':
      return { rangeType: timeRangeType };
    case 'custom':
      if (customDateRange[0] && customDateRange[1]) {
        return {
          rangeType: 'custom',
          startDate: customDateRange[0].format('YYYY-MM-DD'),
          endDate: customDateRange[1].format('YYYY-MM-DD'),
        };
      }
      return { rangeType: '7days' };
    default:
      return { rangeType: '7days' };
  }
}, [timeRangeType, customDateRange]);

// API 调用
const { data } = useQuery(['dailyPostingStats', shopId, dateRangeParams], () =>
  getDailyPostingStats(shopId, dateRangeParams.rangeType, dateRangeParams.startDate, dateRangeParams.endDate)
);
```

**API 函数定义**：

```typescript
// 文件：web/src/services/ozonApi.ts

export const getDailyPostingStats = async (
  shopId?: number | null,
  rangeType?: string,
  startDate?: string,
  endDate?: string
) => {
  const params: { shop_id?: number; range_type?: string; start_date?: string; end_date?: string } = {};

  if (shopId) params.shop_id = shopId;
  if (rangeType) params.range_type = rangeType;
  if (startDate && endDate) {
    params.start_date = startDate;
    params.end_date = endDate;
  }

  const response = await apiClient.get<DailyPostingStats>("/ozon/daily-posting-stats", { params });
  return response.data;
};
```

#### 步骤2：后端基于 range_type 和用户时区计算日期

```python
# 文件：plugins/ef/channels/ozon/api/stats_routes.py

from zoneinfo import ZoneInfo
from datetime import datetime, timedelta
from ef_core.config import get_global_timezone

@router.get("/daily-posting-stats")
async def get_daily_posting_stats(
    shop_id: Optional[int] = Query(None, description="店铺ID，为空时获取所有店铺统计"),
    range_type: Optional[str] = Query(None, description="时间范围类型：7days/14days/thisMonth/lastMonth/custom"),
    start_date: Optional[str] = Query(None, description="开始日期 YYYY-MM-DD（仅 range_type=custom 时使用）"),
    end_date: Optional[str] = Query(None, description="结束日期 YYYY-MM-DD（仅 range_type=custom 时使用）"),
    db: AsyncSession = Depends(get_async_session),
    current_user = Depends(get_current_user_flexible)
):
    """获取每日订单统计（基于 in_process_at 或 created_at）"""

    # 1. 获取用户配置的时区
    global_timezone = await get_global_timezone(db)
    tz = ZoneInfo(global_timezone)
    now_in_tz = datetime.now(tz)

    # 2. 根据 range_type 计算日期范围
    if range_type == '7days':
        end_date_obj = now_in_tz.date()
        start_date_obj = end_date_obj - timedelta(days=6)
    elif range_type == '14days':
        end_date_obj = now_in_tz.date()
        start_date_obj = end_date_obj - timedelta(days=13)
    elif range_type == 'thisMonth':
        end_date_obj = now_in_tz.date()
        start_date_obj = now_in_tz.replace(day=1).date()
    elif range_type == 'lastMonth':
        first_day_of_this_month = now_in_tz.replace(day=1)
        last_day_of_last_month = first_day_of_this_month - timedelta(days=1)
        first_day_of_last_month = last_day_of_last_month.replace(day=1)
        start_date_obj = first_day_of_last_month.date()
        end_date_obj = last_day_of_last_month.date()
    elif range_type == 'custom' and start_date and end_date:
        # 自定义范围：前端传来的日期字符串视为用户时区的日期
        start_date_dt = datetime.strptime(start_date, '%Y-%m-%d').replace(tzinfo=tz)
        end_date_dt = datetime.strptime(end_date, '%Y-%m-%d').replace(tzinfo=tz)
        start_date_obj = start_date_dt.date()
        end_date_obj = end_date_dt.date()
    else:
        # 默认：最近7天
        end_date_obj = now_in_tz.date()
        start_date_obj = end_date_obj - timedelta(days=6)

    # 3. 转换为 UTC 时间戳用于查询
    start_datetime_tz = datetime.combine(start_date_obj, datetime.min.time()).replace(tzinfo=tz)
    end_datetime_tz = datetime.combine(end_date_obj, datetime.max.time()).replace(tzinfo=tz)

    start_timestamp_utc = start_datetime_tz.astimezone(ZoneInfo('UTC'))
    end_timestamp_utc = end_datetime_tz.astimezone(ZoneInfo('UTC'))

    # 4. 执行查询（数据库中的时间戳是 UTC）
    # ...
```

**关键点**：
1. **获取用户时区**：`global_timezone = await get_global_timezone(db)`
2. **基于用户时区计算"今天"**：`now_in_tz = datetime.now(tz)`
3. **根据 range_type 计算日期范围**：避免前端计算
4. **转换为 UTC 查询**：数据库存储的是 UTC 时间戳

**range_type 枚举值**：

| range_type   | 含义       | 计算方式                          |
|--------------|----------|-------------------------------|
| `7days`      | 最近7天    | 今天 - 6 天 到 今天                 |
| `14days`     | 最近14天   | 今天 - 13 天 到 今天                |
| `thisMonth`  | 本月      | 本月1号 到 今天                     |
| `lastMonth`  | 上个月     | 上月1号 到 上月最后一天                 |
| `custom`     | 自定义范围   | 使用前端传来的 start_date 和 end_date |

**验证方法**：

```bash
# 1. 修改系统时区设置（在系统管理 → 全局配置中）
# 选择不同时区（如 Asia/Shanghai、America/New_York、Europe/London）

# 2. 刷新概览页面，检查统计数据是否相应变化
# 例如：
# - Asia/Shanghai (UTC+8): "最近7天" 应该是上海时间今天往前推6天
# - America/New_York (UTC-5): "最近7天" 应该是纽约时间今天往前推6天

# 3. 检查后端日志，确认日期计算正确
grep "Calculating date range" logs/backend-*.log

# 4. 检查 SQL 查询，确认时间戳转换正确
# 在日志中查看实际执行的 SQL WHERE 条件

# 5. 对比前端选择的时间范围和后端实际查询的范围
# 应该完全一致（基于用户配置的时区）
```

**相关文件**：
- 前端组件：`web/src/pages/ozon/OzonOverview.tsx:392-436` - 发送 range_type
- API 函数：`web/src/services/ozonApi.ts:678-737` - API 客户端
- 后端接口：`plugins/ef/channels/ozon/api/stats_routes.py:451-534,625-647` - 日期计算逻辑
- 时区配置：`ef_core/config.py` - `get_global_timezone()` 函数

**优缺点对比**：

| 方案                | 优点 | 缺点 |
|-------------------|------|------|
| ❌ 前端计算日期 + 后端解析 | 前端可控，逻辑清晰 | 时区不一致导致错误，用户切换时区不生效，前端需要理解时区 |
| ✅ 前端传 range_type + 后端计算 | 逻辑集中，时区统一，前端简化 | 后端逻辑稍复杂（但更可靠） |

**防止复发**：
- ✅ 所有涉及日期范围查询的接口统一使用 range_type 模式
- ✅ 禁止前端基于浏览器时区计算日期后传给后端
- ✅ 后端统一基于用户配置的时区计算日期范围
- ✅ 在 `CLAUDE.md` 中补充时区处理规范
- ✅ 代码审查：检查新增的日期查询接口是否符合此架构

**参考资料**：
- [Python zoneinfo](https://docs.python.org/3/library/zoneinfo.html)
- [dayjs Timezone](https://day.js.org/docs/en/timezone/timezone)
- [时区最佳实践](https://stackoverflow.com/questions/2532729/daylight-saving-time-and-time-zone-best-practices)

---

### 如何正确实现 OZON API 请求（新手必读）

**问题描述**：
- 编写新的 OZON API 调用功能时容易踩坑
- 常见错误：`'OzonShop' object has no attribute 'api_key'`
- 分页处理不当导致数据遗漏或重复
- API 客户端连接未正确关闭

**核心要点速查**：

| 问题 | 错误写法 ❌ | 正确写法 ✅ |
|------|------------|------------|
| API密钥字段 | `shop.api_key` | `shop.api_key_enc` |
| 客户端创建 | `client = OzonAPIClient(...)` | `async with OzonAPIClient(...) as client:` |
| 分页参数 | `page=1, offset=0` | `last_id=0` |
| **分页limit** | `limit=1000` | `limit=500`（OZON限制最大500） |
| **filters参数** | 不传 `filters` | 必须传 `filters={"state": "ALL"}` |
| 日期解析 | `datetime.fromisoformat(dt)` | 处理 `Z` 后缀（见下文） |
| 店铺查询 | 只查 `id` | 必须同时查 `status == 'active'` |

**完整实现模板**：

```python
from typing import Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from ..models import OzonShop
from ..api.client import OzonAPIClient
import logging

logger = logging.getLogger(__name__)

async def sync_example_data(config: Dict[str, Any]) -> Dict[str, Any]:
    """
    同步示例数据（定时任务处理函数）

    Args:
        config: 配置参数
            - shop_id: 店铺ID（可选，默认所有活跃店铺）
            - last_id: 上次同步的last_id（可选）

    Returns:
        同步结果
    """
    logger.info(f"开始同步示例数据，config={config}")

    total_synced = 0
    total_updated = 0

    async with self.db_manager.get_session() as db:
        # 1. 获取要同步的店铺列表
        shop_id = config.get("shop_id")

        if shop_id:
            # ⚠️ 关键：必须同时检查 status == 'active'
            result = await db.execute(
                select(OzonShop).where(
                    OzonShop.id == shop_id,
                    OzonShop.status == "active"  # 必须检查状态！
                )
            )
            shops = result.scalars().all()
        else:
            # 同步所有活跃店铺
            result = await db.execute(
                select(OzonShop).where(OzonShop.status == "active")
            )
            shops = result.scalars().all()

        logger.info(f"找到 {len(shops)} 个活跃店铺")

        # 2. 遍历店铺同步数据
        for shop in shops:
            try:
                # ⚠️ 关键：使用 api_key_enc 而不是 api_key
                # ⚠️ 关键：必须使用 async with 上下文管理器
                async with OzonAPIClient(
                    client_id=shop.client_id,
                    api_key=shop.api_key_enc,  # 不是 api_key！
                    shop_id=shop.id
                ) as client:
                    # 3. 分页获取数据（OZON 使用 last_id 而非 page/offset）
                    current_last_id = config.get("last_id", 0)
                    has_more = True

                    while has_more:
                        # 调用 OZON API（limit最大500，必须传filters）
                        response = await client.get_example_list(
                            last_id=current_last_id,
                            limit=500,
                            filters={"state": "ALL"}  # ⚠️ 关键：某些API必须传递filters才能返回数据
                        )

                        result = response.get("result", {})
                        items = result.get("items", [])
                        has_next = result.get("has_next", False)
                        next_last_id = result.get("last_id", 0)

                        # 处理数据
                        for item_data in items:
                            try:
                                # 保存数据到数据库...
                                total_synced += 1
                            except Exception as e:
                                logger.error(f"保存数据失败: {e}", exc_info=True)
                                continue

                        # 提交批次
                        await db.commit()

                        # 更新分页状态
                        if has_next and next_last_id > current_last_id:
                            current_last_id = next_last_id
                        else:
                            has_more = False

                logger.info(f"店铺 {shop.shop_name} 同步完成，新增 {total_synced} 条")

            except Exception as e:
                logger.error(f"店铺 {shop.shop_name} 同步失败: {e}", exc_info=True)
                continue

    return {
        "records_synced": total_synced,
        "records_updated": total_updated,
        "message": f"同步完成：{len(shops)}个店铺，新增{total_synced}条"
    }
```

**常见错误详解**：

#### 错误 1：使用 `shop.api_key` 而非 `shop.api_key_enc`

**错误现象**：
```python
AttributeError: 'OzonShop' object has no attribute 'api_key'
```

**原因**：
- `OzonShop` 模型中的 API 密钥字段是 `api_key_enc`（加密存储）
- 历史原因：安全性考虑，所有凭证都加密存储

**排查**：
```bash
# 检查代码中的错误用法
grep -rn "shop\.api_key[^_]" plugins/ef/channels/ozon/services/
```

**修复**：
```python
# ❌ 错误
async with OzonAPIClient(
    client_id=shop.client_id,
    api_key=shop.api_key,  # AttributeError!
    shop_id=shop.id
) as client:

# ✅ 正确
async with OzonAPIClient(
    client_id=shop.client_id,
    api_key=shop.api_key_enc,  # 使用加密字段
    shop_id=shop.id
) as client:
```

#### 错误 2：未使用 `async with` 上下文管理器

**错误现象**：
- API 连接未正确关闭
- 资源泄漏，长期运行后性能下降

**原因**：
- `OzonAPIClient` 内部使用 `httpx.AsyncClient`
- 必须正确关闭连接以释放资源

**修复**：
```python
# ❌ 错误（连接未关闭）
client = OzonAPIClient(shop.client_id, shop.api_key_enc, shop.id)
response = await client.get_example_list()

# ✅ 正确（自动关闭）
async with OzonAPIClient(shop.client_id, shop.api_key_enc, shop.id) as client:
    response = await client.get_example_list()
```

#### 错误 3：使用传统分页参数（page/offset）

**错误现象**：
- API 返回错误或数据不完整
- 无法正确遍历所有数据

**原因**：
- OZON API 使用**基于游标的分页**（cursor-based pagination）
- 参数是 `last_id`，而不是 `page` 或 `offset`

**正确的分页逻辑**：
```python
# ✅ OZON API 标准分页模式
current_last_id = 0  # 从0开始
has_more = True

while has_more:
    response = await client.get_example_list(
        last_id=current_last_id,
        limit=1000
    )

    result = response.get("result", {})
    items = result.get("items", [])
    has_next = result.get("has_next", False)
    next_last_id = result.get("last_id", 0)

    # 处理 items...

    # 关键：必须检查 has_next 和 next_last_id 是否递增
    if has_next and next_last_id > current_last_id:
        current_last_id = next_last_id
    else:
        has_more = False
```

#### 错误 4：分页 limit 超过 500

**错误现象**：
```json
{
  "code": 3,
  "message": "Request validation error: invalid GetConditionalCancellationListV2Request.Limit: value must be inside range (0, 500]"
}
```

**原因**：
- OZON API 对不同接口的 `limit` 参数有严格限制
- 取消/退货申请接口：**最大值为 500**
- 其他接口可能有不同限制（如订单接口最大1000）

**排查**：
```bash
# 查看日志中的API错误
tail -100 logs/backend.log | grep "value must be inside range"
```

**修复**：
```python
# ❌ 错误（超过限制）
response = await client.get_conditional_cancellation_list(
    last_id=current_last_id,
    limit=1000  # 超过500！
)

# ✅ 正确（遵守限制）
response = await client.get_conditional_cancellation_list(
    last_id=current_last_id,
    limit=500  # OZON API 最大值
)
```

**不同接口的 limit 限制**：
- `/v2/conditional-cancellation/list` - 最大 **500**
- `/v2/returns/rfbs/list` - 最大 **500**
- `/v3/posting/fbs/list` - 最大 **1000**
- `/v2/product/list` - 最大 **1000**

#### 错误 5：日期时间解析未处理 `Z` 后缀

**错误现象**：
```python
ValueError: Invalid isoformat string: '2025-11-15T10:30:00Z'
```

**原因**：
- OZON API 返回的时间格式：`2025-11-15T10:30:00Z`
- Python `datetime.fromisoformat()` 在某些版本不支持 `Z` 后缀

**解决方案**：
```python
from datetime import datetime
from typing import Optional

@staticmethod
def _parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """解析 OZON API 返回的日期时间"""
    if not dt_str:
        return None
    try:
        # 将 'Z' 替换为 '+00:00'
        if dt_str.endswith('Z'):
            dt_str = dt_str[:-1] + '+00:00'
        return datetime.fromisoformat(dt_str)
    except Exception as e:
        logger.warning(f"解析日期时间失败: {dt_str}, {e}")
        return None

# 使用
created_at = self._parse_datetime(data.get("created_at"))
```

#### 错误 6：未检查店铺状态

**错误现象**：
- 同步了已停用的店铺，导致 API 调用失败
- 查询返回 0 个店铺（但数据库中存在该店铺）

**原因**：
- 店铺可能处于 `inactive`、`suspended` 等状态
- 必须同时检查 `status == 'active'`

**修复**：
```python
# ❌ 错误（可能查到停用店铺）
result = await db.execute(
    select(OzonShop).where(OzonShop.id == shop_id)
)

# ✅ 正确（只查活跃店铺）
result = await db.execute(
    select(OzonShop).where(
        OzonShop.id == shop_id,
        OzonShop.status == "active"
    )
)
```

#### 错误 7：未传递 `filters` 参数导致 API 返回 0 条记录

**错误现象**：
- API 调用成功，但返回 0 条记录：`{"result": [], "last_id": 0, "counter": 0}`
- 日志显示：`OZON API 返回：0 条取消申请，last_id=0, counter=0`
- 但在 OZON 官网后台可以看到有记录存在

**原因**：
- **某些 OZON API 接口要求必须传递 `filters` 参数才能返回数据**
- 特别是取消/退货申请接口，不传 `filters` 会导致 API 返回空结果
- 即使有历史数据，不传 `filters.state` 也可能返回 0 条

**受影响的 API**：
- `/v2/conditional-cancellation/list` - **必须传** `filters.state`（复数，字符串）
- `/v2/returns/rfbs/list` - **必须传** `filter.group_state`（单数，数组）

**⚠️ 关键区别**：

**请求参数**：
- **取消申请**：`filters`（复数） + `state`（字符串）→ `{"filters": {"state": "ALL"}}`
- **退货申请**：`filter`（单数） + `group_state`（数组）→ `{"filter": {"group_state": ["ALL"]}}`

**响应格式**：
- **取消申请**：`{'result': [...], 'last_id': int, 'counter': int}`
- **退货申请**：`{'returns': [...], 'has_next': bool}`（**完全不同！**）

**修复**：
```python
# ❌ 错误（取消申请 - 不传 filters）
response = await client.get_conditional_cancellation_list(
    last_id=current_last_id,
    limit=500
)

# ✅ 正确（取消申请 - filters 复数 + state 字符串）
response = await client.get_conditional_cancellation_list(
    last_id=current_last_id,
    limit=500,
    filters={"state": "ALL"}
)

# ❌ 错误（退货申请 - 用错了参数）
response = await client.get_returns_rfbs_list(
    last_id=current_last_id,
    limit=500,
    filters={"state": "ALL"}  # ❌ 错误：应该用 filter.group_state 数组
)

# ✅ 正确（退货申请 - filter 单数 + group_state 数组）
response = await client.get_returns_rfbs_list(
    last_id=current_last_id,
    limit=500,
    filters={"group_state": ["ALL"]}  # ✅ 注意：filter单数，group_state数组
)
```

**OZON API 文档示例**：

取消申请：
```json
{
  "filters": {
    "state": "ALL"
  },
  "limit": 500,
  "last_id": 0
}
```

退货申请：
```json
{
  "filter": {
    "group_state": ["ALL"]
  },
  "limit": 500,
  "last_id": 0
}
```

**参数可选值**：
- 取消申请 `filters.state`：`"ALL"` | `"APPROVED"` | `"DECLINED"` | `"WAITING_FOR_APPROVAL"`
- 退货申请 `filter.group_state`：`["ALL"]` | `["RETURNED"]` | `["REFUNDED"]` 等

**调试技巧**：

```python
# 1. 添加详细的调试日志
logger.info(f"开始同步，config={config}")
logger.info(f"shop_id from config: {shop_id}, type: {type(shop_id)}")
logger.info(f"查询指定店铺 {shop_id}，找到 {len(shops)} 个活跃店铺")

# 2. 记录 API 响应
logger.debug(f"OZON API 响应: {response}")

# 3. 捕获并记录详细错误
try:
    # ... 同步逻辑
except Exception as e:
    logger.error(f"店铺 {shop.shop_name} 同步失败: {e}", exc_info=True)
    continue  # 不中断其他店铺的同步
```

**验证清单**：

开发新的 OZON API 功能时，确保完成以下检查：

- [ ] 使用 `shop.api_key_enc` 而非 `shop.api_key`
- [ ] 使用 `async with OzonAPIClient(...) as client:` 上下文管理器
- [ ] 使用 `last_id` 分页，正确处理 `has_next` 和 `next_last_id`
- [ ] 日期解析函数处理 `Z` 后缀（`_parse_datetime()`）
- [ ] 查询店铺时检查 `status == 'active'`
- [ ] 添加详细的日志记录（info、error、debug）
- [ ] 使用 `try-except` 包裹同步逻辑，避免单个店铺失败中断整体
- [ ] 批量提交数据（每批 `await db.commit()`）
- [ ] 返回标准格式：`{"records_synced": int, "records_updated": int, "message": str}`

**参考代码**：
- ✅ 正确示例：`plugins/ef/channels/ozon/services/cancel_return_service.py`
- ✅ 正确示例：`plugins/ef/channels/ozon/services/ozon_sync.py`
- ✅ API 客户端：`plugins/ef/channels/ozon/api/client.py`

**相关问题**：
- [Celery 异步任务报错](#celery-异步任务报错-future-attached-to-a-different-loop)
- [如何添加新的后台定时任务服务](#如何添加新的后台定时任务服务)

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
