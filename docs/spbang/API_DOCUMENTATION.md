# 上品帮 API 接口文档

> 版本: v3.1.28
> 分析日期: 2025-11-17
> 基于插件源码逆向分析

---

## 📡 服务器域名体系

### 主域名
- **主域名**: `https://shopbang.cn`
- **用途**: 存储用户 Token（Cookie）

### 完整域名列表

| 域名 | 用途 | 环境 |
|------|------|------|
| `http://www.shopbang.cn` | 主站（HTTP） | 生产环境 |
| `https://api.shopbang.cn` | API 服务器 | 生产环境 |
| `https://test.shopbang.cn` | 测试环境主站 | 测试环境 |
| `https://test-plus.shopbang.cn` | 测试增强版 | 测试环境 |
| `https://testapi.shopbang.cn` | 测试 API 服务器 | 测试环境 |
| `http://www.ozonbang.cn` | 品牌站点 | 生产环境 |
| `https://erp.ozonbang.cn` | ERP 系统 | 生产环境 |
| `https://test.ozonbang.cn` | 测试环境 | 测试环境 |
| `https://testapi.ozonbang.cn` | 测试 API | 测试环境 |

---

## 🔐 认证机制

### Token 存储方式
- **存储位置**: Chrome Cookie
- **Cookie 名称**: `token`
- **存储域**: `https://shopbang.cn`
- **读取方式**: `chrome.cookies.get({ url: "https://shopbang.cn", name: "token" })`

### 认证流程
1. 用户登录后，服务器设置 `token` Cookie
2. 每次 API 请求都在 Body 中携带 `token` 字段
3. Token 无效时返回 `{ code: 401 }`

### 请求格式
```json
{
  "token": "用户Token值",
  "apiType": "接口类型标识",
  // ... 其他参数
}
```

---

## 📚 API 接口列表

### 一、认证与设备管理（6 个接口）

#### 1.1 检查设备绑定

**接口类型**: `checkBangToken`

**功能描述**: 验证当前设备是否已绑定，检查 Token 有效性

**请求方式**: POST

**请求 URL**: 由前端传入（通常为 `https://api.shopbang.cn/api/chrome/checkDevice` 或类似地址）

**请求参数**:
```json
{
  "token": "string (必填) - 用户认证Token",
  "apiType": "checkDevice (固定值)"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string - 提示信息",
  "data": {
    "deviceId": "string - 设备ID",
    "bindStatus": "boolean - 绑定状态"
  }
}
```

---

#### 1.2 绑定店铺 Cookie

**接口类型**: `bindShopCookie`

**功能描述**: 将用户的 OZON 店铺 Cookie 绑定到上品帮账户

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "cookieStr": "string (必填) - OZON完整Cookie字符串",
  "apiType": "bindShopCookie (固定值)"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, 999=失败
  "message": "string - 提示信息"
}
```

---

#### 1.3 上报 Cookie（无响应）

**接口类型**: `chrome_c`

**功能描述**: 单向上报 Cookie 数据到服务器（用于数据采集）

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "cookieStr": "string (必填) - Cookie字符串",
  "apiType": "chrome_c (固定值)"
}
```

**返回值**: 无返回值（Fire-and-forget 模式）

---

#### 1.4 获取 OZON Cookie

**接口类型**: `getOzonCookie`

**功能描述**: 从浏览器中读取所有 OZON 相关的 Cookie

**请求方式**: 本地读取（不发送网络请求）

**处理逻辑**:
1. 读取 `.ozon.ru` 域下的所有 Cookie
2. 读取 Partitioned Cookie（第三方 Cookie）
3. 拼接成字符串格式：`name1=value1; name2=value2; ...`

**返回值**: `string` - Cookie 字符串

---

#### 1.5 获取本地 Token

**接口类型**: `getToken`

**功能描述**: 获取本地存储的上品帮 Token

**请求方式**: 本地读取

**返回值**: `string` - Token 值

---

#### 1.6 删除 Token

**接口类型**: `removeBangToken`

**功能描述**: 从浏览器中删除上品帮 Token（用于登出）

**请求方式**: 本地操作

**返回值**: 无

---

### 二、商品采集（8 个接口）

#### 2.1 通用商品采集

**接口类型**: `goodsCollect`

**功能描述**: 采集电商平台商品信息（支持淘宝、拼多多、京东等）

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "goods_arr": [
    {
      "title": "string - 商品标题",
      "price": "number - 商品价格",
      "images": ["string - 图片URL数组"],
      "sku": "object - SKU信息",
      // ... 其他商品字段
    }
  ],
  "token": "string (必填) - 用户Token",
  "apiType": "goodsCollect (固定值)",
  "is_force": "boolean - 是否强制覆盖",
  "goods_source_url": "string - 商品来源URL",
  "goods_source_remark": "string - 来源备注",
  "up_price": "number - 加价金额",
  "dimensions": "object - 尺寸数据"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string - 提示信息（失败时显示：采集失败，请重试！）",
  "data": {
    "successCount": "number - 成功数量",
    "failCount": "number - 失败数量",
    "goodsIds": ["string - 采集后的商品ID数组"]
  }
}
```

---

#### 2.2 1688 商品采集

**接口类型**: `goodsCollect1688`

**功能描述**: 专门用于采集 1688 平台的商品信息

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "skus": "array - SKU数据",
  "images": "array - 图片URL数组",
  "des": "string - 商品描述",
  "goodsName": "string - 商品名称",
  "token": "string (必填) - 用户Token",
  "apiType": "goodsCollect1688 (固定值)",
  "is_force": "boolean - 是否强制覆盖",
  "goods_source_url": "string - 1688商品链接",
  "collect_type": "string - 采集类型",
  "compressSkus": "boolean - 是否压缩SKU"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string - 提示信息",
  "data": {
    "goodsId": "string - 商品ID"
  }
}
```

---

#### 2.3 链接商品采集

**接口类型**: `goodsCollectLinkGoods`

**功能描述**: 通过链接采集商品（支持多平台）

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "skus": "array - SKU数据",
  "des": "string - 商品描述",
  "goodsName": "string - 商品名称",
  "token": "string (必填) - 用户Token",
  "apiType": "goodsCollectLinkGoods (固定值)",
  "is_force": "boolean - 是否强制覆盖",
  "goods_source_url": "string - 商品来源URL",
  "collect_url": "string - 采集URL",
  "formData": "object - 表单数据",
  "collect_type": "string - 采集类型",
  "sizes": "array - 尺寸数据",
  "images": "array - 图片数组",
  "up_price": "number - 加价金额",
  "goods_source_remark": "string - 来源备注",
  "is_new_plugin": true,  // 固定值：标识新版插件
  "compressSkus": "boolean - 是否压缩SKU"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "goodsId": "string - 商品ID"
  }
}
```

---

#### 2.4 批量获取商品信息

**接口类型**: `getGoodsInfoByIds`

**功能描述**: 根据商品 ID 列表批量获取商品详细信息

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "goodsIds": ["string - 商品ID数组"],
  "token": "string (必填) - 用户Token",
  "apiType": "getGoodsInfoByIds (固定值)",
  "is_new": true,  // 固定值：使用新版接口
  "v": 4  // 固定值：API版本号
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": [
    {
      "goodsId": "string - 商品ID",
      "title": "string - 商品标题",
      "price": "number - 价格",
      "images": ["string - 图片数组"],
      "skus": "array - SKU列表",
      // ... 其他商品字段
    }
  ]
}
```

---

#### 2.5 获取本地商品 ID

**接口类型**: `getLocalGoodsIds`

**功能描述**: 检查哪些商品 ID 已存在于用户的商品库中

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "getLocalGoodsIds (固定值)",
  "goodsIds": ["string - 待检查的商品ID数组"]
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "string",
  "data": {
    "existIds": ["string - 已存在的商品ID"],
    "notExistIds": ["string - 不存在的商品ID"]
  }
}
```

---

#### 2.6 获取复制数据（包含尺寸和重量）⭐

**接口类型**: `getCopyData`

**功能描述**: 从 OZON Seller API 获取商品完整数据（包括尺寸、重量、品牌、类目等）

**⚠️ 重要**: 这是**延迟加载**的 API，页面加载后约 1-3 秒才会触发

**请求方式**: POST

**请求 URL**: `https://seller.ozon.ru/api/v1/search-variant-model`（OZON 官方 API）

**请求参数**:
```json
{
  "limit": "10",  // 固定值：限制返回数量
  "name": "string - 商品ID（如：3083658398）"
}
```

**请求头**（特殊，模拟 OZON Seller UI）:
```json
{
  "priority": "u=1, i",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "none",
  "sec-fetch-storage-access": "active",
  "Content-Type": "application/json",
  "x-o3-company-id": "string - OZON公司ID（从 Cookie 读取）",
  "x-o3-app-name": "seller-ui",
  "x-o3-language": "zh-Hans",
  "x-o3-page-type": "products-other",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "accept-language": "zh-Hans"
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "成功",
  "items": [
    {
      "goodsId": "商品ID",
      "attributes": [
        { "key": "9454", "value": "10" },    // 深度（cm）
        { "key": "9455", "value": "20" },    // 宽度（cm）
        { "key": "9456", "value": "30" },    // 高度（cm）
        { "key": "4497", "value": "500" },   // 重量（g）
        { "key": "85", "value": "品牌名" },   // 品牌（主）
        { "key": "31", "value": "品牌名" },   // 品牌（备用）
        { "key": "8229", "value": "类目名" } // 类目
      ],
      "categories": [
        { "id": 123, "name": "一级类目" },
        { "id": 456, "name": "二级类目" }
      ]
    }
  ]
}
```

**OZON 属性 ID 映射表**（重要！）:

| 属性 Key | 含义 | 单位 | 说明 |
|----------|------|------|------|
| `9454` | 深度 (Depth) | cm | 商品包装深度 |
| `9455` | 宽度 (Width) | cm | 商品包装宽度 |
| `9456` | 高度 (Height) | cm | 商品包装高度 |
| `4497` | 重量 (Weight) | g | 商品重量 |
| `85` | 品牌 (Brand) | - | 主品牌字段 |
| `31` | 品牌 (Brand) | - | 备用品牌字段 |
| `8229` | 类目 (Category) | - | 商品类目 |

**调试日志输出**:
```javascript
[上品帮调试] 响应: getCopyData {
  requestId: "REQ_...",
  status: 200,
  itemsCount: 1,
  dimensions: {  // ⭐ 专门提取的尺寸/重量数据
    depth: "10",
    width: "20",
    height: "30",
    weight: "500"
  },
  result: { ... },
  duration: "1705ms"
}
```

---

#### 2.7 检查商品是否已复制

**接口类型**: `hasCopyDataByGoodsId`

**功能描述**: 检查指定商品 SKU 是否已被复制/采集过

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "hasCopyDataByGoodsId (固定值)",
  "goodsSku": "string (必填) - 商品SKU"
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "string",
  "data": {
    "exists": "boolean - 是否存在",
    "goodsId": "string - 商品ID（如果存在）"
  }
}
```

---

#### 2.8 添加复制数据

**接口类型**: `addCopyData`

**功能描述**: 保存复制/采集的商品数据

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "addCopyData (固定值)",
  "copyData": {
    // 商品完整数据
    "title": "string",
    "price": "number",
    "images": "array",
    "skus": "array",
    // ... 其他字段
  }
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "goodsId": "string - 新增的商品ID"
  }
}
```

---

### 三、商品上传（1 个接口）

#### 3.1 批量上传商品

**接口类型**: `upGoods`

**功能描述**: 将采集的商品批量上传到 OZON 平台

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "goods": [
    {
      // 商品数据数组
    }
  ],
  "token": "string (必填) - 用户Token",
  "client_id": "string - OZON ClientID",
  "use_pack": true,  // 固定值：使用打包模式
  "total_num": 0,  // number - 总数量（默认0）
  "has_brand": "boolean - 是否有品牌",
  "is_down_fx": "boolean - 是否下载方向（待确认）",
  "watermark_id": "string - 水印ID",
  "apiType": "batchCreateGoods (固定值)",
  "stock": "number - 库存数量",
  "warehouse_id": "string - 仓库ID",
  "img_order_type": "string - 图片排序类型",
  "compressSkus": "boolean - 是否压缩SKU",
  "is_compress": "boolean - 是否压缩"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "successCount": "number - 成功数量",
    "failCount": "number - 失败数量",
    "taskId": "string - 任务ID（用于查询进度）"
  }
}
```

---

### 四、数据查询（4 个接口）

#### 4.1 获取用户信息

**接口类型**: `getChromeUserInfo`

**功能描述**: 获取当前插件用户的账户信息

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "getChromeUserInfo (固定值)",
  "platform": "string - 平台标识（如：ozon, wb）"
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "string",
  "data": {
    "userId": "string - 用户ID",
    "username": "string - 用户名",
    "email": "string - 邮箱",
    "vipLevel": "string - VIP等级",
    "expireTime": "string - 到期时间",
    "permissions": ["string - 权限列表"]
  }
}
```

---

#### 4.2 获取类目属性

**接口类型**: `getAttrBySubjectID`

**功能描述**: 根据类目 ID 获取该类目的所有属性（用于商品发布）

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "getAttrBySubjectID (固定值)",
  "subjectID": "string (必填) - 类目ID"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "系统错误 (失败时)",
  "data": {
    "attributes": [
      {
        "attrId": "string - 属性ID",
        "attrName": "string - 属性名称",
        "required": "boolean - 是否必填",
        "values": ["string - 可选值数组"]
      }
    ]
  }
}
```

---

#### 4.3 批量获取OZON销售数据⭐

**接口类型**: `getGoodsInfoByIds` / `getOzonSaleDataByIds`

**功能描述**: 批量获取商品销售数据（销量、佣金、尺寸、竞争等）

**请求方式**: POST

**请求 URL**: `https://plus.shopbang.cn/api/goods/hotSales/getOzonSaleDataByIds`

**请求参数**:
```json
{
  "goodsIds": ["3083658390", "1234567890"],  // SKU数组（最多50个）
  "token": "string (必填) - 用户Token",
  "apiType": "getGoodsInfoByIds",
  "is_new": true,
  "v": 4
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "成功",
  "data": [
    {
      "goods_id": "3083658390",
      "data": {
        // 基础信息
        "sku": "3083658390",
        "category": "住宅和花园 > 礼品袋",
        "brand": "品牌名",

        // 销售数据
        "monthlySales": 1500,
        "monthlySalesAmount": 150000,
        "dailySales": 50,
        "dailySalesAmount": 5000,
        "salesDynamic": 15.5,
        "transactionRate": 3.2,

        // 包装尺寸（可能为null）
        "packageWeight": 500,
        "packageLength": 200,
        "packageWidth": 150,
        "packageHeight": 100,

        // 竞争数据
        "competitorCount": 25,
        "competitorMinPrice": 800,

        // 营销数据
        "cardViews": 10000,
        "cardAddToCartRate": 2.5,
        // ... 其他字段
      },
      "fail": false,
      "has_up": true
    }
  ]
}
```

---

#### 4.4 批量获取商品佣金⭐

**接口类型**: `getGoodsCommissions`

**功能描述**: 批量计算商品的OZON佣金费用（6个档位）

**请求方式**: POST

**请求 URL**: `https://api.shopbang.cn/ozonMallSale/`

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "getGoodsCommissions",
  "goods": [
    {
      "goods_id": "3083658390",
      "category_name": "住宅和花园"  // 一级类目名称（从attributes key=8229提取）
    }
  ]
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "成功",
  "data": [
    {
      "goods_id": "3083658390",
      "fbp": 9.0,             // FBP 佣金 1501-5000₽ (%)
      "fbp_small": 8.0,       // FBP 佣金 ≤1500₽ (%)
      "fbp_large": 10.0,      // FBP 佣金 >5000₽ (%)
      "rfbs": 6.0,            // rFBS 佣金 1501-5000₽ (%)
      "rfbs_small": 5.5,      // rFBS 佣金 ≤1500₽ (%)
      "rfbs_large": 7.0       // rFBS 佣金 >5000₽ (%)
    }
  ]
}
```

**注意事项**:
- `category_name` 需要从OZON Seller API的 attributes 中提取（key=8229）
- 如果销售数据API返回的佣金为null，必须调用此API补充

---

#### 4.5 获取OZON跟卖数据⭐

**功能描述**: 获取商品的跟卖商家列表和价格分布

**请求方式**: GET

**请求 URL**: `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url={encodedUrl}`

**URL构造**:
```javascript
const productId = "3083658390";
const modalUrl = `/modal/otherOffersFromSellers?product_id=${productId}&page_changed=true`;
const encodedUrl = encodeURIComponent(modalUrl);
const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodedUrl}`;
```

**返回值**:
```json
{
  "widgetStates": {
    "webSellerList-123456": "{\"sellers\":[{\"sku\":\"111111\",\"price\":{\"cardPrice\":{\"price\":\"1 200 ₽\"}}}]}"
  }
}
```

**数据提取**:
```javascript
const widgetStates = response.widgetStates || {};
const sellerListKey = Object.keys(widgetStates).find(key => key.includes('webSellerList'));
const sellerListData = JSON.parse(widgetStates[sellerListKey]);
const sellers = sellerListData.sellers || [];

// 提取并排序价格
sellers.forEach(seller => {
  let priceStr = seller.price?.cardPrice?.price || seller.price?.price || '';
  priceStr = priceStr.replace(/,/g, '.').replace(/[^\d.]/g, '');
  seller.priceNum = parseFloat(priceStr) || 99999999;
});
sellers.sort((a, b) => a.priceNum - b.priceNum);
```

**处理后的数据**:
```json
{
  "goods_id": "3083658390",
  "gm": 5,
  "gmGoodsIds": ["111111", "222222", "333333", "444444", "555555"],
  "gmArr": [1150, 1200, 1250, 1300, 1350]
}
```

---

#### 4.6 翻译文本

**接口类型**: `translateText`

**功能描述**: 将文本翻译成俄语（用于 OZON 商品标题/描述）

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "translateText (固定值)",
  "text": "string (必填) - 待翻译的文本"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "translatedText": "string - 翻译后的文本",
    "sourceLanguage": "string - 源语言",
    "targetLanguage": "string - 目标语言（ru）"
  }
}
```

---

### 五、导出功能（4 个接口）

#### 5.1 获取导出数据

**接口类型**: `getGoodsByexportData`

**功能描述**: 根据商品 ID 列表获取导出数据

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "getGoodsByexportData (固定值)",
  "goodsIds": ["string - 商品ID数组"]
}
```

**返回值**:
```json
{
  "code": 0,
  "message": "string",
  "data": [
    {
      // 导出格式的商品数据
    }
  ]
}
```

---

#### 5.2 导出心跳检测

**接口类型**: `exportTableHeartbeat`

**功能描述**: 向服务器发送心跳，保持导出任务活跃

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "exportTableHeartbeat (固定值)",
  "exportHeartId": "string (必填) - 导出任务ID"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "isAlive": "boolean - 任务是否存活"
  }
}
```

---

#### 5.3 检查导出设备

**接口类型**: `checkChromeExportDevice`

**功能描述**: 检查当前设备是否有导出权限

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "checkChromeExportDevice (固定值)",
  "exportHeartId": "string (必填) - 导出任务ID"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "hasPermission": "boolean - 是否有权限",
    "deviceId": "string - 设备ID"
  }
}
```

---

#### 5.4 完成导出

**接口类型**: `finishExportTable`

**功能描述**: 通知服务器导出任务已完成

**请求方式**: POST

**请求 URL**: 由前端传入

**请求参数**:
```json
{
  "token": "string (必填) - 用户Token",
  "apiType": "finishExportTable (固定值)",
  "exportHeartId": "string (必填) - 导出任务ID"
}
```

**返回值**:
```json
{
  "code": 0,  // 0=成功, -1=失败
  "message": "string",
  "data": {
    "exportUrl": "string - 导出文件下载地址（如果有）"
  }
}
```

---

## 🔍 错误码说明

| 错误码 | 含义 | 处理方式 |
|--------|------|---------|
| `0` | 成功 | 正常处理 |
| `-1` | 通用失败 | 查看 `message` 字段获取详细错误信息 |
| `401` | Token 无效或未登录 | 引导用户重新登录 |
| `999` | 服务器错误（bindShopCookie 专用） | 重试或联系客服 |

---

## ⚠️ 安全提示

1. **敏感数据**: 该插件会将用户的 OZON Cookie 上传到 `shopbang.cn` 服务器
2. **权限风险**: 插件请求了 `<all_urls>` 权限，可以访问所有网站
3. **Premium 破解**: `ozon_min.js` 拦截 OZON API 伪造付费功能，存在法律风险
4. **Cookie 监控**: 自动收集淘宝、天猫的 `_m_h5_tk` Cookie

---

## 📝 附录

### API 类型（apiType）完整列表

```javascript
const API_TYPES = [
  // 认证相关
  "checkDevice",          // 检查设备绑定
  "bindShopCookie",       // 绑定店铺Cookie
  "chrome_c",             // 上报Cookie

  // 商品采集
  "goodsCollect",         // 通用商品采集
  "goodsCollect1688",     // 1688商品采集
  "goodsCollectLinkGoods", // 链接商品采集
  "getGoodsInfoByIds",    // 批量获取商品信息
  "getLocalGoodsIds",     // 获取本地商品ID
  "hasCopyDataByGoodsId", // 检查商品是否已复制
  "addCopyData",          // 添加复制数据

  // 商品上传
  "batchCreateGoods",     // 批量上传商品

  // 数据查询
  "getChromeUserInfo",    // 获取用户信息
  "getAttrBySubjectID",   // 获取类目属性
  "getGoodsCommissions",  // 获取商品佣金
  "translateText",        // 翻译文本

  // 导出功能
  "getGoodsByexportData",    // 获取导出数据
  "exportTableHeartbeat",    // 导出心跳
  "checkChromeExportDevice", // 检查导出设备
  "finishExportTable"        // 完成导出
];
```

---

**文档结束**

> 如有疑问，请结合 `background.js` 源码和 Chrome DevTools 调试日志进行分析。
