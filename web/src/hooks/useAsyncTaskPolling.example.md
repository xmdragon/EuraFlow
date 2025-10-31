# useAsyncTaskPolling Hook 使用指南

## 概述

`useAsyncTaskPolling` 是一个通用的异步任务轮询 Hook，用于统一处理后台任务的轮询、进度显示、用户取消等逻辑。

## 核心特性

- ✅ 统一的轮询逻辑
- ✅ 自动进度通知显示
- ✅ 用户手动关闭通知时自动停止轮询
- ✅ 超时检测与处理
- ✅ 404 错误自动停止轮询
- ✅ 可自定义进度和成功消息格式
- ✅ 组件卸载时自动清理

## 基础用法

### 1. 订单同步示例 (OrderList.tsx)

```typescript
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import * as ozonApi from '@/services/ozonApi';

const OrderList: React.FC = () => {
  const queryClient = useQueryClient();

  // 创建轮询 Hook 实例
  const { startPolling: startOrderSyncPolling } = useAsyncTaskPolling({
    // 任务状态查询函数（必须）
    getStatus: async (taskId) => {
      const result = await ozonApi.getSyncStatus(taskId);
      const status = result.data || result;

      // 转换为统一的状态格式
      if (status.status === 'completed') {
        return { state: 'SUCCESS', result: status };
      } else if (status.status === 'failed') {
        return { state: 'FAILURE', error: status.error || '未知错误' };
      } else {
        return { state: 'PROGRESS', info: status };
      }
    },

    // 轮询配置
    pollingInterval: 2000,      // 每2秒轮询一次
    timeout: 30 * 60 * 1000,    // 30分钟超时
    notificationKey: 'order-sync', // 通知唯一标识

    // 通知文本
    initialMessage: '订单同步进行中',

    // 格式化进度显示（可选）
    formatProgressContent: (info) => {
      const percent = Math.round(info.progress || 0);
      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>{info.message || '处理中...'}</div>
        </div>
      );
    },

    // 格式化成功消息（可选）
    formatSuccessMessage: () => ({
      title: '同步完成',
      description: '订单同步已完成！',
    }),

    // 成功回调（可选）
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
    },
  });

  // 在异步任务启动后调用
  const syncOrdersMutation = useMutation({
    mutationFn: (fullSync: boolean) => {
      return ozonApi.syncOrdersDirect(selectedShop, fullSync ? 'full' : 'incremental');
    },
    onSuccess: (data) => {
      const taskId = data?.task_id || data?.data?.task_id;
      if (taskId) {
        startOrderSyncPolling(taskId); // 启动轮询
      }
    },
  });

  // ...
};
```

### 2. 类目同步示例 (GlobalSettingsTab.tsx)

```typescript
import { useAsyncTaskPolling } from '@/hooks/useAsyncTaskPolling';
import * as ozonApi from '@/services/ozonApi';

const GlobalSettingsTab: React.FC = () => {
  const queryClient = useQueryClient();
  const [syncing, setSyncing] = useState(false);

  // 类目树同步轮询
  const { startPolling: startCategorySyncPolling } = useAsyncTaskPolling({
    getStatus: async (taskId) => {
      const status = await ozonApi.getCategorySyncTaskStatus(taskId);

      // 转换为统一格式
      if (status.state === 'SUCCESS') {
        return { state: 'SUCCESS', result: status.result };
      } else if (status.state === 'FAILURE') {
        return { state: 'FAILURE', error: status.error };
      } else {
        return { state: 'PROGRESS', info: status.info };
      }
    },
    pollingInterval: 5000, // 5秒轮询
    notificationKey: 'category-sync',
    initialMessage: '类目同步进行中',
    formatProgressContent: (info) => {
      const { processed_categories = 0, total_categories = 0, current_category = '', percent = 0 } = info;
      return (
        <div>
          <Progress percent={percent} size="small" status="active" />
          <div style={{ marginTop: 8 }}>
            {current_category.includes('准备中') || current_category.includes('等待')
              ? current_category
              : `正在处理 "${current_category}"...`}
          </div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#666' }}>
            已完成 {processed_categories}/{total_categories} 个类目
          </div>
        </div>
      );
    },
    formatSuccessMessage: (result) => ({
      title: '同步完成',
      description: `成功同步 ${result.total_categories || 0} 个类目（新增 ${result.new_categories || 0}，更新 ${result.updated_categories || 0}）`,
    }),
    onSuccess: () => {
      setSyncing(false);
      queryClient.invalidateQueries({ queryKey: ['category-tree'] });
    },
    onFailure: () => {
      setSyncing(false);
    },
    onTimeout: () => {
      setSyncing(false);
    },
    onCancel: () => {
      setSyncing(false);
    },
  });

  // 触发类目同步
  const handleSyncCategories = async () => {
    if (syncing) return;

    setSyncing(true);
    try {
      const result = await ozonApi.syncCategoryTree(selectedShop);
      const taskId = result.task_id;
      startCategorySyncPolling(taskId);
    } catch (error: any) {
      setSyncing(false);
      notifyError('同步失败', error.message);
    }
  };

  // ...
};
```

## API 参考

### UseAsyncTaskPollingOptions

| 参数 | 类型 | 必需 | 默认值 | 说明 |
|------|------|------|--------|------|
| `getStatus` | `(taskId: string) => Promise<TaskStatus>` | ✅ | - | 任务状态查询函数 |
| `pollingInterval` | `number` | ❌ | 2000 | 轮询间隔（毫秒） |
| `timeout` | `number` | ❌ | 1800000 | 超时时间（毫秒，默认30分钟） |
| `notificationKey` | `string` | ❌ | 'async-task' | 通知的唯一标识 |
| `initialMessage` | `string` | ❌ | '任务进行中' | 初始通知消息 |
| `formatProgressContent` | `(info: any) => ReactNode` | ❌ | - | 进度内容格式化函数 |
| `formatSuccessMessage` | `(result: any) => { title, description }` | ❌ | - | 成功消息格式化函数 |
| `onSuccess` | `(result: any) => void` | ❌ | - | 成功回调 |
| `onFailure` | `(error: string) => void` | ❌ | - | 失败回调 |
| `onTimeout` | `() => void` | ❌ | - | 超时回调 |
| `onCancel` | `() => void` | ❌ | - | 取消回调 |

### TaskStatus 格式

```typescript
interface TaskStatus {
  state: 'PENDING' | 'SUCCESS' | 'FAILURE' | 'PROGRESS';
  result?: any;           // 成功时的结果
  error?: string;         // 失败时的错误消息
  info?: {                // 进行中的信息
    status?: string;
    progress?: number;    // 进度百分比 0-100
    message?: string;     // 当前处理消息
    [key: string]: any;   // 其他自定义字段
  };
}
```

### 返回值

```typescript
{
  startPolling: (taskId: string) => void;  // 启动轮询
  stopPolling: () => void;                 // 停止轮询
  isPolling: boolean;                      // 是否正在轮询
}
```

## 最佳实践

### 1. 状态管理

建议配合组件状态管理使用：

```typescript
const [syncing, setSyncing] = useState(false);

const { startPolling } = useAsyncTaskPolling({
  // ...
  onSuccess: () => {
    setSyncing(false);
  },
  onFailure: () => {
    setSyncing(false);
  },
  onCancel: () => {
    setSyncing(false);
  },
});

// 触发任务前设置状态
const handleSync = async () => {
  setSyncing(true);
  // ...
  startPolling(taskId);
};
```

### 2. 错误处理

在 `getStatus` 函数中统一处理 API 错误：

```typescript
getStatus: async (taskId) => {
  try {
    const result = await api.getStatus(taskId);
    // 转换格式...
    return { state: 'SUCCESS', result };
  } catch (error: any) {
    // API 错误会被 Hook 自动处理（如 404）
    throw error;
  }
}
```

### 3. 多个轮询实例

同一个组件可以创建多个独立的轮询实例：

```typescript
const { startPolling: startCategorySync } = useAsyncTaskPolling({
  notificationKey: 'category-sync',
  // ...
});

const { startPolling: startAttributeSync } = useAsyncTaskPolling({
  notificationKey: 'attribute-sync',
  // ...
});
```

## 注意事项

1. **唯一的 notificationKey**：确保每个轮询任务有唯一的 `notificationKey`，避免通知冲突
2. **状态转换**：`getStatus` 必须返回统一的 `TaskStatus` 格式
3. **组件卸载**：Hook 会在组件卸载时自动清理，无需手动调用 `stopPolling`
4. **用户取消**：当用户关闭通知时，会自动停止轮询并触发 `onCancel` 回调

## 迁移指南

### 从旧轮询逻辑迁移

**旧代码**：
```typescript
const pollStatus = async (taskId: string) => {
  const interval = setInterval(async () => {
    // 轮询逻辑...
  }, 2000);
};
```

**新代码**：
```typescript
const { startPolling } = useAsyncTaskPolling({
  getStatus: async (taskId) => { /* ... */ },
  pollingInterval: 2000,
  // ...
});
```

主要优势：
- ✅ 自动处理用户取消
- ✅ 自动清理资源
- ✅ 统一的错误处理
- ✅ 更少的代码量
