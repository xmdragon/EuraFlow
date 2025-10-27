# EuraFlow 打印助手

静默打印浏览器扩展，支持 PDF 标签直接打印到默认打印机，无需确认对话框。

## 功能特性

- ✅ 静默打印：无需用户确认，直接发送到默认打印机
- ✅ Edge/Chrome 兼容：基于 Chromium Printing API
- ✅ 安全隔离：仅响应来自 EuraFlow 系统的打印请求
- ✅ 自动配置：默认使用黑白单面打印，适配 OZON 标签尺寸

## 安装方法

### Edge 浏览器

1. 打开 Edge 浏览器，访问 `edge://extensions/`
2. 打开右上角的"开发人员模式"
3. 点击"加载解压缩的扩展"
4. 选择本目录 (`browser_extension_print/`)
5. 确认扩展已启用

### Chrome 浏览器

1. 打开 Chrome 浏览器，访问 `chrome://extensions/`
2. 打开右上角的"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择本目录 (`browser_extension_print/`)
5. 确认扩展已启用

## 使用方法

安装扩展后，在 EuraFlow 系统的打包发货页面：

1. 扫描单号并点击"打印标签"
2. 在打印标签弹窗中，点击"打印"按钮
3. PDF 将自动发送到默认打印机，无需确认对话框

## 打印配置

默认配置（在 `background/service-worker.js` 中可修改）：

- **打印机**：系统默认打印机
- **颜色**：黑白 (`STANDARD_MONOCHROME`)
- **面数**：单面 (`NO_DUPLEX`)
- **方向**：纵向 (`PORTRAIT`)
- **份数**：1 份
- **DPI**：300x300
- **纸张尺寸**：100mm x 100mm（OZON 标签标准尺寸）

## 技术架构

```
网页 (PackingShipment.tsx)
  ↓ window.postMessage
Content Script (content.js)
  ↓ chrome.runtime.sendMessage
Background Service Worker (service-worker.js)
  ↓ chrome.printing.submitJob
打印机
```

## 权限说明

- `printing`：调用 Chrome Printing API 进行静默打印
- `host_permissions`：仅允许访问 EuraFlow 系统域名

## 故障排除

### 扩展未生效

1. 确认扩展已启用：访问 `edge://extensions/` 检查状态
2. 刷新 EuraFlow 页面
3. 打开浏览器控制台，查看是否有 `[EuraFlow Print Content]` 日志

### 打印失败

1. 检查默认打印机是否已设置
2. 确认打印机处于就绪状态
3. 打开扩展的后台页面查看错误日志：
   - Edge: `edge://extensions/` → EuraFlow 打印助手 → "服务工作进程" → "检查视图"
   - Chrome: `chrome://extensions/` → EuraFlow 打印助手 → "背景页" → "查看视图"

### PDF 无法获取

- 确认 PDF URL 可访问（在浏览器中直接打开测试）
- 检查 `host_permissions` 是否包含 PDF 所在域名

## 开发与调试

修改代码后，需要重新加载扩展：

1. 访问 `edge://extensions/`
2. 找到"EuraFlow 打印助手"
3. 点击刷新图标 🔄

查看扩展日志：

- Content Script 日志：在网页的开发者工具控制台查看
- Background 日志：在扩展的后台页面查看（见上方"故障排除"）

## 版本历史

- **v1.0.0** (2025-10-27)
  - 初始版本
  - 支持 PDF 静默打印
  - 默认配置适配 OZON 标签
