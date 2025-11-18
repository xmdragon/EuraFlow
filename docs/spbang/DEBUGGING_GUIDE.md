# 上品帮插件调试指南

> 本指南帮助你在 Chrome 浏览器中加载修改后的上品帮插件，并监控其与服务器的通信过程。

---

## 📦 准备工作

### 文件位置
修改后的插件文件位于：
```
/home/grom/EuraFlow/tmp/spbang/
├── background.js          # 后台脚本（已添加调试日志）
├── ozon_min.js            # OZON API 拦截脚本
├── manifest.json          # 插件配置文件
├── content-scripts/       # 内容脚本
│   └── main.js           # 主界面脚本（5MB，Vue 应用）
└── assets/               # 图标等资源文件
```

### 调试代码说明
已在 `background.js` 中添加了详细的调试日志，使用以下前缀：

| 日志前缀 | 颜色 | 用途 |
|---------|------|------|
| `[上品帮调试] 收到消息` | 蓝色 | 记录每次 API 调用的入口 |
| `[上品帮调试] Token 信息` | 绿色 | 显示 Token 状态（脱敏） |
| `[上品帮调试] API: xxx` | 蓝色 | 记录具体 API 请求 |
| `[上品帮调试] 响应: xxx` | 绿色 | 记录 API 响应数据 |
| `[上品帮调试] Cookie 变化` | 橙色 | 监控 Cookie 变化 |
| `[上品帮调试] API 请求失败` | 红色 | 记录错误信息 |

---

## 🚀 加载插件到 Chrome

### 步骤 1: 打开扩展管理页面

1. 打开 Chrome 浏览器
2. 在地址栏输入：`chrome://extensions/`
3. 按 `Enter` 键

### 步骤 2: 启用开发者模式

1. 在右上角找到"开发者模式"开关
2. 将其切换到**开启**状态

![开发者模式](https://via.placeholder.com/600x100/1f5fff/ffffff?text=Developer+Mode+ON)

### 步骤 3: 加载未打包的扩展程序

1. 点击左上角的**"加载已解压的扩展程序"**按钮
2. 在文件选择对话框中，导航到：
   ```
   /home/grom/EuraFlow/tmp/spbang/
   ```
3. 选择该文件夹并点击**"选择"**

### 步骤 4: 确认插件加载成功

加载成功后，你会看到：
- 插件图标显示在扩展列表中
- 名称：**上品帮-OZON、WB卖家助手**
- 版本：**3.1.28**
- ID：一串随机字符（开发者模式生成）

---

## 🔍 查看调试日志

### 方法 1: 查看 Service Worker 日志（推荐）

1. 在扩展管理页面 `chrome://extensions/`
2. 找到"上品帮-OZON、WB卖家助手"
3. 点击**"Service Worker"**或**"查看视图: Service Worker"**
4. 会打开 Chrome DevTools

### 方法 2: 使用 Chrome DevTools

如果没有 Service Worker 链接：
1. 右键点击插件图标
2. 选择**"审查弹出内容"**（Inspect Popup）
3. 在 DevTools 中切换到 **Console** 标签

---

## 📊 日志输出示例

### 1. 用户打开 OZON 商品页面

**触发**: 插件检测到 OZON 页面

```javascript
[上品帮调试] 收到消息 {
  requestId: "REQ_1700123456789_abc123",
  timestamp: "2025-11-17T09:00:00.000Z",
  type: "getOzonCookie",
  url: undefined,
  allParams: { type: "getOzonCookie" }
}
```

### 2. 获取 Token 信息

**触发**: 每次 API 调用前

```javascript
[上品帮调试] Token 信息 {
  requestId: "REQ_1700123456789_abc123",
  tokenPreview: "eyJhbGci...",  // 只显示前8位
  domain: "shopbang.cn",
  expirationDate: "2025-12-31T23:59:59.000Z"
}
```

### 3. 商品采集请求

**触发**: 用户点击"采集"按钮

```javascript
[上品帮调试] API: goodsCollect {
  requestId: "REQ_1700123456890_def456",
  url: "https://api.shopbang.cn/api/goods/collect",
  goodsCount: 5,
  source_url: "https://www.ozon.ru/product/...",
  is_force: false
}

[上品帮调试] 响应: goodsCollect {
  requestId: "REQ_1700123456890_def456",
  status: 200,
  result: {
    code: 0,
    message: "采集成功",
    data: {
      successCount: 5,
      failCount: 0,
      goodsIds: ["goods_123", "goods_124", ...]
    }
  },
  duration: "1234ms"
}
```

### 4. Cookie 变化监控

**触发**: 用户登录淘宝/天猫

```javascript
[上品帮调试] Cookie 变化: _m_h5_tk {
  domain: ".taobao.com",
  valuePreview: "1a2b3c4d...",
  removed: false
}

[上品帮调试] 保存淘宝 Token {
  tokenPreview: "1a2b3c4d..."
}
```

### 5. 错误捕获

**触发**: API 请求失败

```javascript
[上品帮调试] API 请求失败 {
  requestId: "REQ_1700123456999_ghi789",
  type: "upGoods",
  error: "Failed to fetch",
  stack: "Error: Failed to fetch\n    at ...",
  duration: "5678ms"
}
```

---

## 🌐 监控网络请求

### 步骤 1: 打开 Network 面板

1. 在 Chrome DevTools 中切换到 **Network** 标签
2. 确保勾选了**"保留日志"**（Preserve log）
3. 可以勾选**"禁用缓存"**（Disable cache）

### 步骤 2: 过滤 shopbang.cn 请求

1. 在 Network 面板的过滤框中输入：
   ```
   shopbang.cn
   ```
2. 这会只显示发往上品帮服务器的请求

### 步骤 3: 查看请求详情

点击任一请求，可以查看：
- **Headers**: 请求头、响应头
- **Payload**: 请求参数（JSON 格式）
- **Preview**: 响应数据（格式化后的 JSON）
- **Response**: 原始响应数据
- **Timing**: 请求耗时分析

---

## 🎯 常见调试场景

### 场景 1: 监控商品采集流程

**步骤**:
1. 打开 OZON 商品页面（如：`https://www.ozon.ru/product/...`）
2. 打开 DevTools Console
3. 点击插件的"采集"按钮
4. 观察日志输出

**预期日志**:
```javascript
[上品帮调试] 收到消息 { type: "goodsCollect", ... }
[上品帮调试] Token 信息 { ... }
[上品帮调试] API: goodsCollect { ... }
[上品帮调试] 响应: goodsCollect { code: 0, ... }
```

### 场景 2: 检查 Token 是否有效

**步骤**:
1. 打开 DevTools Console
2. 执行以下命令：
   ```javascript
   chrome.runtime.sendMessage(
     { type: "checkBangToken", url: "https://api.shopbang.cn/api/check", apiMethod: "POST" },
     (response) => console.log("Token 检查结果:", response)
   );
   ```

**预期输出**:
```javascript
[上品帮调试] 收到消息 { type: "checkBangToken", ... }
[上品帮调试] API: checkBangToken { ... }
[上品帮调试] 响应: checkBangToken { code: 0, ... }
Token 检查结果: { code: 0, data: { deviceId: "...", bindStatus: true } }
```

### 场景 3: 监控批量上传

**步骤**:
1. 在上品帮后台选择商品
2. 点击"批量上传到 OZON"
3. 查看 Network 面板的 `api.shopbang.cn` 请求

**关键字段**:
- `apiType`: `batchCreateGoods`
- `goodsCount`: 上传的商品数量
- `duration`: 请求耗时

### 场景 4: 调试 OZON Premium 拦截

**步骤**:
1. 访问 `https://seller.ozon.ru/app/analytics/graphs`
2. 打开 DevTools Console
3. 查找日志：`XHR深度拦截安装成功` 或 `Fetch深度拦截安装成功`

**预期行为**:
- 页面不显示"Premium 付费提示"
- 所有图表数据正常显示（伪造的数据）

---

## 🛠️ 高级调试技巧

### 技巧 1: 过滤日志

在 Console 中使用过滤器：
```
上品帮调试
```
这会只显示调试日志，隐藏其他干扰信息。

### 技巧 2: 保存日志到文件

1. 在 Console 中右键点击
2. 选择 **"Save as..."**
3. 保存为 `.log` 文件供后续分析

### 技巧 3: 监控特定 API

在 Console 中执行：
```javascript
// 监控所有 goodsCollect 请求
const originalFetch = window.fetch;
window.fetch = function(...args) {
  const url = args[0];
  if (url.includes('goodsCollect')) {
    console.log('🔍 拦截到 goodsCollect 请求:', args);
  }
  return originalFetch.apply(this, args);
};
```

### 技巧 4: 查看 Cookie

在 Console 中执行：
```javascript
chrome.cookies.getAll({ domain: "shopbang.cn" }, (cookies) => {
  console.log("上品帮 Cookies:", cookies);
});
```

### 技巧 5: 清除 Token（测试登出）

在 Console 中执行：
```javascript
chrome.runtime.sendMessage(
  { type: "removeBangToken" },
  (response) => console.log("Token 已删除")
);
```

---

## 🐛 常见问题排查

### 问题 1: 插件加载失败

**错误信息**: `"Manifest file is missing or unreadable"`

**解决方案**:
1. 确认 `manifest.json` 文件存在且格式正确
2. 使用 JSON 验证工具检查语法错误
3. 确保文件编码为 UTF-8

### 问题 2: 没有调试日志输出

**可能原因**:
1. Service Worker 未激活
2. Console 被清空

**解决方案**:
1. 刷新扩展：在 `chrome://extensions/` 点击刷新按钮
2. 重新打开 Service Worker DevTools
3. 勾选 Console 的 **"Preserve log"**

### 问题 3: API 请求返回 401

**原因**: Token 无效或过期

**解决方案**:
1. 检查 Cookie 是否存在：
   ```javascript
   chrome.cookies.get({ url: "https://shopbang.cn", name: "token" }, (cookie) => {
     console.log("Token Cookie:", cookie);
   });
   ```
2. 如果不存在，需要重新登录上品帮网站
3. 登录后刷新页面

### 问题 4: OZON Premium 拦截未生效

**原因**: `ozon_min.js` 未注入

**解决方案**:
1. 检查 Console 是否有日志：`主世界脚本注册成功`
2. 刷新 OZON 页面
3. 确认 `manifest.json` 中 `matches` 包含 OZON 域名

### 问题 5: Network 请求看不到 Body

**原因**: POST 请求的 Body 太大或被加密

**解决方案**:
1. 在 Network 面板点击请求
2. 切换到 **Payload** 标签
3. 如果是二进制数据，查看 Console 日志（已格式化）

---

## 📌 注意事项

### 安全提示

1. **敏感数据脱敏**: 调试日志已自动脱敏 Token（只显示前 8 位）
2. **不要分享日志**: 日志可能包含用户的商品数据、Cookie 等敏感信息
3. **仅用于分析**: 该插件涉及破解 OZON 付费功能，仅供技术研究，请勿用于商业用途

### 性能提示

1. **日志量较大**: 长时间使用会产生大量日志，建议定期清空 Console
2. **影响性能**: 调试代码会增加 10-20% 的额外耗时，生产环境应移除
3. **内存占用**: Service Worker 可能因日志过多而崩溃，定期重启

### 隐私提示

该插件会收集以下数据并上传到 `shopbang.cn`：
- ✅ OZON Seller Cookie（包含登录状态）
- ✅ 淘宝/天猫 `_m_h5_tk` Cookie
- ✅ 用户采集的商品数据
- ✅ 设备信息（通过 `checkDevice` API）

---

## 🔗 相关文档

- [API 接口文档](./API_DOCUMENTATION.md) - 完整的 API 接口说明
- [Chrome Extension DevTools](https://developer.chrome.com/docs/extensions/mv3/devtools/) - 官方调试指南
- [Manifest V3 文档](https://developer.chrome.com/docs/extensions/mv3/intro/) - 扩展开发文档

---

## 💡 反馈与改进

如果你在调试过程中发现问题或有改进建议，请：
1. 记录详细的错误日志
2. 截图 DevTools Console 和 Network 面板
3. 说明复现步骤

---

**调试愉快！**

> 最后更新: 2025-11-17
