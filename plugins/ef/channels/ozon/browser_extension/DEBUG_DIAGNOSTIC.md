# EuraFlow 选品助手诊断指南

## 问题：进度条不更新，但滚动和上品帮数据都正常

### 可能原因分析

1. **指纹去重机制拦截**：已采集的商品被识别为"重复"
2. **商品ID提取失败**：无法正确解析 product_id
3. **数据融合异常**：多数据源融合时出错
4. **页面未刷新**：指纹集累积过多

---

## 诊断步骤

### 步骤1：启用DEBUG模式

在浏览器控制台（F12）输入：

```javascript
window.EURAFLOW_DEBUG = true
```

然后点击"开始采集"，观察控制台输出。

---

### 步骤2：检查指纹集状态

在控制台输入以下代码，查看当前指纹集大小：

```javascript
// 访问采集器实例（可能需要从window对象获取）
console.log('当前页面是否有扩展运行:', typeof window.EURAFLOW_DEBUG !== 'undefined')
```

---

### 步骤3：手动检查商品卡片

在控制台运行以下诊断脚本：

```javascript
// === 诊断脚本：检查商品卡片和数据提取 ===

// 1. 查找所有商品卡片
const cards = document.querySelectorAll('div[type="item"]');
console.log('找到商品卡片数量:', cards.length);

if (cards.length === 0) {
  console.error('❌ 没有找到商品卡片！可能选择器失效。');
} else {
  console.log('✅ 找到商品卡片');

  // 2. 检查第一个卡片
  const firstCard = cards[0];
  console.log('第一个卡片元素:', firstCard);

  // 3. 检查上品帮数据
  const bangElement = firstCard.querySelector('.ozon-bang-item[data-ozon-bang="true"]') ||
                       firstCard.querySelector('.ozon-bang-item');

  if (bangElement) {
    console.log('✅ 找到上品帮数据元素');
    console.log('上品帮数据内容:', bangElement.textContent);
  } else {
    console.error('❌ 没有找到上品帮数据！');
  }

  // 4. 检查商品链接（用于提取product_id）
  const link = firstCard.querySelector('a[href*="/product/"]');
  if (link) {
    console.log('✅ 找到商品链接:', link.href);

    // 提取product_id
    const match = link.href.match(/\/product\/[^\/]+?-(\d+)/);
    if (match) {
      console.log('✅ 成功提取 product_id:', match[1]);
    } else {
      console.error('❌ 无法从链接提取 product_id');
    }
  } else {
    console.error('❌ 没有找到商品链接！');
  }

  // 5. 检查图片（可选）
  const img = firstCard.querySelector('img');
  if (img) {
    console.log('✅ 找到商品图片');
  } else {
    console.warn('⚠️ 没有找到商品图片');
  }
}

console.log('\n=== 诊断完成 ===');
console.log('如果上面有 ❌ 错误，请截图发送给开发者');
```

---

### 步骤4：检查扩展配置

在控制台输入：

```javascript
// 检查扩展配置
chrome.storage.sync.get(['apiUrl', 'apiKey', 'autoUpload', 'targetCount'], (config) => {
  console.log('扩展配置:', config);
  console.log('API URL:', config.apiUrl || '未设置');
  console.log('API Key:', config.apiKey ? '已设置' : '未设置');
  console.log('自动上传:', config.autoUpload);
  console.log('目标数量:', config.targetCount);
});
```

---

### 步骤5：清空缓存并重试

如果怀疑是指纹集问题，尝试：

1. **刷新页面**（F5）- 这会清空内存中的指纹集
2. **重新打开页面** - 从Ozon首页重新搜索进入商品列表
3. **清除浏览器缓存** - Edge设置 → 隐私 → 清除浏览数据

---

### 步骤6：检查上品帮扩展

确认上品帮扩展是否正常工作：

```javascript
// 检查页面上有多少个上品帮数据元素
const bangElements = document.querySelectorAll('.ozon-bang-item[data-ozon-bang="true"]');
console.log('上品帮数据元素数量:', bangElements.length);

if (bangElements.length === 0) {
  console.error('❌ 上品帮扩展可能未正常工作！');
  console.log('提示：检查上品帮扩展是否已启用，或者刷新页面重试');
}
```

---

## 常见问题排查

### Q1: 控制台显示 "无法提取商品ID"

**原因**：Ozon页面DOM结构变化，选择器失效

**解决方案**：
1. 截图当前页面HTML结构
2. 联系开发者更新选择器

---

### Q2: 控制台没有任何DEBUG输出

**原因**：扩展未正确加载

**解决方案**：
1. 检查扩展是否已启用（Edge扩展管理页面）
2. 重新加载扩展（点击扩展管理页面的"重新加载"）
3. 刷新Ozon页面

---

### Q3: 滚动但不采集（进度为0）

**原因1**：所有商品都在指纹集中（已上传过）

**解决方案**：
- 刷新页面，清空指纹集
- 搜索不同的关键词

**原因2**：product_id 提取失败

**解决方案**：
- 运行步骤3的诊断脚本
- 查看控制台是否有错误信息

---

### Q4: DEBUG模式下看到 "[DEBUG] 采集到新商品"，但进度条不更新

**原因**：进度回调函数未触发

**解决方案**：
```javascript
// 手动检查进度更新机制
window.EURAFLOW_DEBUG = true;

// 重新开始采集，观察控制台
// 应该看到 "[DEBUG] 进度更新: {...}" 的输出
```

---

## 收集诊断信息

如果问题仍未解决，请收集以下信息并反馈：

1. **控制台完整输出**（截图或复制文字）
2. **步骤3诊断脚本的输出**
3. **浏览器版本**：Edge → 帮助和反馈 → 关于 Microsoft Edge
4. **扩展版本**：v1.2.6
5. **上品帮扩展版本**
6. **问题页面URL**（Ozon商品列表页）

---

## 临时解决方案

如果确认是指纹集累积问题，可以使用以下脚本手动清空：

```javascript
// ⚠️ 仅用于测试，不建议常规使用
// 这个脚本会清空采集器的指纹集（需要访问内部实例）

console.log('注意：此功能需要扩展开放内部API');
console.log('建议直接刷新页面（F5）来重置');
```

---

## 联系支持

如果上述方法都无法解决，请联系技术支持并提供诊断信息。
