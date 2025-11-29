# OZON 浏览器扩展商品采集开发文档

> **版本**: v1.1.0
> **更新日期**: 2025-11-28
> **维护者**: EuraFlow Team

---

## 📖 目录

1. [概述](#1-概述)
2. [商品列表采集](#2-商品列表采集)
3. [商品详情采集](#3-商品详情采集)
4. [变体数据采集](#4-变体数据采集)
5. [图片采集](#5-图片采集)
6. [关键组件](#6-关键组件)
7. [错误处理和降级](#7-错误处理和降级)
8. [数据格式规范](#8-数据格式规范)
9. [常见问题和解决方案](#9-常见问题和解决方案)
10. [代码位置索引](#10-代码位置索引)
11. [API 调用完整示例](#11-api-调用完整示例)
12. [性能优化建议](#12-性能优化建议)
13. [前后端字段映射（重要！）](#13-前后端字段映射重要)

---

## 1. 概述

### 1.1 功能简介

OZON 浏览器扩展用于采集 OZON 平台的商品数据，支持：
- 商品列表批量采集
- 商品详情完整采集
- 多变体商品处理（颜色/尺码）
- 自动跟卖配置

### 1.2 核心技术栈

- **TypeScript** - 类型安全的开发
- **Chrome Extension Manifest V3** - 浏览器扩展框架
- **React** - UI 组件库
- **OZON API** - 数据源

### 1.3 数据采集流程

```
用户打开商品详情页
    ↓
Content Script 启动
    ↓
1. widgetStates API
    → title, price, images, category, brand, variants（当前颜色）
    ↓
2. Page2 API
    → description, attributes（完整特征）
    ↓
3. Modal API
    → variants（所有颜色）
    ↓
4. OZON Seller API / 上品帮 DOM
    → dimensions (weight, height, width, length)
    ↓
5. 访问其他变体页面
    → 每个变体的尺码、图片
    ↓
6. 合并数据
    → 完整的 ProductDetailData
    ↓
7. 显示跟卖弹窗
    → 用户配置并提交
    ↓
8. 调用后端 API
    → 创建采集记录/一键跟卖
```

---

## 2. 商品列表采集

### 2.1 采集场景

- **商品搜索结果页**: `https://www.ozon.ru/search?text=...`
- **类目浏览页**: `https://www.ozon.ru/category/...`
- **店铺商品列表页**: `https://www.ozon.ru/seller/...`

### 2.2 数据源

**主要 API**: `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2`

**核心原理**:
- 直接解析 OZON 页面的 widgetStates API 数据
- 从页面 URL 构造 API 请求

### 2.3 实现代码

```typescript
// 从页面 URL 构造 API 请求
const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

// 发起请求
const response = await fetch(apiUrl, {
  method: 'GET',
  headers: await getOzonStandardHeaders(),
  credentials: 'include'
});

const data = await response.json();
```

---

## 3. 商品详情采集

### 3.1 数据采集流程详解

#### 步骤 1: 调用 widgetStates API
获取商品基础信息（title/price/images/category/brand/variants）

#### 步骤 2: 调用 Page2 API
获取完整特征列表和商品描述

#### 步骤 3: 调用 Modal API
获取所有颜色×尺码的完整变体组合

#### 步骤 4: 获取尺寸和重量
- 优先：OZON Seller API
- 降级：上品帮 DOM 注入数据

#### 步骤 5: 访问变体详情页
对于多变体商品，访问每个颜色的详情页，获取该颜色的所有尺码和图片

#### 步骤 6: 数据合并
合并所有数据源，返回完整的商品数据结构

---

### 3.2 API 详细说明

#### 3.2.1 widgetStates API（基础数据）

**作用**: 获取商品基础信息

**URL 格式**:
```
https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url={商品URL编码后}
```

**请求示例**:
```typescript
const productUrl = 'https://www.ozon.ru/product/name-123456';
const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

const headers = {
  'Accept': 'application/json',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Origin': 'https://www.ozon.ru',
  'X-O3-App-Name': 'dweb_client',
  'X-O3-App-Version': 'release_18-10-2025_c87fd5b6', // 动态获取
  'X-O3-Manifest-Version': 'frontend-ozon-ru:...', // 动态获取
  'Referer': window.location.href
};

const limiter = OzonApiRateLimiter.getInstance();
const response = await limiter.executeWithRetry(() =>
  fetch(apiUrl, {
    method: 'GET',
    headers,
    credentials: 'include'
  })
);
```

**返回数据结构**:
```json
{
  "widgetStates": {
    "webProductHeading-12345": "{\"title\":\"商品名称\",\"brand\":\"品牌名\"}",
    "webPrice-12345": "{\"price\":\"1 299\",\"originalPrice\":\"1 899\"}",
    "webGallery-12345": "{\"images\":[{\"src\":\"图片URL\"}],\"videos\":[]}",
    "webCharacteristics-12345": "{\"characteristics\":[...]}",
    "webAspects-12345": "{\"aspects\":[...变体信息...]}"
  },
  "layoutTrackingInfo": "{\"categoryId\":\"123456\"}"
}
```

**提取的字段**:
- `title` - 商品标题（从 webProductHeading）
- `price`, `original_price` - 价格和原价（从 webPrice）
- `images`, `videos` - 图片和视频（从 webGallery）
- `category_id` - 类目ID（从 layoutTrackingInfo.categoryId）
- `brand` - 品牌（从 webProductHeading.brand）
- `attributes` - 基础属性（从 webCharacteristics）
- `variants` - 当前颜色的尺码列表（从 webAspects）

---

#### 3.2.2 Page2 API（完整特征和描述）

**作用**: 获取商品的完整特征列表和详细描述

**URL 格式**:
```
https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/product/{slug}/?layout_container=pdpPage2column&layout_page_index=2
```

**请求示例**:
```typescript
const page2Url = `/product/${productSlug}/?layout_container=pdpPage2column&layout_page_index=2`;
const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(page2Url)}`;

const response = await limiter.executeWithRetry(() =>
  fetch(apiUrl, {
    method: 'GET',
    headers: await getOzonStandardHeaders({ referer: window.location.href })
  })
);
```

**返回数据结构**:
```json
{
  "widgetStates": {
    "webDescription-pdpPage2column-12345": "{\"richAnnotation\":\"商品详细描述HTML\"}",
    "webCharacteristics-pdpPage2column-12345": "{\"characteristics\":[{\"short\":[{\"key\":\"材质\",\"values\":[{\"text\":\"纯棉\"}]}]}]}"
  }
}
```

**提取的字段**:
- `description` - 商品详细描述（从 webDescription.richAnnotation）
- `attributes` - 完整特征列表（从 webCharacteristics，覆盖 widgetStates 的基础属性）

---

#### 3.2.3 Modal API（完整变体列表）

**作用**: 获取所有颜色×尺码的完整变体组合

**URL 格式**:
```
https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/modal/aspectsNew?product_id={商品ID}
```

**请求示例**:
```typescript
const modalUrl = `/modal/aspectsNew?product_id=${productId}`;
const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(modalUrl)}`;

const response = await limiter.executeWithRetry(() =>
  fetch(apiUrl, {
    method: 'GET',
    headers: await getOzonStandardHeaders({ referer: window.location.href })
  })
);
```

**返回数据结构**:
```json
{
  "widgetStates": {
    "webAspectsModal-12345": "{\"aspects\":[{\"variants\":[{\"sku\":\"123456789\",\"link\":\"/product/...\",\"data\":{\"searchableText\":\"白色\",\"coverImage\":\"https://...\",\"price\":\"1 299\"}}]}]}"
  }
}
```

**提取的字段**:
- `aspects` - 完整变体列表（包含所有颜色）
- 每个 `variant`:
  - `sku` - 变体SKU
  - `link` - 变体详情页链接
  - `data.searchableText` - 规格描述（如"白色"、"M"）
  - `data.coverImage` - 变体主图
  - `data.price` - 变体价格

---

#### 3.2.4 OZON Seller API（尺寸和重量）

**作用**: 通过卖家后台 API 获取商品尺寸和重量

**URL**: `https://seller.ozon.ru/api/v1/search-variant-model`

**请求示例**:
```typescript
const requestUrl = 'https://seller.ozon.ru/api/v1/search-variant-model';
const requestBody = {
  limit: 50,
  name: productSku,
  sellerId: sellerId // 从 Cookie 中提取 sc_company_id
};

const response = await limiter.execute(() =>
  fetch(requestUrl, {
    method: 'POST',
    headers: {
      ...sellerHeaders,
      'Cookie': documentCookie,
      'x-o3-company-id': sellerId.toString(),
      'x-o3-app-name': 'seller-ui'
    },
    body: JSON.stringify(requestBody)
  })
);
```

**返回数据结构**:
```json
{
  "items": [
    {
      "name": "商品名称",
      "attributes": [
        {"key": "4497", "value": "130"}, // 重量（克）
        {"key": "9454", "value": "250"}, // 长度（毫米）
        {"key": "9455", "value": "130"}, // 宽度（毫米）
        {"key": "9456", "value": "30"}   // 高度（毫米）
      ]
    }
  ]
}
```

**提取的字段**:
- `weight` - 重量（克），从 attributes[key=4497]
- `length` - 长度（毫米），从 attributes[key=9454]
- `width` - 宽度（毫米），从 attributes[key=9455]
- `height` - 高度（毫米），从 attributes[key=9456]

**属性ID映射**:
```typescript
const OZON_DIMENSION_ATTRIBUTE_IDS = {
  WEIGHT: '4497',  // 重量（克）
  LENGTH: '9454',  // 长度（毫米）
  WIDTH: '9455',   // 宽度（毫米）
  HEIGHT: '9456'   // 高度（毫米）
};
```

---

#### 3.2.5 上品帮 DOM 注入（降级方案）

**作用**: 作为降级方案，从上品帮扩展注入的 DOM 中提取尺寸数据

**数据来源**: 上品帮扩展会在页面上注入包含尺寸信息的 `<div class="text-class">` 元素

**提取逻辑**:
```typescript
const textElements = document.querySelectorAll('div.text-class');

for (const element of textElements) {
  const span = element.querySelector('span');
  const b = element.querySelector('b');
  const label = span?.textContent?.trim() || '';
  const value = b?.textContent?.trim() || '';

  // 包装重量: "130 g"
  if (label.includes('包装重量')) {
    const weightMatch = value.match(/(\d+(?:\.\d+)?)\s*g/i);
    if (weightMatch) {
      result.weight = parseFloat(weightMatch[1]);
    }
  }

  // 长宽高: "250 * 130 * 30" 或 "250*130*30"
  if (label.includes('长宽高')) {
    const dimensionsMatch = value.match(/(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
    if (dimensionsMatch) {
      result.length = parseFloat(dimensionsMatch[1]);
      result.width = parseFloat(dimensionsMatch[2]);
      result.height = parseFloat(dimensionsMatch[3]);
    }
  }

  // 品牌: "без бренда" → "NO_BRAND"
  if (label.includes('品牌')) {
    result.brand = value === 'без бренда' ? 'NO_BRAND' : value;
  }
}
```

**等待策略**:
1. **首次等待（5秒）** - 等待上品帮注入 DOM
2. **二次等待（10秒）** - 如果尺寸为"-"，等待上品帮加载完成

```typescript
// 首次等待
async function waitForInjectedDOM(): Promise<boolean> {
  const maxAttempts = 100; // 5000ms / 50ms

  return new Promise((resolve) => {
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const textElements = document.querySelectorAll('div.text-class');

      if (textElements.length > 0 || attempts >= maxAttempts) {
        clearInterval(checkInterval);
        resolve(textElements.length > 0);
      }
    }, 50);
  });
}

// 二次等待（尺寸数据从"-"变为实际值）
async function waitForDimensionsData(): Promise<boolean> {
  const maxAttempts = 100; // 10000ms / 100ms

  return new Promise((resolve) => {
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const data = extractDataFromInjectedDOM();

      if ((data && data.length !== -1) || attempts >= maxAttempts) {
        clearInterval(checkInterval);
        resolve(data && data.length !== -1);
      }
    }, 100);
  });
}
```

---

## 4. 变体数据采集

### 4.1 变体类型结构

```typescript
interface Variant {
  variant_id: string;              // 变体SKU
  name: string;                    // 变体名称
  specifications: string;          // 规格描述（如"白色 / L"）
  spec_details?: Record<string, string>;  // 规格详情
  image_url: string;               // 变体主图
  images?: { url: string; is_primary?: boolean }[];  // 变体附加图片
  price: number;                   // 变体价格
  original_price?: number;         // 变体原价
  stock?: number;                  // 库存
  sku: string;                     // SKU
  available: boolean;              // 是否可售
  link?: string;                   // 变体详情页链接
}
```

### 4.2 当前颜色变体提取

从当前页面的 `webAspects` 中提取当前选中颜色的所有尺码：

```typescript
// 获取当前页面的 aspects
const currentPageAspectsKey = Object.keys(widgetStates).find(k => k.includes('webAspects'));
const currentPageAspectsData = JSON.parse(widgetStates[currentPageAspectsKey]);
const currentPageAspects = currentPageAspectsData?.aspects || [];

if (currentPageAspects.length > 0) {
  const lastAspect = currentPageAspects[currentPageAspects.length - 1];
  const currentVariants = lastAspect?.variants || [];

  console.log(`[EuraFlow] ✅ 从当前页面提取 ${currentVariants.length} 个变体（当前选中颜色）`);

  currentVariants.forEach((variant: any) => {
    const { sku, link } = variant;
    const { title, price, originalPrice, searchableText, coverImage } = variant.data || {};

    // 过滤瑕疵品
    if (searchableText === 'Уцененные') {
      return;
    }

    // 构建规格文本
    const specs: string[] = [];
    currentPageAspects.forEach((aspect: any) => {
      const v = aspect.variants.find((v: any) => v.sku === sku) || aspect.variants.find((v: any) => v.active);
      if (v?.data?.searchableText) {
        specs.push(v.data.searchableText);
      }
    });
    const specText = specs.join(' / ');

    allVariants.push({
      variant_id: sku,
      name: title || '',
      specifications: specText,
      image_url: coverImage || '',
      images: baseData.images,  // 当前页面的附加图片
      price: parsePrice(price),
      original_price: parsePrice(originalPrice),
      sku: sku,
      available: true
    });
  });
}
```

### 4.3 其他颜色变体访问

从 Modal API 获取所有颜色的链接，访问每个颜色的详情页：

```typescript
// 获取所有变体链接（排除当前页面的 SKU）
const allVariantLinks: any[] = [];
modalAspects.forEach((aspect: any) => {
  aspect.variants.forEach((variant: any) => {
    // 过滤瑕疵品和当前页面的 SKU
    if (variant.data?.searchableText !== 'Уцененные' && variant.sku !== productSku) {
      allVariantLinks.push({
        sku: variant.sku,
        link: variant.link ? variant.link.split('?')[0] : '',
        data: variant.data
      });
    }
  });
});

console.log(`[EuraFlow] 找到 ${allVariantLinks.length} 个其他颜色变体链接`);

// 访问每个变体页面
for (const variantLink of allVariantLinks) {
  if (!variantLink.link) continue;

  // 构造完整URL
  const fullUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(variantLink.link)}`;

  // 发起请求（限流）
  const response = await limiter.executeWithRetry(() =>
    fetch(fullUrl, {
      method: 'GET',
      headers: await getOzonStandardHeaders()
    })
  );

  const data = await response.json();
  const variantWidgetStates = data.widgetStates || {};

  // 提取变体的 aspects 和 images
  const variantAspectsKey = Object.keys(variantWidgetStates).find(k => k.includes('webAspects'));
  const variantGalleryKey = Object.keys(variantWidgetStates).find(k => k.includes('webGallery'));

  // ... 提取数据并添加到 allVariants
}
```

### 4.4 变体图片采集

每个变体页面都有自己的 `webGallery`，需要单独提取：

```typescript
// 提取变体的图片列表
const variantGalleryKey = Object.keys(variantWidgetStates).find(k => k.includes('webGallery'));
const variantImages: { url: string; is_primary?: boolean }[] = [];

if (variantGalleryKey) {
  const variantGalleryData = JSON.parse(variantWidgetStates[variantGalleryKey]);

  if (variantGalleryData?.images && Array.isArray(variantGalleryData.images)) {
    variantGalleryData.images.forEach((img: any, index: number) => {
      if (img.src) {
        variantImages.push({
          url: img.src,
          is_primary: index === 0  // 第一张标记为主图
        });
      }
    });

    console.log(`[EuraFlow] ✅ 从变体页面提取了 ${variantImages.length} 张图片`);
  }
}

// 添加到变体数据
variant.images = variantImages.length > 0 ? variantImages : undefined;
```

---

## 5. 图片采集

### 5.1 主商品图片采集

从 `webGallery` 提取所有图片和视频：

```typescript
const galleryKey = keys.find(k => k.includes('webGallery'));
const galleryData = galleryKey ? JSON.parse(widgetStates[galleryKey]) : null;

const images: { url: string; is_primary?: boolean }[] = [];
const videos: string[] = [];

if (galleryData?.images && Array.isArray(galleryData.images)) {
  galleryData.images.forEach((img: any, index: number) => {
    if (img.src) {
      images.push({
        url: img.src,
        is_primary: index === 0  // 第一张图片标记为主图
      });
    }
  });
}

// 提取视频
if (galleryData?.videos && Array.isArray(galleryData.videos)) {
  galleryData.videos.forEach((video: any) => {
    if (video.src || video.url) {
      videos.push(video.src || video.url);
    }
  });
}
```

### 5.2 变体附加图片采集

**当前颜色变体**: 使用主商品图片
```typescript
currentColorVariant.images = baseData.images;
```

**其他颜色变体**: 访问变体页面获取独立图片
```typescript
// 访问变体详情页
const variantData = await fetchVariantPage(variant.link);

// 提取该变体的图片
otherColorVariant.images = variantData.images;
```

### 5.3 数据格式统一

所有图片统一为对象数组格式：

```typescript
// ✅ 正确格式
images = [
  { url: "https://cdn1.ozon.ru/...", is_primary: true },
  { url: "https://cdn1.ozon.ru/...", is_primary: false }
];

// ❌ 错误格式（旧版本）
images = [
  "https://cdn1.ozon.ru/...",
  "https://cdn1.ozon.ru/..."
];
```

---

## 6. 关键组件

### 6.1 OzonApiRateLimiter（限流器）

**作用**: 全局单例限流器，统一管理所有 OZON API 请求

**文件位置**: `src/shared/ozon-rate-limiter.ts`

**核心功能**:
- ✅ 最多 2 个并发请求（模拟真实用户）
- ✅ 最小间隔 100ms + 随机抖动 ±200ms（避免规律性）
- ✅ 自动重试机制（403/429 错误）
- ✅ 队列管理（按顺序处理请求）

**使用示例**:
```typescript
const limiter = OzonApiRateLimiter.getInstance();

// 简单请求
const response = await limiter.execute(() => fetch(url, options));

// 带重试的请求（自动处理 403/429）
const response = await limiter.executeWithRetry(() => fetch(url, options));
```

**限流策略**:
```typescript
class OzonApiRateLimiter {
  private readonly MAX_CONCURRENT = 2;       // 最多2个并发
  private readonly MIN_INTERVAL_MS = 100;    // 最小间隔 100ms
  private readonly JITTER_RANGE = 200;       // ±200ms 抖动

  // 计算下次请求的等待时间
  private getJitteredInterval(): number {
    const jitter = Math.random() * this.JITTER_RANGE * 2 - this.JITTER_RANGE;
    return Math.max(0, this.MIN_INTERVAL_MS + jitter);
  }

  // 403 处理：触发反爬虫检查
  if (response.status === 403) {
    const antibot = AntibotChecker.getInstance();
    await antibot.handle403(responseData);
    throw new Error('CAPTCHA_PENDING: 触发反爬虫拦截');
  }

  // 429 处理：指数退避重试
  if (response.status === 429) {
    const backoffTime = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s, 8s
    await this.sleep(backoffTime);
    // 重试...
  }
}
```

---

### 6.2 AntibotChecker（反爬虫检查器）

**作用**: 检测和处理 OZON 的反爬虫验证码

**文件位置**: `src/shared/antibot-checker.ts`

**核心功能**:
- ✅ 请求前检查是否有验证码待处理
- ✅ 处理 403 响应，保存 incidentId
- ✅ 触发浏览器通知，提示用户完成验证
- ✅ 提供清除验证码标记的接口

**使用示例**:
```typescript
const antibot = AntibotChecker.getInstance();

// 请求前检查
await antibot.preflightCheck(); // 如果有验证码，抛出 CAPTCHA_PENDING 错误

// 处理 403 响应
if (response.status === 403) {
  const data = await response.json();
  const handled = await antibot.handle403(data);

  if (handled) {
    // 保存了 incidentId，暂停采集
    throw new Error('CAPTCHA_PENDING: 触发反爬虫拦截');
  }
}

// 用户完成验证后清除标记
await antibot.clearCaptcha();
```

**数据存储**:
```typescript
// Chrome Storage 存储的数据
interface AntibotState {
  hasCaptcha: boolean;       // 是否有验证码待处理
  incidentId: string | null; // 验证码事件ID
  timestamp: number;         // 触发时间戳
}
```

---

### 6.3 异步等待逻辑

#### 上品帮 DOM 注入等待

**首次等待（最多 5 秒）**:
```typescript
async function waitForInjectedDOM(): Promise<boolean> {
  const maxAttempts = 100; // 5000ms / 50ms

  return new Promise((resolve) => {
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const textElements = document.querySelectorAll('div.text-class');

      if (textElements.length > 0 || attempts >= maxAttempts) {
        clearInterval(checkInterval);
        resolve(textElements.length > 0);
      }
    }, 50);
  });
}
```

**二次等待（最多 10 秒）** - 等待尺寸数据从"-"变为实际值:
```typescript
async function waitForDimensionsData(): Promise<boolean> {
  const maxAttempts = 100; // 10000ms / 100ms

  return new Promise((resolve) => {
    let attempts = 0;
    const checkInterval = setInterval(() => {
      attempts++;
      const data = extractDataFromInjectedDOM();

      // 检查是否有效数据（length !== -1 表示不是"-"）
      if ((data && data.length !== -1) || attempts >= maxAttempts) {
        clearInterval(checkInterval);
        resolve(data && data.length !== -1);
      }
    }, 100);
  });
}
```

**使用流程**:
```typescript
// 1. 首次等待 DOM 注入
const domInjected = await waitForInjectedDOM();

if (domInjected) {
  // 2. 提取数据
  const injectedData = extractDataFromInjectedDOM();

  // 3. 如果尺寸为"-"，二次轮询
  if (injectedData.length === -1) {
    console.log('[EuraFlow] 尺寸数据为"-"，开始二次轮询...');
    await waitForDimensionsData();
    injectedData = extractDataFromInjectedDOM();
  }

  // 4. 合并数据
  baseData.dimensions = injectedData;
}
```

---

## 7. 错误处理和降级

### 7.1 分层降级策略

**尺寸数据**: OZON API → 上品帮 DOM
```typescript
let dimensions = await fetchDimensionsFromOzonAPI(productSku);

if (!dimensions) {
  console.log('[EuraFlow] OZON API 未返回尺寸，降级到上品帮 DOM');
  dimensions = await extractFromInjectedDOM();
}
```

**变体数据**: Modal API → 页面 widgetStates
```typescript
let variants = await fetchFullVariantsFromModal(productId);

if (!variants || variants.length === 0) {
  console.log('[EuraFlow] Modal API 未返回变体，降级到 widgetStates');
  variants = extractVariantsFromWidgetStates();
}
```

**商品描述**: Page2 API → widgetStates → 空
```typescript
let description = await fetchFromPage2API(productSlug);

if (!description) {
  description = extractFromWidgetStates();
}

if (!description) {
  description = undefined; // 允许为空
}
```

### 7.2 错误捕获

```typescript
try {
  const data = await fetchProductData();
  return data;
} catch (error) {
  // CAPTCHA_PENDING 错误直接抛出
  if (error.message?.startsWith('CAPTCHA_PENDING')) {
    throw error;
  }

  // 其他错误记录日志并返回基础数据
  console.error('[EuraFlow] 数据采集失败:', error);

  // 返回已采集的部分数据
  if (baseData && baseData.ozon_product_id) {
    console.warn('[EuraFlow] 返回已提取的基础数据（部分字段可能缺失）');
    return baseData;
  }

  // 完全失败时返回最小有效数据
  return {
    title: '',
    price: 0,
    images: [],
    has_variants: false
  };
}
```

### 7.3 部分数据返回机制

**原则**: 即使部分 API 失败，也要返回已采集的数据

```typescript
// 基础数据必须
if (!baseData.title || baseData.price === 0) {
  throw new Error('基础数据采集失败');
}

// 可选数据允许缺失
baseData.description = description || undefined;
baseData.dimensions = dimensions || undefined;
baseData.variants = variants || [];
baseData.has_variants = (variants?.length || 0) > 0;

return baseData; // 部分数据也返回
```

---

## 8. 数据格式规范

### 8.1 价格格式处理

OZON API 返回的价格格式多样，需要统一处理：

```typescript
/**
 * OZON 价格格式示例：
 * - "1 299" (俄罗斯格式，空格作为千位分隔符)
 * - "1,299.50" (欧洲格式，逗号作为千位分隔符，点作为小数分隔符)
 * - "1189.50" (标准格式)
 */
const cleanPrice = (str: string) =>
  str.replace(/\s/g, '')      // 移除所有空格
     .replace(/,/g, '.')      // 逗号转点
     .replace(/[^\d.]/g, ''); // 移除非数字字符

const price = parseFloat(cleanPrice(priceStr)) || 0;
```

**示例**:
```typescript
cleanPrice("1 299")      // → "1299"    → 1299
cleanPrice("1,299.50")   // → "1299.50" → 1299.5
cleanPrice("1 299 ₽")    // → "1299"    → 1299
cleanPrice("0")          // → "0"       → 0
cleanPrice("")           // → ""        → 0
```

### 8.2 图片数组格式

**统一格式**（对象数组）:
```typescript
const images: { url: string; is_primary?: boolean }[] = [];

galleryData.images.forEach((img: any, index: number) => {
  if (img.src) {
    images.push({
      url: img.src,
      is_primary: index === 0  // 第一张标记为主图
    });
  }
});
```

**类型定义**:
```typescript
interface ProductImage {
  url: string;            // 图片URL
  is_primary?: boolean;   // 是否为主图
}
```

### 8.3 尺寸单位

OZON API 返回的单位标准：

| 字段 | 单位 | 示例 |
|------|------|------|
| `weight` | 克（g） | 130 |
| `height` | 毫米（mm） | 30 |
| `width` | 毫米（mm） | 130 |
| `length` | 毫米（mm） | 250 |

```typescript
interface ProductDimensions {
  weight: number;   // 重量（克）
  height: number;   // 高度（毫米）
  width: number;    // 宽度（毫米）
  length: number;   // 长度（毫米）
}

const dimensions: ProductDimensions = {
  weight: 130,    // 130 克
  height: 30,     // 30 毫米
  width: 130,     // 130 毫米
  length: 250     // 250 毫米
};
```

---

## 9. 常见问题和解决方案

### 9.1 403 反爬虫拦截

**问题描述**:
- API 请求返回 403 错误
- 响应包含 `incidentId` 字段
- 提示需要完成验证

**解决方案**:
1. AntibotChecker 自动保存 incidentId
2. 触发浏览器通知，提示用户完成验证
3. 暂停所有采集任务
4. 用户完成验证后，调用 `antibot.clearCaptcha()` 恢复

```typescript
// 自动处理（推荐）
const response = await limiter.executeWithRetry(() => fetch(url));

// 手动处理
if (response.status === 403) {
  const data = await response.json();
  const handled = await antibot.handle403(data);

  if (handled) {
    // 暂停采集，等待用户完成验证
    throw new Error('CAPTCHA_PENDING');
  }
}
```

---

### 9.2 429 限流错误

**问题描述**:
- API 请求过于频繁，触发限流
- 响应状态码 429

**解决方案**:
1. OzonApiRateLimiter 自动指数退避重试
2. 重试延迟：1s → 2s → 4s → 8s
3. 最多重试 3 次（含初次请求共 4 次）

```typescript
// 自动重试（内置逻辑）
const response = await limiter.executeWithRetry(() => fetch(url));

// 重试逻辑（内部实现）
if (response.status === 429) {
  const backoffTime = Math.pow(2, attempt) * 1000;
  console.log(`[Limiter] 429 限流，${backoffTime}ms 后重试（第 ${attempt} 次）`);
  await sleep(backoffTime);
  // 重试...
}
```

---

### 9.3 尺寸数据为"-"

**问题描述**:
- 上品帮注入的 DOM 中尺寸显示为"-"
- 表示数据尚未加载完成

**解决方案**:
1. 首次提取时检测到"-"（解析为 -1）
2. 触发二次轮询（100ms × 100次，最多 10 秒）
3. 如果超时仍为"-"，确认为无数据

```typescript
// 首次提取
const injectedData = extractDataFromInjectedDOM();

// 检测"-"
if (injectedData.length === -1) {
  console.log('[EuraFlow] 尺寸数据为"-"，开始二次轮询...');
  await waitForDimensionsData();
  injectedData = extractDataFromInjectedDOM();
}

// 如果仍为"-"，确认无数据
if (injectedData.length === -1) {
  console.log('[EuraFlow] 二次轮询超时，确认无尺寸数据');
  dimensions = undefined;
}
```

---

### 9.4 变体图片缺失

**问题描述**:
- Modal API 返回的变体只有主图（coverImage）
- 缺少附加图片（gallery images）

**解决方案**:
1. 访问变体详情页（`variant.link`）
2. 调用 widgetStates API 获取该变体的 webGallery
3. 提取所有图片并标记为附加图片

```typescript
// 访问变体详情页
const variantUrl = variant.link.split('?')[0];
const apiUrl = `${window.location.origin}/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(variantUrl)}`;

const response = await limiter.executeWithRetry(() => fetch(apiUrl));
const data = await response.json();

// 提取图片
const variantGalleryKey = Object.keys(data.widgetStates).find(k => k.includes('webGallery'));
const variantGalleryData = JSON.parse(data.widgetStates[variantGalleryKey]);

const variantImages: { url: string; is_primary?: boolean }[] = [];
variantGalleryData.images.forEach((img: any, index: number) => {
  variantImages.push({
    url: img.src,
    is_primary: index === 0
  });
});

// 合并到变体数据
variant.images = variantImages;
```

---

### 9.5 价格格式解析错误

**问题描述**:
- OZON API 返回的价格格式多样（"1 299"、"1,299.50"）
- 直接解析会失败

**解决方案**:
1. 统一清理函数：移除空格、替换逗号为点
2. 解析为浮点数
3. 处理空值和非法值

```typescript
const cleanPrice = (str: string) => {
  if (!str) return '0';

  return str
    .replace(/\s/g, '')      // 移除所有空格
    .replace(/,/g, '.')      // 逗号转点
    .replace(/[^\d.]/g, ''); // 移除非数字字符
};

const price = parseFloat(cleanPrice(priceStr)) || 0;
```

**测试用例**:
```typescript
// 正常格式
cleanPrice("1 299")      // → 1299
cleanPrice("1,299.50")   // → 1299.5
cleanPrice("1189.50")    // → 1189.5

// 特殊格式
cleanPrice("1 299 ₽")    // → 1299
cleanPrice("Бесплатно")  // → 0

// 边界情况
cleanPrice("")           // → 0
cleanPrice(null)         // → 0
cleanPrice(undefined)    // → 0
```

---

## 10. 代码位置索引

### 10.1 核心文件路径

| 文件路径 | 功能描述 |
|---------|---------|
| `plugins/ef/channels/ozon/browser_extension/src/content/parsers/product-detail.ts` | 商品详情采集核心逻辑 |
| `plugins/ef/channels/ozon/browser_extension/src/shared/ozon-rate-limiter.ts` | 全局 API 限流器 |
| `plugins/ef/channels/ozon/browser_extension/src/shared/ozon-headers.ts` | 标准 Headers 生成器 |
| `plugins/ef/channels/ozon/browser_extension/src/shared/antibot-checker.ts` | 反爬虫检查器 |
| `plugins/ef/channels/ozon/browser_extension/src/background/service-worker.ts` | 后台服务（处理 Seller API 调用） |
| `plugins/ef/channels/ozon/browser_extension/src/content/components/PublishModal.tsx` | 跟卖配置弹窗 |
| `plugins/ef/channels/ozon/browser_extension/src/content/main.ts` | Content Script 入口 |
| `plugins/ef/channels/ozon/browser_extension/src/shared/storage.ts` | Chrome Storage 工具 |

### 10.2 功能模块映射

| 功能 | 核心函数 | 文件位置 |
|------|---------|---------|
| 商品详情采集 | `extractProductData()` | `product-detail.ts` |
| widgetStates API 解析 | `parseFromWidgetStates()` | `product-detail.ts` |
| Page2 API 调用 | `fetchCharacteristicsAndDescription()` | `product-detail.ts` |
| Modal API 调用 | `fetchFullVariantsFromModal()` | `product-detail.ts` |
| 尺寸数据提取 | `extractDataFromInjectedDOM()` | `product-detail.ts` |
| 变体页面访问 | `访问变体详情页逻辑` | `product-detail.ts` (约第950-1070行) |
| API 限流 | `OzonApiRateLimiter.execute()` | `ozon-rate-limiter.ts` |
| 反爬虫检查 | `AntibotChecker.handle403()` | `antibot-checker.ts` |
| Headers 生成 | `getOzonStandardHeaders()` | `ozon-headers.ts` |

---

## 11. API 调用完整示例

### 11.1 widgetStates API 完整请求

```typescript
// 1. 准备 URL
const productUrl = 'https://www.ozon.ru/product/iphone-15-pro-max-1234567890';
const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=${encodeURIComponent(productUrl)}`;

// 2. 准备 Headers
const headers = {
  'Accept': 'application/json',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br, zstd',
  'Cache-Control': 'no-cache',
  'Origin': 'https://www.ozon.ru',
  'Referer': productUrl,
  'sec-ch-ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'sec-fetch-dest': 'empty',
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'X-O3-App-Name': 'dweb_client',
  'X-O3-App-Version': 'release_18-10-2025_c87fd5b6',
  'X-O3-Manifest-Version': 'frontend-ozon-ru:c87fd5b67349c79b1186a63d756a969351cf71d3',
  'X-O3-Parent-Requestid': crypto.randomUUID(),
  'X-Page-View-Id': crypto.randomUUID()
};

// 3. 发起请求（使用限流器）
const limiter = OzonApiRateLimiter.getInstance();
const response = await limiter.executeWithRetry(() =>
  fetch(apiUrl, {
    method: 'GET',
    headers,
    credentials: 'include'
  })
);

// 4. 解析响应
const data = await response.json();
const widgetStates = data.widgetStates;

// 5. 提取数据
const titleKey = Object.keys(widgetStates).find(k => k.includes('webProductHeading'));
const priceKey = Object.keys(widgetStates).find(k => k.includes('webPrice'));
const galleryKey = Object.keys(widgetStates).find(k => k.includes('webGallery'));

const titleData = titleKey ? JSON.parse(widgetStates[titleKey]) : null;
const priceData = priceKey ? JSON.parse(widgetStates[priceKey]) : null;
const galleryData = galleryKey ? JSON.parse(widgetStates[galleryKey]) : null;
```

### 11.2 响应数据完整示例

```json
{
  "widgetStates": {
    "webProductHeading-1234567890-default-1": "{\"title\":\"Apple iPhone 15 Pro Max 256GB Синий титан\",\"brand\":\"Apple\",\"rating\":4.8,\"reviewsCount\":1234}",
    "webPrice-1234567890-default-1": "{\"price\":\"139 999\",\"cardPrice\":\"129 999\",\"originalPrice\":\"159 999\"}",
    "webGallery-1234567890-default-1": "{\"images\":[{\"src\":\"https://cdn1.ozon.ru/s3/multimedia-1/wc1000/6990871929.jpg\"},{\"src\":\"https://cdn1.ozon.ru/s3/multimedia-2/wc1000/6990871930.jpg\"}],\"videos\":[]}",
    "webCharacteristics-1234567890-default-1": "{\"characteristics\":[{\"title\":\"Бренд\",\"key\":\"brand\",\"values\":[{\"text\":\"Apple\"}]},{\"title\":\"Цвет\",\"key\":\"color\",\"values\":[{\"text\":\"Синий\"}]}]}",
    "webAspects-1234567890-default-1": "{\"aspects\":[{\"title\":\"Цвет\",\"variants\":[{\"sku\":\"1234567890\",\"active\":true,\"data\":{\"searchableText\":\"Синий титан\",\"coverImage\":\"...\"}},{\"sku\":\"1234567891\",\"data\":{\"searchableText\":\"Черный титан\",\"coverImage\":\"...\"}}]},{\"title\":\"Объем памяти\",\"variants\":[{\"sku\":\"1234567890\",\"active\":true,\"data\":{\"searchableText\":\"256 ГБ\"}},{\"sku\":\"1234567892\",\"data\":{\"searchableText\":\"512 ГБ\"}}]}]}"
  },
  "layoutTrackingInfo": "{\"categoryId\":\"7000\",\"productId\":\"1234567890\"}"
}
```

---

## 12. 性能优化建议

### 12.1 并发控制

**策略**: 使用 OzonApiRateLimiter 统一管理，最多 2 个并发

```typescript
// ✅ 推荐：使用限流器
const limiter = OzonApiRateLimiter.getInstance();
const response = await limiter.execute(() => fetch(url));

// ❌ 不推荐：直接并发请求
Promise.all([
  fetch(url1),
  fetch(url2),
  fetch(url3), // 可能触发限流
]);
```

### 12.2 缓存策略

**全局商品数据缓存**（5分钟有效期）:

```typescript
const CACHE_TTL = 5 * 60 * 1000; // 5分钟

const cache = new Map<string, { data: any; timestamp: number }>();

function getCachedData(key: string): any | null {
  const cached = cache.get(key);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  cache.delete(key);
  return null;
}

function setCachedData(key: string, data: any): void {
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
}
```

### 12.3 延迟策略

**访问变体页面时，每次请求间隔 500ms**:

```typescript
for (let i = 0; i < variantLinks.length; i++) {
  const variant = variantLinks[i];

  // 访问变体页面
  const data = await fetchVariantPage(variant.link);

  // 延迟（除了最后一个）
  if (i < variantLinks.length - 1) {
    await sleep(500);
  }
}
```

### 12.4 降级方案

**OZON API 失败时，使用上品帮 DOM 数据**:

```typescript
let dimensions = await fetchDimensionsFromOzonAPI(productSku);

if (!dimensions) {
  console.log('[性能] OZON API 失败，降级到上品帮 DOM');
  dimensions = await extractFromInjectedDOM();
}
```

### 12.5 错误恢复

**部分数据缺失时，仍返回已采集的数据**:

```typescript
// ✅ 推荐：返回部分数据
if (baseData && baseData.ozon_product_id) {
  return {
    ...baseData,
    description: description || undefined,
    dimensions: dimensions || undefined,
    variants: variants || []
  };
}

// ❌ 不推荐：全部失败
if (!description || !dimensions || !variants) {
  throw new Error('数据不完整');
}
```

---

## 13. 前后端字段映射（重要！）

> ⚠️ **警告**：前端 `ProductData` 与后端 `ProductSelectionItem` 的字段名存在差异，上传数据时必须进行映射转换！

### 13.1 尺寸字段映射

| 前端 (ProductData) | 后端 (ProductSelectionItem) | 说明 |
|-------------------|---------------------------|------|
| `weight` | `package_weight` | 重量（克） |
| `depth` | `package_length` | 长度/深度（毫米） |
| `width` | `package_width` | 宽度（毫米） |
| `height` | `package_height` | 高度（毫米） |

**上传时转换代码**（`ControlPanel.tsx`）:
```typescript
const uploadData = toUpload.map(product => ({
  ...product,
  // 尺寸字段名映射（前端 → 后端）
  package_weight: product.weight,
  package_length: product.depth,
  package_width: product.width,
  package_height: product.height,
}));
```

### 13.2 跟卖字段映射

| 前端采集 | 后端存储 | 说明 |
|---------|---------|------|
| `competitor_count` | `competitor_count` | 跟卖数量（一致） |
| `competitor_min_price` | `competitor_min_price` | 跟卖最低价（一致） |

> 注意：之前前端曾使用 `follow_seller_count`、`follow_seller_min_price`，已统一改为 `competitor_*`

### 13.3 销售数据字段映射（上品帮 API → ProductData）

| 上品帮 API (SpbSalesData) | 前端 (ProductData) | 说明 |
|--------------------------|-------------------|------|
| `monthlySales` | `monthly_sales_volume` | 月销量 |
| `monthlySalesAmount` | `monthly_sales_revenue` | 月销售额 |
| `dailySales` | `daily_sales_volume` | 日销量 |
| `dailySalesAmount` | `daily_sales_revenue` | 日销售额 |
| `salesDynamic` | `sales_dynamic_percent` | 销售动态 |
| `transactionRate` | `conversion_rate` | 转化率 |
| `cardViews` | `card_views` | 商品卡片浏览量 |
| `cardAddToCartRate` | `card_add_to_cart_rate` | 卡片加购率 |
| `searchViews` | `search_views` | 搜索浏览量 |
| `searchAddToCartRate` | `search_add_to_cart_rate` | 搜索加购率 |
| `clickThroughRate` | `click_through_rate` | 点击率 |
| `promoDays` | `promo_days` | 促销天数 |
| `promoDiscount` | `promo_discount_percent` | 促销折扣 |
| `promoConversion` | `promo_conversion_rate` | 促销转化率 |
| `paidPromoDays` | `paid_promo_days` | 付费推广天数 |
| `adShare` | `ad_cost_share` | 广告费用占比 |
| `returnCancelRate` | `return_cancel_rate` | 退货取消率 |
| `avgPrice` | `avg_price` | 平均价格 |
| `weight` | `weight` | 重量 |
| `depth` | `depth` | 深度 |
| `width` | `width` | 宽度 |
| `height` | `height` | 高度 |
| `competitorCount` | `competitor_count` | 跟卖数量 |
| `competitorMinPrice` | `competitor_min_price` | 跟卖最低价 |
| `listingDate` | `listing_date` | 上架日期 |
| `listingDays` | `listing_days` | 上架天数 |
| `sellerMode` | `seller_mode` | 发货模式 |
| `category` | `category_path` | 类目路径 |
| `brand` | `brand` | 品牌 |
| `rating` | `rating` | 评分 |
| `reviewCount` | `review_count` | 评价数 |

**转换代码位置**: `collector.ts` → `getSalesDataForBatch()` 方法

### 13.4 开发注意事项

1. **新增字段时**：
   - 检查后端模型 `product_selection.py` 中的字段名
   - 确保前端 `types.ts` 中的字段名与后端一致，或在上传时做映射

2. **修改字段名时**：
   - 同时更新前端和后端
   - 更新本文档的映射表

3. **调试技巧**：
   - 在 Chrome DevTools 的 Network 面板查看上传请求的 payload
   - 确认字段名是否正确

### 13.5 相关文件位置

| 文件 | 说明 |
|------|------|
| `browser_extension/src/shared/types.ts` | 前端类型定义 |
| `browser_extension/src/content/collector.ts` | 数据采集和字段映射 |
| `browser_extension/src/content/components/ControlPanel.tsx` | 上传时的字段转换 |
| `plugins/ef/channels/ozon/models/product_selection.py` | 后端数据模型 |

---

## 附录

### A. 数据结构定义

```typescript
/**
 * 商品详情完整数据结构
 */
interface ProductDetailData {
  ozon_product_id?: string;
  sku?: string;
  title: string;
  description?: string;
  category_id?: number;
  price: number;
  original_price?: number;
  brand?: string;
  barcode?: string;
  images: { url: string; is_primary?: boolean }[];
  primary_image?: string;
  videos?: string[];
  dimensions?: {
    weight: number;   // 克
    height: number;   // 毫米
    width: number;    // 毫米
    length: number;   // 毫米
  };
  attributes?: Array<{
    attribute_id: number;
    value: string;
    dictionary_value_id?: number;
  }>;
  variants?: Array<{
    variant_id: string;
    specifications: string;
    spec_details?: Record<string, string>;
    image_url: string;
    images?: { url: string; is_primary?: boolean }[];
    price: number;
    original_price?: number;
    available: boolean;
    link?: string;
  }>;
  has_variants: boolean;
}
```

### B. 更新日志

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| v1.0.0 | 2025-11-24 | 初始版本，包含所有核心功能文档 |

---

**文档结束** 📄
