# 上传失败排查指南

## 问题：测试连接成功，但上传失败

即使API配置测试通过，上传数据时仍可能失败。以下是常见原因和解决方案。

---

## 常见错误信息及解决方案

### 1. "API Key无效或权限不足"

**原因**：
- API Key缺少 `product_selection:write` 权限
- 测试连接只需要读取用户信息的权限
- 上传需要**写入**权限

**解决方案**：
1. 登录 EuraFlow 系统
2. 进入"系统设置" → "API密钥管理"
3. 检查当前API Key的权限列表
4. 确保包含 `product_selection:write` 权限
5. 如果没有，创建新的API Key并选择正确的权限

---

### 2. "数据量过大（最多1000条）"

**原因**：
- 单次上传超过1000条商品
- 服务器限制单次上传最大数量

**解决方案**：
- 方法A：减少采集目标数量（输入框改为≤1000）
- 方法B：分批上传（采集100个 → 上传 → 继续采集100个）

---

### 3. "没有可上传的商品" 或 "没有有效的商品数据"

**原因**：
- 采集的商品缺少 `product_id`（必需字段）
- 数据提取失败

**解决方案**：
1. 按 F12 打开控制台
2. 启用DEBUG模式：`window.EURAFLOW_DEBUG = true`
3. 重新采集，观察是否有错误信息
4. 运行诊断脚本（见 `DIAGNOSE.js`）

---

### 4. "上传超时（请检查网络连接或减少上传数量）"

**原因**：
- 网络速度慢
- 上传数据量太大
- 服务器响应慢

**解决方案**：
- 减少单次上传数量（建议≤200）
- 检查网络连接
- 检查API地址是否正确（不要有多余的斜杠）

**正确格式**：
```
✅ https://your-domain.com
❌ https://your-domain.com/
```

---

### 5. "网络连接失败（请检查API地址和网络）"

**原因**：
- API地址错误
- 网络不通
- 防火墙/代理阻止

**解决方案**：
1. 检查API地址格式（见上面的正确格式）
2. 在浏览器直接访问 `{你的API地址}/api/ef/v1/auth/me`
   - 应该显示登录页面或401错误
   - 如果无法访问，说明地址错误或服务器不可达
3. 检查浏览器是否使用了代理
4. 暂时关闭VPN/防火墙测试

---

### 6. "服务器错误 (HTTP 500)"

**原因**：
- 服务器内部错误
- 数据库问题
- 数据格式导致服务器崩溃

**解决方案**：
1. 联系系统管理员检查服务器日志
2. 查看服务器日志：
   ```bash
   ssh 服务器
   tail -100 /opt/euraflow/logs/backend-stderr.log
   ```
3. 可能需要重启服务：
   ```bash
   cd /opt/euraflow && ./restart.sh
   ```

---

## 排查步骤（按顺序执行）

### 步骤1：确认API Key权限

在控制台运行以下代码，检查API Key权限：

```javascript
// 获取当前配置
chrome.storage.sync.get(['apiUrl', 'apiKey'], async (config) => {
  console.log('API URL:', config.apiUrl);
  console.log('API Key:', config.apiKey ? '已设置' : '未设置');

  // 测试连接
  const response = await fetch(`${config.apiUrl}/api/ef/v1/auth/me`, {
    headers: { 'X-API-Key': config.apiKey }
  });

  if (response.ok) {
    const data = await response.json();
    console.log('✅ 连接成功');
    console.log('用户信息:', data);
    console.log('权限列表:', data.permissions || '未返回权限信息');

    // 检查是否有写入权限
    if (data.permissions && data.permissions.includes('product_selection:write')) {
      console.log('✅ 具有上传权限');
    } else {
      console.error('❌ 缺少 product_selection:write 权限');
    }
  } else {
    console.error('❌ 连接失败:', response.status);
  }
});
```

---

### 步骤2：检查采集的数据

在控制台运行：

```javascript
// 查看采集的商品
const products = window.__EURAFLOW_COLLECTOR__?.getCollectedProducts() || [];
console.log('采集数量:', products.length);

if (products.length > 0) {
  const first = products[0];
  console.log('第一个商品:', first);

  // 检查必需字段
  console.log('product_id:', first.product_id ? '✅' : '❌ 缺失');
  console.log('product_name:', first.product_name_ru || first.product_name_cn ? '✅' : '⚠️ 缺失');

  // 检查有多少个商品缺少product_id
  const invalid = products.filter(p => !p.product_id);
  if (invalid.length > 0) {
    console.error(`❌ 有 ${invalid.length} 个商品缺少product_id`);
  } else {
    console.log('✅ 所有商品都有product_id');
  }
}
```

---

### 步骤3：手动测试上传接口

在控制台运行：

```javascript
// 手动测试上传（只上传1个商品）
chrome.storage.sync.get(['apiUrl', 'apiKey'], async (config) => {
  const testProduct = {
    product_id: '123456789',
    product_name_ru: 'Test Product',
    brand: 'Test Brand',
    current_price: 100,
    ozon_link: 'https://ozon.ru/product/test-123456789'
  };

  console.log('测试上传单个商品...');

  try {
    const response = await fetch(`${config.apiUrl}/api/ef/v1/ozon/product-selection/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.apiKey
      },
      body: JSON.stringify({ products: [testProduct] })
    });

    console.log('HTTP状态:', response.status);

    const data = await response.json();
    console.log('响应数据:', data);

    if (response.ok) {
      console.log('✅ 上传成功');
    } else {
      console.error('❌ 上传失败');
      console.error('错误详情:', data);
    }
  } catch (error) {
    console.error('❌ 请求异常:', error);
  }
});
```

---

## 改进后的错误提示

扩展现在会显示更详细的错误信息：

| 旧错误提示 | 新错误提示 |
|---------|---------|
| "上传失败" | "API Key无效或权限不足" |
| "上传失败" | "数据量过大（最多1000条）" |
| "上传失败" | "上传超时（请检查网络连接...）" |
| "上传失败" | "网络连接失败（请检查API地址...）" |

---

## 获取帮助

如果上述方法都无法解决问题，请提供以下信息：

1. **错误截图**：包含完整的错误提示
2. **控制台日志**：按F12打开，截图Console标签
3. **API配置**：API URL（隐去敏感部分）
4. **步骤1-3的输出结果**

联系方式：[技术支持邮箱/微信]

---

## 常见问题FAQ

**Q: 为什么测试连接成功，上传还是失败？**

A: 测试连接只验证API Key是否有效，不检查权限。上传需要额外的写入权限。

---

**Q: 如何知道我的API Key有哪些权限？**

A: 运行步骤1的脚本，或在EuraFlow系统的"API密钥管理"页面查看。

---

**Q: 上传超时时间是多少？**

A: 默认60秒。如果超时，建议减少单次上传数量。

---

**Q: 可以同时上传多少个商品？**

A: 最多1000个。建议单次上传100-200个以获得最佳性能。
