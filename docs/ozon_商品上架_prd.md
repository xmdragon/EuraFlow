# OZON 商品上架（本地系统）一体化实施方案（PRD/SRS）

> 版本：v1.0（2025-10-16, Asia/Singapore）  
> 面向：EuraFlow（欧亚流）/ 宏境达贸易 内部系统  
> 目标：在**本地/自建系统**中，稳定、可审计地完成 **OZON 商品上架**（含“创建新商品卡”与“跟随已有商品卡”两种模式）、价格与库存管理、以及图片通过 **Cloudinary 公网直链**交付给 Ozon 抓取的完整流水线。  
> 风格：务实、可落地、可直接编码。

---

## 0. 快速结论（TL;DR）

- **鉴权**：所有 Seller API 请求需携带 `Client-Id` 与 `Api-Key` 请求头。  
- **建品前置**：先拿**类目树**与**必填属性/字典**，把映射与字典本地化缓存。  
- **图片**：不直传二进制；**提交公网直链**给 `POST /v1/product/pictures/import`，由 Ozon 拉取并生成 `file_id`。推荐用 **Cloudinary** 产出 **匿名可访问的 HTTPS** URL，**固定格式（JPG/PNG/WEBP/HEIC，避免 AVIF）**，比例 3:4，≤10MB。  
- **两种上架路径**：  
  - A. **创建新商品卡**：`/v2/product/import` → `/v1/product/import/info` 查进度 → 价格 `/v1/product/import/prices` → 库存 `/v2/products/stocks`。  
  - B. **跟随已有商品卡（挂同一 PDP）**：**使用同一条码/GTIN** + 不冲突的关键属性；通常无需重传完整媒体。  
- **商用状态机**：将流程拆成三队列：`media`（传图）→ `product_import`（建品）→ `commercial`（价格/库存），每步落盘回执（幂等 & 自动重试）。  
- **频控与延迟**：库存与价格生效有延迟；对外显示和平台状态分离。  
- **风险控制**：坚守“条码一致 + 关键属性不打架”以实现合卡；合规类目提前准备证书与品牌授权。

---

## 1. 业务范围与术语

### 1.1 业务范围
- **本地系统**（EuraFlow）通过 **Ozon Seller API** 完成：  
  1) 类目/属性字典拉取与缓存  
  2) 商品创建（新建卡）与跟随卡（挂已有 PDP）  
  3) 图片导入与关联  
  4) 价格设置与库存上报（FBS / rFBS / FBO 注意仓 ID）  
  5) 上架巡检（状态/错误回执采集，自动补偿）

### 1.2 关键术语
- **offer_id**：商家侧 SKU（你系统内的唯一键/幂等键）。  
- **product_id / Ozon Product ID**：平台生成的商品 ID。  
- **barcode / GTIN/EAN/UPC**：用于**模型/合卡**识别的核心。  
- **PDP（Product Detail Page）**：商品详情页/商品卡。**“跟随”**指多个卖家共用同一 PDP。

---

## 2. 系统总体设计

### 2.1 模块与队列
- **Catalog Service**：类目、属性、字典值缓存管理。  
- **Media Service**：图片导入、状态轮询、回执入库。  
- **Product Service**：新建/跟随商品导入、状态机管理。  
- **Commercial Service**：价格与库存接口、节流与审计。  
- **Inspector/Watchdog**：巡检任务、重试与告警（TelegramBot / Webhook）。

#### 队列（建议用 Redis Stream / RabbitMQ）
1) `media.enqueue` → `media.result`  
2) `product.import.enqueue` → `product.import.result`  
3) `commercial.price.enqueue` / `commercial.stock.enqueue` → 各自 `result`

### 2.2 状态机（ASCII）
```
[Draft] 
  └─(pictures/import OK)→ [MediaReady] 
         └─(product/import)→ [ImportSubmitted]
                └─(import/info=created/price_sent)→ [Created]
                       ├─(prices import)→ [Priced]
                       └─(stocks set)→ [ReadyForSale]
                              └─(front visible)→ [Live]
(任何失败)→ [Error] →(自动重试/人工复核)→ 回到相应上一步
```

### 2.3 数据库（SQLite / MySQL）示意

```sql
-- 类目/属性/字典缓存
CREATE TABLE category (
  category_id INTEGER PRIMARY KEY,
  parent_id INTEGER,
  name TEXT,
  is_leaf INTEGER
);

CREATE TABLE attribute (
  attribute_id INTEGER PRIMARY KEY,
  category_id INTEGER,
  name TEXT,
  is_required INTEGER,
  is_multivalue INTEGER,
  dictionary_id INTEGER,
  type TEXT,          -- string/number/boolean/dictionary
  UNIQUE(attribute_id, category_id)
);

CREATE TABLE dictionary_value (
  dictionary_id INTEGER,
  value_id INTEGER,
  value_text TEXT,
  PRIMARY KEY (dictionary_id, value_id)
);

-- 商品与媒体
CREATE TABLE product_local (
  offer_id TEXT PRIMARY KEY,
  expected_barcode TEXT,
  category_id INTEGER,
  name TEXT,
  dimensions_json TEXT,
  attributes_json TEXT,
  images_json TEXT,     -- 有序数组：cloudinary_urls / ozon_file_ids
  mode TEXT,            -- NEW_CARD | FOLLOW_PDP
  status TEXT,          -- Draft/MediaReady/ImportSubmitted/Created/Priced/ReadyForSale/Live/Error
  ozon_product_id INTEGER,
  ozon_sku TEXT,
  error_msg TEXT,
  created_at DATETIME,
  updated_at DATETIME
);

CREATE TABLE media_import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id TEXT,
  source_url TEXT,
  ozon_file_id TEXT,
  state TEXT,           -- pending/uploaded/failed
  reason TEXT,
  created_at DATETIME
);

CREATE TABLE product_import_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id TEXT,
  request_json TEXT,
  response_json TEXT,
  state TEXT,           -- accepted/processing/failed
  reason TEXT,
  created_at DATETIME
);

CREATE TABLE price_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id TEXT,
  currency TEXT,
  price TEXT,
  old_price TEXT,
  strategy TEXT,
  state TEXT,           -- accepted/failed
  reason TEXT,
  created_at DATETIME
);

CREATE TABLE stock_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  offer_id TEXT,
  product_id INTEGER,
  warehouse_id INTEGER,
  stock INTEGER,
  state TEXT,
  reason TEXT,
  created_at DATETIME
);
```

---

## 3. 接口清单（按流程）

> 注：接口路径为**示意**，以你的 SDK/官方最新文档为准；参数命名可能存在版本差异。保持“幂等键=offer_id”的策略不变。

### 3.1 类目与属性
- `POST /v1/description-category/tree` → 获取类目树（仅末级可建品）。  
- `POST /v1/description-category/attribute` → 获取类目属性及**必填项**。  
- `POST /v1/description-category/attribute/values` → 获取字典值（必要时分页/搜索）。

### 3.2 图片与媒体
- `POST /v1/product/pictures/import` → 传**公网直链 URL**，Ozon 后端抓取后生成 `file_id`。  
- `POST /v2/product/pictures/info` → 轮询抓取状态（`uploaded/failed`）。

### 3.3 商品导入（新建/跟随）
- `POST /v2/product/import` → 批量导入（最多 100/批）。  
- `POST /v1/product/import/info` → 导入进度/错误明细（务必落盘）。

### 3.4 价格与库存
- `POST /v1/product/import/prices` → 批量改价（支持 `old_price`）。  
- `POST /v2/products/stocks` → 批量上报库存（需 `warehouse_id`）。  
- `POST /v5/product/info/prices` / `POST /v4/product/info/stocks` → 对账与巡检。

### 3.5 基础查询
- `POST /v3/product/list` → 按 `offer_id/product_id/visibility` 拉取列表。

---

## 4. Cloudinary 适配规范

### 4.1 资源类型与权限
- 使用 **type=upload** 的**公开资源**（Public），不要使用 `private` 或 `authenticated`（那需要签名 URL，Ozon 无法匿名抓取）。

### 4.2 URL 模板（建议）
- **主图（白底、3:4、1600 宽、JPG，自动质量）**
```
https://res.cloudinary.com/<cloud_name>/image/upload/
  ar_3:4,c_pad,b_white,w_1600,f_jpg,q_auto:good/
  <folder>/<public_id>.jpg
```
- **场景/细节图（3:4、智能裁切）**
```
https://res.cloudinary.com/<cloud_name>/image/upload/
  ar_3:4,c_fill,g_auto,w_1600,f_jpg,q_auto:good/
  <folder>/<public_id>.jpg
```

### 4.3 关键约束
- **匿名可直达**：HTTPS、200 OK、少跳转。  
- **固定格式**：`f_jpg` 或 `f_png`（避免 `f_auto` 输出 AVIF）。WEBP/HEIC 也常见，但以平台口径为准。  
- **体积 ≤ 10MB**：`q_auto:good`，必要时降 `q_auto:eco`。  
- **比例 3:4**：`ar_3:4` + `c_fill`（裁切）或 `c_pad,b_white`（留白）。  
- **主图顺序**：在建品请求中，**第 1 张**为主图；**再次导入会覆盖整组**（按你传入数组顺序）。

### 4.4 健康度自检（发给 Ozon 前）
- `HEAD` 检查：`Content-Type` ∈ `image/jpeg|png|webp|heic`；`Content-Length`；响应 `200`。  
- 确认 URL 在**抓取窗口**内不会过期（不建议用短时效签名）。

---

## 5. 两种上架模式详解

### 5.1 A 模式：创建**新**商品卡
**前提**：你拥有完整内容（品牌、型号、描述、属性、媒体）。

**步骤**：
1) 类目选择与属性映射：缓存 & 校验必填。  
2) 图片先导入：`pictures/import` → 轮询 `pictures/info=uploaded`。  
3) 组装建品请求（包含 `offer_id`、`barcode`、`category_id`、`dimensions`、`attributes`、`images` 等）。  
4) `product/import` → `product/import/info` 观察是否 `created/price_sent`。  
5) `product/import/prices` 设置价格。  
6) `products/stocks` 上报库存（FBS/rFBS 填对 `warehouse_id`；FBO 别名为平台仓流程）。

**最小 JSON（示例）**：
```json
POST /v2/product/import
{
  "items": [
    {
      "offer_id": "EF-ABC-001",
      "barcode": "4601234567890",
      "category_id": 17030819,
      "name": "Brand 型号 规格",
      "description": "简要描述...",
      "dimensions": {"weight": 0.45, "height": 10, "width": 8, "length": 4},
      "images": [
        {"file_name": "img_main_001.jpg"},
        {"file_name": "img_detail_002.jpg"}
      ],
      "attributes": [
        {"attribute_id": 85, "value": "Brand"},
        {"attribute_id": 12345, "dictionary_value_id": 67890}
      ]
    }
  ]
}
```

### 5.2 B 模式：**跟随已有商品卡（共用 PDP）**
**核心原则**：**使用相同条码（GTIN/EAN/UPC）** + 不修改会导致“模型变化”的关键属性（品牌、型号、容量、颜色等）。

**步骤**：
1) 获取目标 PDP 的 **条码/GTIN**（或从包装/供应商/第三方库确认）。  
2) 构建最小商品草稿：`offer_id`、相同 `barcode`、正确 `category_id`、尺寸重量等**最小必填**。  
3) 走 `product/import`，不要上传与模型相冲突的属性/媒体。  
4) 导入成功后直接设置**价格**与**库存**（通常不必重传全量媒体）。

**注意事项**：
- 若你没有条码，可在你已有商品**绑定或生成条码**（视规则而定），与目标 PDP 条码一致后再导入。  
- 任何“模型性”属性冲突，平台可能拒绝合卡或另起卡。  
- 你想补充图时，按正常图片导入，但谨慎不要触发“模型变化”。

---

## 6. 安全、合规与品牌

- 部分类目要求**证书/合规文件/品牌授权**。提前准备并在后台完成资质上传。  
- 命名规范：`品牌 + 品类 + 型号 + 关键规格`，避免营销词。  
- 图片规范：主图尽量纯净白底、无遮挡；避免大面积水印/文案。

---

## 7. 频控、幂等与容错

- **幂等键**：`offer_id` 是你侧的唯一键；全链路以 `offer_id` 做主键，`product_id` 仅作外键。  
- **批处理粒度**：`product/import` ≤ 100/批；`pictures/import` 可大批量，建议分批+重试。  
- **延迟与节流**：价格/库存更新到前台有延迟；对每个商品做**节流策略**（例如单商品每分钟一次库存写入、批量合并）。  
- **回执落盘**：任何 `/info` 接口返回的错误明细都结构化入库，支持**自动补偿**与**人工复核**。  
- **网络容错**：跨境链路波动时，优先**替换源 URL**或延长有效期，再重试。

---

## 8. 接口调用示例（cURL / Python / Node.js）

### 8.1 公共请求头
```bash
-H "Client-Id: <your_client_id>" \
-H "Api-Key: <your_api_key>" \
-H "Content-Type: application/json"
```

### 8.2 图片导入（Cloudinary 直链）
```bash
curl -X POST "https://api-seller.ozon.ru/v1/product/pictures/import" \
  -H "Client-Id: $CLIENT_ID" -H "Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "pictures": [
      {"url":"https://res.cloudinary.com/<cloud>/image/upload/ar_3:4,c_pad,b_white,w_1600,f_jpg,q_auto:good/folder/id1.jpg"},
      {"url":"https://res.cloudinary.com/<cloud>/image/upload/ar_3:4,c_fill,g_auto,w_1600,f_jpg,q_auto:good/folder/id2.jpg"}
    ]
  }'
```

**轮询状态**
```bash
curl -X POST "https://api-seller.ozon.ru/v2/product/pictures/info" \
  -H "Client-Id: $CLIENT_ID" -H "Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "page": 1, "page_size": 100,
    "filter": {"url": ["https://res.cloudinary.com/.../id1.jpg","https://res.cloudinary.com/.../id2.jpg"]}
  }'
```

### 8.3 创建/跟随导入（最小骨架）
```bash
curl -X POST "https://api-seller.ozon.ru/v2/product/import" \
  -H "Client-Id: $CLIENT_ID" -H "Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "items": [{
      "offer_id": "EF-ABC-001",
      "barcode": "4601234567890",
      "category_id": 17030819,
      "name": "Brand 型号 规格",
      "description": "",
      "dimensions": {"weight":0.45,"height":10,"width":8,"length":4},
      "images":[{"file_name":"img_main_001.jpg"}],
      "attributes":[{"attribute_id":85,"value":"Brand"}]
    }]
  }'
```

**导入进度**
```bash
curl -X POST "https://api-seller.ozon.ru/v1/product/import/info" \
  -H "Client-Id: $CLIENT_ID" -H "Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"task_id": "<from_import_response>"}'
```

### 8.4 定价与库存
```bash
curl -X POST "https://api-seller.ozon.ru/v1/product/import/prices" \
  -H "Client-Id: $CLIENT_ID" -H "Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "prices": [{
      "offer_id":"EF-ABC-001",
      "currency_code":"RUB",
      "price":"1290",
      "old_price":"1490",
      "auto_action_enabled":"DISABLED",
      "price_strategy_enabled":"DISABLED"
    }]
  }'
```

```bash
curl -X POST "https://api-seller.ozon.ru/v2/products/stocks" \
  -H "Client-Id: $CLIENT_ID" -H "Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{
    "stocks":[{
      "offer_id":"EF-ABC-001",
      "product_id":2873814040,
      "warehouse_id":12345,
      "stock":20
    }]
  }'
```

### 8.5 Python（requests）片段

```python
import requests, time

BASE = "https://api-seller.ozon.ru"
HEADERS = {
    "Client-Id": "<CLIENT_ID>",
    "Api-Key": "<API_KEY>",
    "Content-Type": "application/json"
}

def pictures_import(urls:list):
    r = requests.post(f"{BASE}/v1/product/pictures/import",
                      headers=HEADERS, json={"pictures":[{"url":u} for u in urls]})
    r.raise_for_status()
    return r.json()

def pictures_info(urls:list, page=1, page_size=100):
    payload = {"page": page, "page_size": page_size, "filter": {"url": urls}}
    r = requests.post(f"{BASE}/v2/product/pictures/info", headers=HEADERS, json=payload)
    r.raise_for_status()
    return r.json()

def wait_pictures_uploaded(urls, timeout=120, interval=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        info = pictures_info(urls)
        states = {item["url"]: item.get("state") for item in info.get("items", [])}
        if all(states.get(u) == "uploaded" for u in urls):
            return states
        time.sleep(interval)
    raise TimeoutError(f"Pictures not uploaded in {timeout}s")

def product_import(items:list):
    r = requests.post(f"{BASE}/v2/product/import", headers=HEADERS, json={"items": items})
    r.raise_for_status()
    return r.json()  # 拿到 task_id

def product_import_info(task_id:str):
    r = requests.post(f"{BASE}/v1/product/import/info", headers=HEADERS, json={"task_id": task_id})
    r.raise_for_status()
    return r.json()
```

### 8.6 Node.js（axios）片段
```js
import axios from "axios";

const BASE = "https://api-seller.ozon.ru";
const api = axios.create({
  baseURL: BASE,
  headers: {
    "Client-Id": process.env.OZON_CLIENT_ID,
    "Api-Key": process.env.OZON_API_KEY,
    "Content-Type": "application/json"
  },
  timeout: 15000
});

export async function picturesImport(urls) {
  const { data } = await api.post("/v1/product/pictures/import", {
    pictures: urls.map(u => ({ url: u }))
  });
  return data;
}

export async function picturesInfo(urls, page=1, page_size=100) {
  const { data } = await api.post("/v2/product/pictures/info", {
    page, page_size, filter: { url: urls }
  });
  return data;
}

export async function productImport(items) {
  const { data } = await api.post("/v2/product/import", { items });
  return data; // 包含 task_id
}

export async function productImportInfo(task_id) {
  const { data } = await api.post("/v1/product/import/info", { task_id });
  return data;
}
```

---

## 9. 质量保障（QA）与 UAT

### 9.1 基线检查（建品前）
- 类目为叶子节点；必填属性均已填；字典值使用合法 value_id。  
- 图片全部 `uploaded`；URL 检查通过；主图顺序正确。  
- 条码（GTIN）与目标 PDP 一致（跟随模式）。

### 9.2 UAT 用例（节选）
- **UAT-001**：Cloudinary URL 直达且 3:4/JPG/≤10MB → `pictures/import` 状态 `uploaded`。  
- **UAT-002**：跟随模式，条码一致，导入后不新起卡；可直接设置价格/库存。  
- **UAT-003**：再次调用 `product/import` 仅传 1 张图 → 验证会**覆盖整组**。  
- **UAT-004**：库存上报同一仓 2 分钟内多次写入 → 后端节流策略生效，合并写入。  
- **UAT-005**：断网/超时 → 自动重试并记录 `product_import_log`。

---

## 10. 运维与告警

- **Telegram Bot** 推送：图片抓取失败、导入失败、库存/价格接口异常。  
- **重试策略**：指数退避（例如 5s/15s/45s/3m），失败三次以上转人工。  
- **审计**：每日生成“价/库差异报表”，对比 `/v5 prices` 与 `/v4 stocks` 的平台回读数据。  
- **缓存更新**：类目/属性/字典值缓存每日（或手动）刷新；变更检测后通知映射维护。

---

## 11. 清单与规范（Checklist）

- [ ] 已配置 `Client-Id` 与 `Api-Key`（环境变量/密钥库）。  
- [ ] 建立类目与属性缓存；字典值可搜索。  
- [ ] Cloudinary URL 规则固化（3:4、JPG、匿名直达、≤10MB）。  
- [ ] `pictures/import` → `pictures/info` 的状态机实现与回执入库。  
- [ ] `product/import` → `import/info` 的错误明细入库。  
- [ ] 跟随模式严格校验条码一致；关键属性不冲突。  
- [ ] 价格/库存队列与节流；巡检接口回读对账。  
- [ ] 告警、重试、报表链路打通。

---

## 12. 环境变量与配置示例

```bash
# .env
OZON_CLIENT_ID=xxxxxxxx
OZON_API_KEY=xxxxxxxx
EF__WAREHOUSE_ID_FBS=12345
EF__CLOUDINARY_CLOUD_NAME=your_cloud
EF__CLOUDINARY_BASE=https://res.cloudinary.com/your_cloud/image/upload
EF__IMG_MAIN_PARAMS=ar_3:4,c_pad,b_white,w_1600,f_jpg,q_auto:good
EF__IMG_DETAIL_PARAMS=ar_3:4,c_fill,g_auto,w_1600,f_jpg,q_auto:good
```

---

## 13. 未来扩展

- 自动识别目标 PDP 条码（通过合规来源或合作数据方），降低人工介入。  
- 增加 **富内容（A+）** 模板化生成与投放（仍基于直链图片）。  
- 引入“价格策略引擎”（基于竞争价、费率、汇率的自动调价）。  
- 多平台（Amazon / TikTok / 1688）统一媒体与属性中台。

---

## 14. 附：最小可运行脚本雏形（Python）

```python
import os, time, requests

BASE = "https://api-seller.ozon.ru"
HEADERS = {
    "Client-Id": os.getenv("OZON_CLIENT_ID"),
    "Api-Key": os.getenv("OZON_API_KEY"),
    "Content-Type": "application/json"
}
CLOUD = os.getenv("EF__CLOUDINARY_BASE")
P_MAIN = os.getenv("EF__IMG_MAIN_PARAMS")

def ozon_post(path, payload):
    r = requests.post(f"{BASE}{path}", headers=HEADERS, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()

def cloudinary_main(public_id, folder="products"):
    return f"{CLOUD}/{P_MAIN}/{folder}/{public_id}.jpg"

def import_pictures(urls):
    return ozon_post("/v1/product/pictures/import", {"pictures":[{"url":u} for u in urls]})

def wait_pictures(urls, timeout=120):
    deadline = time.time()+timeout
    while time.time()<deadline:
        info = ozon_post("/v2/product/pictures/info", {"page":1,"page_size":100,"filter":{"url":urls}})
        states = {i["url"]: i["state"] for i in info.get("items",[])}
        if all(states.get(u)=="uploaded" for u in urls): return states
        time.sleep(5)
    raise TimeoutError("pictures not uploaded in time")

def import_product_minimal(offer_id, barcode, category_id, file_names, attributes):
    items=[{
        "offer_id": offer_id,
        "barcode": barcode,
        "category_id": category_id,
        "name": f"Auto {offer_id}",
        "description": "",
        "dimensions": {"weight":0.4,"height":10,"width":8,"length":4},
        "images":[{"file_name":fn} for fn in file_names],
        "attributes": attributes
    }]
    return ozon_post("/v2/product/import", {"items":items})

def set_price(offer_id, price, old_price=None, currency="RUB"):
    payload={"prices":[{
        "offer_id":offer_id, "currency_code":currency,
        "price":str(price), "old_price": (str(old_price) if old_price else None),
        "auto_action_enabled":"DISABLED", "price_strategy_enabled":"DISABLED"
    }]}
    return ozon_post("/v1/product/import/prices", payload)

def set_stock(offer_id, product_id, stock, warehouse_id):
    payload={"stocks":[{
        "offer_id":offer_id, "product_id":product_id,
        "warehouse_id":warehouse_id, "stock": stock
    }]}
    return ozon_post("/v2/products/stocks", payload)
```

---

**完**：到这里，你可以直接开干：先把类目/属性缓存落地，再把 Cloudinary URL 生成器与图片导入脚本通起来，最后做“新建卡/跟随卡”两条链路的 UAT。遇到具体字段/响应结构的差异，以你当前 SDK/官方文档为准，在此 PRD 的框架内替换即可。
