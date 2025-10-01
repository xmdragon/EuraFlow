# Tampermonkey脚本升级指南

## 概述
为`ozon_product_selector.user.js`添加API自动上传功能，使采集的数据可以直接上传到EuraFlow系统。

---

## 升级步骤

### 1. 已完成的修改（在CONFIG部分）

```javascript
// API上传配置（从localStorage读取）
apiEnabled: false,               // 是否启用API上传
apiUrl: '',                      // API地址
apiKey: '',                      // API Key
autoUpload: false                // 自动上传（采集完成后）

// 配置加载和保存函数也已添加
loadAPIConfig()
saveAPIConfig()
```

### 2. 需要添加的API上传功能

在脚本中找到`exportCSV`方法后面，添加以下两个新方法：

```javascript
// 在exportCSV方法后添加

// 上传数据到API
async uploadToAPI() {
    if (!CONFIG.apiEnabled) {
        alert('API上传未启用\n请在"API设置"中配置');
        return;
    }

    if (!CONFIG.apiUrl || !CONFIG.apiKey) {
        alert('请先配置API地址和Key');
        return;
    }

    const stats = this.collector.getStats();
    if (stats.products.length === 0) {
        alert('没有数据可上传');
        return;
    }

    try {
        this.updateStatus('🚀 正在上传数据...');

        // 转换数据格式
        const products = stats.products.map(p => ({
            product_id: p['商品ID'],
            product_name_ru: p['商品名称'],
            brand: p['品牌'],
            current_price: this.parseNumber(p['销售价格']),
            original_price: this.parseNumber(p['原价']),
            ozon_link: p['商品链接'],
            image_url: p['商品图片'],
            category_link: p['类目链接'],
            rfbs_commission_low: this.parseNumber(p['RFBS <= 1500佣金（%）']),
            rfbs_commission_mid: this.parseNumber(p['RFBS在 1501~5000佣金（%）']),
            rfbs_commission_high: this.parseNumber(p['RFBS > 5000佣金（%）']),
            fbp_commission_low: this.parseNumber(p['FBP <= 1500佣金（%）']),
            fbp_commission_mid: this.parseNumber(p['FBP在 1501~5000佣金（%）']),
            fbp_commission_high: this.parseNumber(p['FBP > 5000佣金（%）']),
            monthly_sales_volume: this.parseInteger(p['30天内的销量(件)']),
            monthly_sales_revenue: this.parseNumber(p['30天内的销售额']),
            daily_sales_volume: this.parseInteger(p['平均日销量(件)']),
            daily_sales_revenue: this.parseNumber(p['平均日销售额']),
            sales_dynamic_percent: this.parseNumber(p['销售动态(%)']),
            conversion_rate: this.parseNumber(p['成交率（%）']),
            package_weight: this.parseInteger(p['包装重量(g)']),
            package_volume: this.parseInteger(p['商品体积（升）']),
            package_length: this.parseInteger(p['包装长(mm)']),
            package_width: this.parseInteger(p['包装宽(mm)']),
            package_height: this.parseInteger(p['包装高(mm)']),
            rating: this.parseNumber(p['商品评分']),
            review_count: this.parseInteger(p['评价次数']),
            seller_type: p['卖家类型'],
            delivery_days: this.parseInteger(p['配送时间（天）']),
            availability_percent: this.parseNumber(p['商品可用性(%)']),
            ad_cost_share: this.parseNumber(p['广告费用份额（%）']),
            product_created_date: p['商品创建日期'],
            competitor_count: this.parseInteger(p['跟卖者数量']),
            competitor_min_price: this.parseNumber(p['最低跟卖价'])
        }));

        // 发送请求
        const url = `${CONFIG.apiUrl}/api/ef/v1/ozon/product-selection/upload`;
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': CONFIG.apiKey
            },
            body: JSON.stringify({ products })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail?.message || `HTTP ${response.status}`);
        }

        const result = await response.json();
        this.updateStatus(`✅ 上传成功: ${result.success_count}/${result.total} 个商品`);

        if (result.failed_count > 0) {
            console.warn('部分商品上传失败:', result.errors);
        }

    } catch (error) {
        console.error('上传失败:', error);
        this.updateStatus(`❌ 上传失败: ${error.message}`);
        alert(`上传失败:\n${error.message}`);
    }
}

// 辅助方法：解析数字
parseNumber(value) {
    if (!value || value === '-') return null;
    const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
    return isNaN(num) ? null : num;
}

// 辅助方法：解析整数
parseInteger(value) {
    if (!value || value === '-') return null;
    const num = parseInt(String(value).replace(/[^\d]/g, ''));
    return isNaN(num) ? null : num;
}

// 测试API连接
async testAPIConnection() {
    if (!CONFIG.apiUrl || !CONFIG.apiKey) {
        alert('请先配置API地址和Key');
        return;
    }

    try {
        this.updateStatus('🔍 测试连接...');
        const url = `${CONFIG.apiUrl}/api/ef/v1/auth/me`;
        const response = await fetch(url, {
            headers: { 'X-API-Key': CONFIG.apiKey }
        });

        if (response.ok) {
            const data = await response.json();
            this.updateStatus(`✅ 连接成功！用户: ${data.username}`);
            alert(`连接成功！\n用户: ${data.username}\nAPI Key有效`);
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        this.updateStatus(`❌ 连接失败: ${error.message}`);
        alert(`连接失败:\n${error.message}\n\n请检查:\n1. API地址是否正确\n2. API Key是否有效\n3. 网络是否通畅`);
    }
}
```

### 3. UI增强

在`createPanel()`方法中，找到"导出CSV"按钮的代码，在其后添加：

```javascript
// 在"导出CSV"按钮后添加

// 上传按钮
<button id="upload-api-btn" style="
    padding: 10px 20px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    color: white;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 500;
    margin-top: 10px;
    width: 100%;
">
    🚀 上传到系统
</button>

<!-- API设置区域（可折叠） -->
<details style="margin-top: 15px; padding: 10px; background: #f8f9fa; border-radius: 6px;">
    <summary style="cursor: pointer; font-weight: 500; padding: 5px;">⚙️ API设置</summary>
    <div style="margin-top: 10px;">
        <label style="display: block; margin-bottom: 5px; font-size: 12px;">
            <input type="checkbox" id="api-enabled-checkbox" ${CONFIG.apiEnabled ? 'checked' : ''}>
            启用API上传
        </label>

        <label style="display: block; margin-bottom: 5px; font-size: 12px;">API地址:</label>
        <input type="text" id="api-url-input" value="${CONFIG.apiUrl}" placeholder="https://your-domain.com" style="
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            font-size: 12px;
        ">

        <label style="display: block; margin-bottom: 5px; font-size: 12px;">API Key:</label>
        <input type="password" id="api-key-input" value="${CONFIG.apiKey}" placeholder="ef_live_xxxxx..." style="
            width: 100%;
            padding: 8px;
            border: 1px solid #ddd;
            border-radius: 4px;
            margin-bottom: 10px;
            font-size: 12px;
        ">

        <label style="display: block; margin-bottom: 10px; font-size: 12px;">
            <input type="checkbox" id="auto-upload-checkbox" ${CONFIG.autoUpload ? 'checked' : ''}>
            采集完成后自动上传
        </label>

        <button id="save-api-config-btn" style="
            padding: 8px 16px;
            background: #28a745;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
            margin-bottom: 5px;
        ">💾 保存配置</button>

        <button id="test-api-btn" style="
            padding: 8px 16px;
            background: #17a2b8;
            color: white;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            width: 100%;
        ">🔍 测试连接</button>
    </div>
</details>
```

### 4. 事件绑定

在`addEventListeners()`方法中添加：

```javascript
// 上传按钮
document.getElementById('upload-api-btn')?.addEventListener('click', () => {
    this.uploadToAPI();
});

// 保存API配置
document.getElementById('save-api-config-btn')?.addEventListener('click', () => {
    CONFIG.apiEnabled = document.getElementById('api-enabled-checkbox').checked;
    CONFIG.apiUrl = document.getElementById('api-url-input').value.trim();
    CONFIG.apiKey = document.getElementById('api-key-input').value.trim();
    CONFIG.autoUpload = document.getElementById('auto-upload-checkbox').checked;
    saveAPIConfig();
    alert('配置已保存！');
});

// 测试连接
document.getElementById('test-api-btn')?.addEventListener('click', () => {
    // 先保存当前输入
    CONFIG.apiUrl = document.getElementById('api-url-input').value.trim();
    CONFIG.apiKey = document.getElementById('api-key-input').value.trim();
    this.testAPIConnection();
});
```

### 5. 自动上传逻辑

在采集完成时（`stopCollecting`方法的末尾），添加：

```javascript
// 如果启用自动上传
if (CONFIG.apiEnabled && CONFIG.autoUpload) {
    setTimeout(() => {
        this.uploadToAPI();
    }, 1000);
}
```

---

## 使用说明

### 配置步骤

1. 打开EuraFlow系统，进入"API密钥"页面
2. 创建新的API Key，复制保存
3. 在Ozon网站上，打开Tampermonkey脚本控制面板
4. 展开"⚙️ API设置"
5. 填写配置：
   - ✅ 启用API上传
   - API地址：`https://your-domain.com`（你的EuraFlow系统地址）
   - API Key：粘贴刚才复制的Key
   - （可选）✅ 采集完成后自动上传
6. 点击"💾 保存配置"
7. 点击"🔍 测试连接"验证配置

### 使用流程

1. 开始采集商品（点击"开始采集"）
2. 等待采集完成
3. 点击"🚀 上传到系统"（或自动上传）
4. 查看上传结果
5. 回到EuraFlow系统"选品助手"页面查看数据

---

## 注意事项

1. **安全**：API Key是敏感信息，不要泄露给他人
2. **网络**：确保可以访问EuraFlow系统（HTTPS）
3. **速率**：单次上传最多1000条商品
4. **数据**：已存在的商品会被更新（基于商品ID）

---

## 故障排除

### 上传失败：401 Unauthorized
- 检查API Key是否正确
- 检查API Key是否已过期或被删除

### 上传失败：网络错误
- 检查API地址是否正确（包含协议 https://）
- 检查是否可以访问系统

### 上传失败：400 Bad Request
- 检查数据格式是否正确
- 查看控制台错误详情

---

## API接口说明

**上传接口**：`POST /api/ef/v1/ozon/product-selection/upload`

**认证方式**：Header `X-API-Key: your_api_key`

**请求体**：
```json
{
  "products": [
    {
      "product_id": "123456789",
      "product_name_ru": "...",
      "brand": "...",
      ...
    }
  ]
}
```

**响应**：
```json
{
  "success": true,
  "total": 100,
  "success_count": 98,
  "failed_count": 2,
  "errors": [...]
}
```
