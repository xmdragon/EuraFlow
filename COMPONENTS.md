# EuraFlow - 可复用 Hooks 和组件索引

> **目的**：避免重复造轮子，开发前先查阅此文档
> **维护**：新增通用 Hook/组件时必须更新此文档

---

## 🎣 Hooks（通用业务逻辑）

### 异步任务轮询

#### `useAsyncTaskPolling`
**路径**：`web/src/hooks/useAsyncTaskPolling.tsx`
**用途**：统一处理后台异步任务的轮询、进度显示、用户取消等逻辑
**特性**：
- ✅ 自动进度通知显示（右下角）
- ✅ 用户关闭通知时自动停止轮询
- ✅ 超时检测与处理（默认30分钟）
- ✅ 404错误自动停止轮询
- ✅ 组件卸载时自动清理
- ✅ 可自定义进度和成功消息格式

**使用示例**：
```typescript
const { startPolling } = useAsyncTaskPolling({
  getStatus: async (taskId) => {
    const status = await api.getTaskStatus(taskId);
    if (status.completed) return { state: 'SUCCESS', result: status };
    if (status.failed) return { state: 'FAILURE', error: status.error };
    return { state: 'PROGRESS', info: { progress: status.progress } };
  },
  pollingInterval: 2000,
  notificationKey: 'my-task',
  initialMessage: '任务进行中',
  onSuccess: () => { /* 刷新数据 */ },
});

// 启动轮询
mutation.mutate(data, {
  onSuccess: (response) => startPolling(response.task_id)
});
```

**文档**：`web/src/hooks/useAsyncTaskPolling.example.md`

**已应用场景**：
- 订单同步（OrderList.tsx）
- 订单同步（PackingShipment.tsx）
- 商品同步（useProductSync.tsx）
- 批量价格/库存更新（useProductOperations.ts）
- 类目树/特征同步（GlobalSettingsTab.tsx）
- 水印应用（useWatermark.ts）

---

### 权限管理

#### `usePermission`
**路径**：`web/src/hooks/usePermission.ts`
**用途**：统一权限判断逻辑
**API**：
- `canOperate`: 是否有操作权限
- `canSync`: 是否有同步权限
- `canView`: 是否有查看权限

---

### 货币处理

#### `useCurrency`
**路径**：`web/src/hooks/useCurrency.tsx`
**用途**：统一货币设置和格式化
**API**：
- `currency`: 当前用户货币（CNY/RUB）
- `symbol`: 货币符号（¥/₽）
- `formatPrice(value)`: 格式化价格，自动使用用户货币符号

**使用示例**：
```typescript
const { currency, symbol, formatPrice } = useCurrency();

// 使用符号
<span>{symbol}{price}</span>

// 格式化价格（自动使用用户货币）
<span>{formatPrice(price)}</span>  // 输出: ¥123.45
```

---

### 时间与时区处理

#### `useDateTime`
**路径**：`web/src/hooks/useDateTime.tsx`
**用途**：统一全局时区配置和时间格式化
**特性**：
- ✅ 自动读取全局时区设置（莫斯科时间/北京时间）
- ✅ 显示时间自动转为用户时区
- ✅ 查询时间自动转为 UTC（发送给后端）
- ✅ 支持自定义格式
- ✅ 5分钟缓存，避免频繁请求

**API**：
- `timezone`: 当前全局时区（Asia/Shanghai 或 Europe/Moscow）
- `formatDateTime(utcTime, format)`: 格式化 UTC 为用户时区（默认：'MM-DD HH:mm'）
- `formatDate(utcTime, format)`: 格式化日期（默认：'YYYY-MM-DD'）
- `formatTime(utcTime, format)`: 格式化时间（默认：'HH:mm:ss'）
- `toUTC(localTime, format)`: 将用户时区时间转为 UTC（发送给后端）
- `toUTCRange(localDate, isEndDate)`: 日期范围转 UTC（带时分秒）

**使用示例**：
```typescript
const { formatDateTime, formatDate, toUTC } = useDateTime();

// 显示订单时间（UTC → 用户时区）
<div>{formatDateTime(order.ordered_at)}</div>  // "11-03 15:30"
<div>{formatDate(order.ordered_at)}</div>      // "2025-11-03"

// 自定义格式
<div>{formatDateTime(order.ordered_at, 'YYYY-MM-DD HH:mm:ss')}</div>

// 发送查询参数（用户时区 → UTC）
const queryParams = {
  date_from: toUTC(dateRange[0]),  // "2025-11-02"
  date_to: toUTC(dateRange[1]),
};
```

**重要规则**：
- ❌ 禁止直接使用 `moment().format()` 或 `dayjs().format()`
- ❌ 禁止在查询参数中使用本地时区日期
- ✅ 显示时间必须使用 `formatDateTime()` / `formatDate()`
- ✅ 发送查询必须使用 `toUTC()`

**已应用场景**：
- 订单管理（OrderList.tsx）
- 财务交易（FinanceTransactions.tsx）
- 数据概览（OzonOverview.tsx）
- 订单详情（OrderDetailModal.tsx）
- 打包发货（ScanResultTable.tsx, OrderCardComponent.tsx）
- 聊天消息（ChatList.tsx, ChatDetail.tsx）
- 系统日志（AuditLogsTable.tsx, WebhookLogsTable.tsx）
- 订单报表（OrderReport.tsx）
- 选品助手（useProductSelection.tsx）
- 进货价格历史（PurchasePriceHistoryModal.tsx）

---

### 复制功能

#### `useCopy`
**路径**：`web/src/hooks/useCopy.ts`
**用途**：统一复制到剪贴板功能，提供降级方案
**特性**：
- ✅ 自动降级（navigator.clipboard → execCommand）
- ✅ 统一的成功/失败提示
- ✅ 跨浏览器兼容

**使用示例**：
```typescript
const { copyToClipboard } = useCopy();
copyToClipboard(text, '订单号');
```

**禁止**：直接使用 `navigator.clipboard.writeText` 或 `document.execCommand`

---

### 批量操作

#### `useBatchPrint`
**路径**：`web/src/hooks/useBatchPrint.ts`
**用途**：批量打印标签逻辑
**特性**：
- 支持最大打印数量限制
- 错误处理和展示
- 成功/失败统计

#### `useBatchSync`
**路径**：`web/src/hooks/useBatchSync.ts`
**用途**：批量同步订单/商品逻辑
**特性**：
- 进度显示
- 错误处理
- 成功/失败回调

---

### OZON 业务专用

#### `useShopSelection`
**路径**：`web/src/hooks/ozon/useShopSelection.ts`
**用途**：统一管理店铺选择状态和 localStorage 持久化
**特性**：
- ✅ 自动从 localStorage 读取并初始化
- ✅ 自动持久化到 localStorage
- ✅ 自动归一化输入格式（number | number[] | null）
- ✅ 可配置持久化键和初始值

**API**：
- `selectedShop`: 当前选中的店铺 ID（number | null）
- `setSelectedShop(shopId)`: 设置选中的店铺 ID
- `handleShopChange(shopId)`: 处理店铺选择变化（自动归一化）

**使用示例**：
```typescript
// 基础使用（带持久化）
const { selectedShop, handleShopChange } = useShopSelection();

// 配合 ShopSelector 使用
<ShopSelector value={selectedShop} onChange={handleShopChange} />

// 不持久化
const { selectedShop, setSelectedShop } = useShopSelection({ persist: false });

// 自定义持久化键
const { selectedShop, handleShopChange } = useShopSelection({
  persistKey: 'my_shop_key'
});
```

**已应用场景**：
- 促销活动管理（Promotions.tsx）
- 商品列表（ProductList.tsx）

---

#### `useProductOperations`
**路径**：`web/src/hooks/ozon/useProductOperations.ts`
**用途**：商品操作业务逻辑（编辑、更新价格/库存、归档、恢复、删除）
**API**：
- `handleEdit(product)`: 编辑商品
- `handlePriceUpdate(product)`: 更新价格
- `handleStockUpdate(product)`: 更新库存
- `handleBatchPriceUpdate()`: 批量更新价格
- `handleBatchStockUpdate()`: 批量更新库存
- `handleArchive(product)`: 归档商品
- `handleRestore(product)`: 恢复商品
- `handleDelete(product)`: 删除商品

#### `useProductSync`
**路径**：`web/src/hooks/ozon/useProductSync.tsx`
**用途**：商品同步业务逻辑（全量/增量同步）
**API**：
- `handleSync(fullSync: boolean)`: 启动同步
- `syncProductsMutation`: 同步 mutation

#### `useWatermark`
**路径**：`web/src/hooks/ozon/useWatermark.ts`
**用途**：水印应用业务逻辑
**API**：
- `applyWatermarkMutation`: 应用水印
- `restoreOriginalMutation`: 还原原图
- `handlePreview`: 预览水印

---

## 🧱 可复用组件

### 通用组件

#### `PageTitle`
**路径**：`web/src/components/PageTitle.tsx`
**用途**：统一页面标题样式
**Props**：`{ icon, title }`

#### `ShopSelector`
**路径**：`web/src/components/ozon/ShopSelector.tsx`
**用途**：店铺选择器
**特性**：支持单选/多选

#### `ShopSelectorWithLabel`
**路径**：`web/src/components/ozon/ShopSelectorWithLabel.tsx`
**用途**：带标签的店铺选择器

---

### OZON 业务组件

#### `ProductImage`
**路径**：`web/src/components/ozon/ProductImage.tsx`
**用途**：统一的商品图片显示组件
**特性**：
- ✅ 可配置尺寸（小80x80、中160x160）
- ✅ 可配置悬浮行为（显示大图、商品名称、无）
- ✅ 点击打开大图预览（屏幕顶部2/3高度）
- ✅ 支持角标（复选框、OZON链接）
- ✅ 自动图片优化（CDN缩略图）
- ✅ 无图占位符

**Props**：
```typescript
interface ProductImageProps {
  imageUrl?: string;                    // 图片URL
  size?: 'small' | 'medium';            // 默认：small (80x80)
  hoverBehavior?: 'medium' | 'name' | 'none';  // 默认：medium
  name?: string;                        // 商品名称
  onClick?: () => void;                 // 自定义点击事件
  disablePreview?: boolean;             // 禁用点击预览
  topLeftCorner?: 'none' | 'checkbox' | 'link';   // 默认：none
  topRightCorner?: 'none' | 'checkbox' | 'link';  // 默认：none
  checked?: boolean;                    // 复选框选中状态
  onCheckChange?: (checked: boolean) => void;
  checkboxDisabled?: boolean;
  sku?: string;                         // SKU（用于OZON链接）
  offerId?: string;                     // Offer ID
}
```

**使用示例**：
```typescript
// 订单管理：160x160 + 右上角链接 + 悬浮显示名称
<ProductImage
  imageUrl={item.image}
  size="medium"
  hoverBehavior="name"
  name={item.name}
  topRightCorner="link"
  sku={item.sku}
/>

// 商品刊登：80x80 + 悬浮显示160x160
<ProductImage
  imageUrl={product.images?.primary}
  size="small"
  hoverBehavior="medium"
  name={product.title}
  sku={product.sku}
/>
```

#### `OrderDetailModal`
**路径**：`web/src/components/ozon/OrderDetailModal.tsx`
**用途**：统一的订单详情弹窗组件
**特性**：
- ✅ 支持多标签页（基本信息、商品明细、物流信息、财务信息）
- ✅ 根据订单状态控制可编辑字段
- ✅ 支持编辑：进货金额、打包费用、采购平台、订单备注
- ✅ 商品图片使用统一的 `ProductImage` 组件（80x80）
- ✅ 财务信息自动计算利润和利润率
- ✅ 权限判断：`canOperate`、`canSync`

**可编辑条件**：
- **从 `allocating`（分配中）状态开始**可编辑：进货金额、采购平台、订单备注
- **`delivered`（已签收）状态**可编辑：打包费用（同时可同步）

**Props**：
```typescript
interface OrderDetailModalProps {
  visible: boolean;
  onCancel: () => void;
  selectedOrder: ozonApi.Order | null;
  selectedPosting: ozonApi.Posting | null;
  statusConfig: Record<string, { color: string; text: string; icon: React.ReactNode }>;
  userCurrency: string;
  offerIdImageMap: Record<string, string>;
  formatDeliveryMethodTextWhite: (text: string | undefined) => React.ReactNode;
  onUpdate?: () => void; // 数据更新回调
}
```

**使用场景**：
- 订单管理（OrderList.tsx）
- 打包发货（PackingShipment.tsx）

#### `ProductDetailModal`
**路径**：`web/src/components/ozon/ProductDetailModal.tsx`
**用途**：商品详情弹窗

#### `PurchasePriceHistoryModal`
**路径**：`web/src/components/ozon/PurchasePriceHistoryModal.tsx`
**用途**：进货价格历史弹窗

#### `PrintErrorModal`
**路径**：`web/src/components/ozon/order/PrintErrorModal.tsx`
**用途**：打印错误展示弹窗

#### `ShipModal`
**路径**：`web/src/components/ozon/order/ShipModal.tsx`
**用途**：发货弹窗

#### `PrepareStockModal`
**路径**：`web/src/components/ozon/PrepareStockModal.tsx`
**用途**：备货弹窗

#### `DiscardOrderModal`
**路径**：`web/src/components/ozon/DiscardOrderModal.tsx`
**用途**：废弃订单弹窗

#### `DomesticTrackingModal`
**路径**：`web/src/components/ozon/DomesticTrackingModal.tsx`
**用途**：国内单号弹窗

---

## 📦 常量和工具

### OZON 状态映射

#### `OZON_ORDER_STATUS_MAP`
**路径**：`web/src/constants/ozonStatus.ts`
**用途**：订单状态英文到中文的映射
**包含**：11个订单状态（awaiting_packaging, awaiting_deliver, delivering, delivered, cancelled等）

**使用示例**：
```typescript
import { OZON_ORDER_STATUS_MAP } from '@/constants/ozonStatus';

const statusText = OZON_ORDER_STATUS_MAP[status] || status;
```

#### `OZON_OPERATION_STATUS_MAP`
**路径**：`web/src/constants/ozonStatus.ts`
**用途**：操作状态映射（打包发货页面）

#### Helper函数
- `getOrderStatusText(status, defaultText)`: 获取订单状态中文
- `getOperationStatusText(status, defaultText)`: 获取操作状态中文

---

### OZON 订单状态 UI 配置（NEW ✨）

#### `ORDER_STATUS_CONFIG`
**路径**：`web/src/config/ozon/orderStatusConfig.tsx`
**用途**：订单状态的完整 UI 配置（颜色、文本、图标）
**类型**：`Record<string, { color: string; text: string; icon: React.ReactNode }>`

**包含**：
- 7个OZON主状态：等待备货、等待发运、已准备发运、运输中、有争议的、已签收、已取消
- 15+个兼容状态映射

**使用示例**：
```typescript
import { ORDER_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';

// 获取状态配置
const config = ORDER_STATUS_CONFIG[order.status];

// 渲染状态标签
<Tag color={config.color} icon={config.icon}>
  {config.text}
</Tag>
```

**优势**：
- ✅ 单一数据源，消除重复定义（减少200+行代码）
- ✅ 统一UI样式和图标
- ✅ 类型安全，支持 TypeScript
- ✅ 向后兼容旧状态

#### `OPERATION_STATUS_CONFIG`
**路径**：`web/src/config/ozon/orderStatusConfig.tsx`
**用途**：打包发货流程的操作状态配置
**类型**：`Record<string, { color: string; text: string }>`

**状态**：awaiting_stock, allocating, allocated, tracking_confirmed, printed, shipping

**使用示例**：
```typescript
import { OPERATION_STATUS_CONFIG } from '@/config/ozon/orderStatusConfig';

const config = OPERATION_STATUS_CONFIG[operationStatus];
<Tag color={config.color}>{config.text}</Tag>
```

#### 向后兼容导出
**路径**：`web/src/utils/packingHelpers.tsx`
```typescript
// 仍可使用旧的导入方式（已标记为 deprecated）
import { statusConfig, operationStatusConfig } from '@/utils/packingHelpers';
```

---

### 通知工具

#### `notification`
**路径**：`web/src/utils/notification.ts`
**API**：
- `notifySuccess(title, message)`: 成功通知
- `notifyError(title, message)`: 错误通知
- `notifyWarning(title, message)`: 警告通知
- `notifyInfo(title, message)`: 信息通知

---

### 日志工具

#### `loggers`
**路径**：`web/src/utils/logger.ts`
**用途**：统一的日志管理
**API**：
- `loggers.auth`: 认证相关日志
- `loggers.product`: 商品相关日志
- `loggers.order`: 订单相关日志

**使用示例**：
```typescript
import { loggers } from '@/utils/logger';
loggers.product.info('商品同步完成', { count: 10 });
```

**禁止**：使用 `console.log/debug/info`（仅允许 `console.error/warn`）

---

### 表格列配置

#### `useColumnSettings`
**路径**：`web/src/hooks/useColumnSettings.ts`
**用途**：管理表格列的显示/隐藏状态，支持 localStorage 持久化
**特性**：
- ✅ 列显示/隐藏切换
- ✅ 显示所有列
- ✅ 重置为默认配置
- ✅ localStorage 自动保存用户偏好
- ✅ 返回过滤后的可见列

**使用示例**：
```typescript
import { useColumnSettings } from '@/hooks/useColumnSettings';

const columns = [
  { title: '姓名', dataIndex: 'name', key: 'name' },
  { title: '年龄', dataIndex: 'age', key: 'age' },
  { title: '地址', dataIndex: 'address', key: 'address' },
];

const columnSettings = useColumnSettings({
  columns,
  storageKey: 'my-table-columns', // localStorage 存储键名
  defaultHiddenKeys: ['age'], // 默认隐藏的列
});

// 使用过滤后的列
<Table columns={columnSettings.visibleColumns} ... />

// 配合 ColumnSetting 组件使用
<ColumnSetting
  columnConfig={columnSettings.columnConfig}
  onToggle={columnSettings.toggleColumn}
  onShowAll={columnSettings.showAllColumns}
  onReset={columnSettings.resetColumns}
/>
```

#### `ColumnSetting`
**路径**：`web/src/components/ColumnSetting/index.tsx`
**用途**：表格列配置UI组件，显示列设置面板
**特性**：
- ✅ Popover 弹出面板
- ✅ 复选框控制列显示
- ✅ "显示全部"快捷操作
- ✅ "重置"恢复默认配置
- ✅ 固定列不可隐藏（通过 `fixed` 属性）

**使用示例**：
```typescript
import ColumnSetting from '@/components/ColumnSetting';

// 通常与 useColumnSettings Hook 配合使用
<ColumnSetting
  columnConfig={columnSettings.columnConfig}
  onToggle={columnSettings.toggleColumn}
  onShowAll={columnSettings.showAllColumns}
  onReset={columnSettings.resetColumns}
/>
```

**已应用场景**：
- 取消和退货申请列表（CancelReturn.tsx）

---

### 货币工具

#### `formatPriceWithFallback`
**路径**：`web/src/utils/currency.ts`
**用途**：格式化价格，带降级处理

#### `getCurrencySymbol`
**路径**：`web/src/utils/currency.ts`
**用途**：获取货币符号（￥/₽）

---

### OZON 状态映射

#### 退货申请状态映射
**路径**：`web/src/constants/ozonStatus.ts`
**用途**：统一管理 OZON 退货申请和取消申请的状态翻译

**可用常量**：
- `OZON_RETURN_GROUP_STATE_MAP` - 退货状态组（approved/arbitration/delivering/rejected/utilization）
- `OZON_RETURN_STATE_MAP` - 退货详细状态（CheckingStatus/CanceledByBuyer/MoneyReturned等）
- `OZON_CANCELLATION_STATE_MAP` - 取消申请状态（ALL/ON_APPROVAL/APPROVED/REJECTED）
- `OZON_CANCELLATION_INITIATOR_MAP` - 取消申请发起人（CLIENT/SELLER/OZON/SYSTEM/DELIVERY）

**辅助函数**：
```typescript
import {
  getReturnGroupStateText,
  getReturnStateText,
  getCancellationStateText,
  getCancellationInitiatorText
} from '@/constants/ozonStatus';

// 退货状态组：arbitration → "仲裁中"
const groupStateText = getReturnGroupStateText('arbitration');

// 退货详细状态：MoneyReturned → "已退款"
const stateText = getReturnStateText('MoneyReturned');

// 取消申请状态：APPROVED → "已批准"
const cancelStateText = getCancellationStateText('APPROVED');

// 取消发起人：CLIENT → "买家"
const initiatorText = getCancellationInitiatorText('CLIENT');
```

**状态枚举**：

退货状态组（group_state）：
- `approved` - 已批准（已退款/已赔偿）
- `arbitration` - 仲裁中（核查状态）
- `delivering` - 配送中（在途）
- `rejected` - 已拒绝（买家取消）
- `utilization` - 已处置（OZON销毁）

退货详细状态（state）：
- `CheckingStatus` - 核查状态中
- `CanceledByBuyer` - 买家取消
- `MoneyReturned` - 已退款
- `PartialCompensationReturned` - 已支付部分补偿
- `PartialCompensationReturnedByOzon` - OZON已支付补偿
- `OnWay` - 在途
- `OnWayToOzon` - 在途（返回OZON）
- `UtilizedByOzon` - 已由OZON销毁
- `UtilizingByOzon` - OZON销毁处理中

---

## 📝 开发规范

### 使用原则

1. **先查阅，后开发**：实现功能前必须先查阅此文档
2. **禁止重复造轮子**：发现类似功能优先复用现有 Hook/组件
3. **及时更新文档**：新增通用 Hook/组件后立即更新此文档
4. **遵循命名规范**：Hook 以 `use` 开头，组件大写

### 何时抽取新 Hook

满足以下任一条件应抽取为独立 Hook：
- ✅ 相同逻辑在 3 个及以上地方使用
- ✅ 业务逻辑复杂（超过50行代码）
- ✅ 有明确的复用潜力

### 何时创建新组件

满足以下任一条件应抽取为独立组件：
- ✅ 相同 UI 在 2 个及以上地方使用
- ✅ 组件代码超过 200 行
- ✅ 具有独立的业务含义

---

## 🔍 快速查找

### 按功能查找

- **异步任务轮询** → `useAsyncTaskPolling`
- **权限判断** → `usePermission`
- **复制文本** → `useCopy`
- **货币转换** → `useCurrency`
- **状态映射** → `OZON_ORDER_STATUS_MAP`
- **通知提示** → `notification` 工具
- **日志记录** → `loggers`

### 按场景查找

- **订单同步** → `useAsyncTaskPolling` + `ozonApi.syncOrders`
- **商品操作** → `useProductOperations`
- **水印处理** → `useWatermark`
- **批量打印** → `useBatchPrint`

---

## 📚 相关文档

- **异步轮询详细文档**：`web/src/hooks/useAsyncTaskPolling.example.md`
- **开发规范**：`CLAUDE.md`
- **FAQ**：`FAQ.md`

---

## 📝 页面功能说明

### Posting Number 链接

所有显示 `posting_number`（货件编号）的页面都支持点击查看订单详情：

| 页面 | 点击行为 | 说明 |
|------|----------|------|
| **订单管理** (OrderList.tsx) | 弹出 `OrderDetailModal` | 完整订单详情，支持编辑 |
| **打包发货** (PackingShipment.tsx) | 弹出 `OrderDetailModal` | 完整订单详情，支持编辑 |
| **订单报表** (OrderReport.tsx) | 弹出简化 Modal | 统计数据展示，不支持编辑 |
| **财务交易** (FinanceTransactions.tsx) | 跳转到订单管理页面 | 自动搜索该 posting_number |

**实现原则**：
- 有完整订单数据的页面：使用 `OrderDetailModal`
- 仅有统计数据的页面：使用简化 Modal 或跳转

---

## ⚙️ Services（业务逻辑层）

### 商品标题管理

#### `productTitleService`
**路径**：`web/src/services/ozon/productTitleService.ts`
**用途**：OZON 商品标题生成与翻译服务
**职责**：
- 按 OZON 官方命名规范生成商品标题
- 提供标题翻译功能（中文 ↔ 俄文）
- 检查类目是否支持自动生成标题

**主要 API**：
```typescript
// 生成商品标题
const title = generateProductTitle({
  form,                    // Form 实例
  selectedCategory,        // 选中的类目 ID
  categoryTree,            // 类目树
  categoryAttributes,      // 类目属性列表
  dictionaryValuesCache,   // 字典值缓存
  variantManager           // 变体管理器
});

// 翻译标题
const translated = await translateTitle({
  text: '原文',
  sourceLang: 'zh',
  targetLang: 'ru'
});

// 检查类目
const isAuto = isAutoTitleCategory('服装'); // false
```

**已应用场景**：
- ProductCreate.tsx（商品创建）
- ProductEdit.tsx（商品编辑，待迁移）

---

### 类目管理

#### `categoryService`
**路径**：`web/src/services/ozon/categoryService.ts`
**用途**：OZON 类目树数据加载与管理服务
**职责**：
- 类目树数据加载
- 类目属性加载
- 字典值搜索
- 类目路径查询与转换

**主要 API**：
```typescript
// 加载类目树
const tree = await loadCategoryTree();

// 加载类目属性
const result = await loadCategoryAttributes({
  shopId: 123,
  categoryId: 456
});

// 加载字典值
const values = await loadDictionaryValues(
  shopId,
  categoryId,
  attributeId,
  query,      // 可选：搜索关键词
  100         // 限制返回数量
);

// 获取类目路径
const path = getCategoryPath(categoryId, tree);
// 返回: [parent1, parent2, categoryId]

// 获取类目名称
const name = getCategoryNameById(categoryId, tree);

// 提取特殊字段说明
const descriptions = extractSpecialFieldDescriptions(attributes);

// 提取变体维度属性
const aspectAttrs = extractAspectAttributes(attributes);
```

**已应用场景**：
- ProductCreate.tsx（商品创建）
- ProductEdit.tsx（商品编辑，待迁移）

---

### 商品提交管理

#### `productSubmitService`
**路径**：`web/src/services/ozon/productSubmitService.ts`
**用途**：商品提交数据转换与处理服务
**职责**：
- 包装尺寸同步到类目属性
- 表单数据转换为 OZON API 格式
- 属性与变体的格式转换
- 商品提交参数组装

**主要 API**：
```typescript
// 同步包装尺寸到类目属性
syncDimensionsToAttributes({
  form,
  categoryAttributes,
  changedFields: ['width', 'height', 'depth', 'weight']
});

// 转换属性为 API 格式
const attributes = formatAttributesForAPI(form, categoryAttributes);

// 转换变体为 API 格式
const variants = formatVariantsForAPI(
  variantManager.variants,
  categoryAttributes
);

// 解析 TextArea 多行文本
const urls = parseTextAreaToArray(textAreaValue);
// 输入: "url1\nurl2\n\nurl3"
// 输出: ["url1", "url2", "url3"]

// 获取父类目 ID
const parentId = getDescriptionCategoryId(categoryPath);
// 输入: [parent1, parent2, categoryId]
// 输出: parent2
```

**已应用场景**：
- ProductCreate.tsx（商品创建）
- ProductEdit.tsx（商品编辑，待迁移）

---

## 🔍 快速查找

### 按功能查找

- **异步任务轮询** → `useAsyncTaskPolling`
- **权限判断** → `usePermission`
- **复制文本** → `useCopy`
- **货币转换** → `useCurrency`
- **状态映射** → `OZON_ORDER_STATUS_MAP`
- **通知提示** → `notification` 工具
- **日志记录** → `loggers`
- **商品标题生成** → `productTitleService`
- **类目管理** → `categoryService`
- **商品提交转换** → `productSubmitService`

### 按场景查找

- **订单同步** → `useAsyncTaskPolling` + `ozonApi.syncOrders`
- **商品操作** → `useProductOperations`
- **水印处理** → `useWatermark`
- **批量打印** → `useBatchPrint`
- **商品标题生成** → `productTitleService.generateProductTitle`
- **商品数据转换** → `productSubmitService`

---

## 📚 相关文档

- **异步轮询详细文档**：`web/src/hooks/useAsyncTaskPolling.example.md`
- **ProductCreate 拆分指南**：`docs/ProductCreate-Migration-Guide.md`
- **开发规范**：`CLAUDE.md`
- **FAQ**：`FAQ.md`

---

## 📝 页面功能说明

### Posting Number 链接

所有显示 `posting_number`（货件编号）的页面都支持点击查看订单详情：

| 页面 | 点击行为 | 说明 |
|------|----------|------|
| **订单管理** (OrderList.tsx) | 弹出 `OrderDetailModal` | 完整订单详情，支持编辑 |
| **打包发货** (PackingShipment.tsx) | 弹出 `OrderDetailModal` | 完整订单详情，支持编辑 |
| **订单报表** (OrderReport.tsx) | 弹出简化 Modal | 统计数据展示，不支持编辑 |
| **财务交易** (FinanceTransactions.tsx) | 跳转到订单管理页面 | 自动搜索该 posting_number |

**实现原则**：
- 有完整订单数据的页面：使用 `OrderDetailModal`
- 仅有统计数据的页面：使用简化 Modal 或跳转

---

**最后更新**：2025-11-24（新增 3 个 OZON Service 模块：productTitleService、categoryService、productSubmitService）
**维护者**：开发团队
