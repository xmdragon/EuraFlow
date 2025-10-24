# 按照ID获取货件信息

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v3/posting/fbs/get`
- **操作ID**: `operation/PostingAPI_GetFbsPostingV3`

## 描述

用户识别号。

## 请求参数

### Header参数

| Client-Id | required |  | 用户识别号。 |
|---|---|---|---|
| Api-Key | required |  | API-密钥。 |

## 请求示例

```json
{
  "posting_number": "57195475-0050-3",
  "with": {
    "analytics_data": false,
    "barcodes": false,
    "financial_data": false,
    "legal_info": false,
    "product_exemplars": false,
    "related_postings": true,
    "translit": false
  }
}
```

## 响应
