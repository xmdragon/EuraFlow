# Ozon Competitor Data Extractor - Tampermonkey 脚本

## 功能说明
这个 Tampermonkey 用户脚本可以从 Ozon 网站提取商品的跟卖者（竞争对手）数据，无需登录即可使用。

## 核心功能
1. **单个商品提取**：在商品详情页提取跟卖者数量、最低价等信息
2. **批量提取**：在首页、分类页、搜索结果页批量提取多个商品的数据
3. **API 方式获取**：通过调用 Ozon 的公开 API 获取准确的数据

## 安装方法
1. 安装 Tampermonkey 浏览器插件（支持 Chrome、Edge、Firefox 等）
2. 打开脚本文件 `ozon_data_extractor.user.js`
3. 点击 Tampermonkey 的"安装"按钮

## 使用方法

### 在商品详情页
- 访问任意 Ozon 商品页（如 `https://www.ozon.ru/product/xxx`）
- 页面右下角会显示"提取跟卖者数据"按钮
- 点击按钮即可获取该商品的跟卖者信息

### 在列表页面
- 访问 Ozon 首页、分类页或搜索结果页
- 页面右下角会显示"批量提取商品数据"按钮
- 点击按钮会自动提取页面上所有商品的跟卖者信息
- 显示进度条，处理完成后显示汇总结果

## 数据说明
提取的数据包括：
- `competitor_count`: 跟卖者数量
- `competitor_min_price`: 跟卖者最低价
- `current_price`: 当前价格
- `product_name`: 商品名称
- `sellers`: 跟卖者列表（如果有详细数据）

## 技术原理
- 脚本通过构造 `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2` 请求
- 传入商品 URL 参数获取 JSON 数据
- 解析返回的 `widgetStates` 中的跟卖者信息
- 无需登录，利用 Ozon 的公开 API

## 注意事项
- 批量处理时每次处理 5 个商品，避免请求过于频繁
- 如果遇到请求失败，可能是触发了反爬机制，稍后再试
- 数据仅供参考，实际情况以 Ozon 官网为准