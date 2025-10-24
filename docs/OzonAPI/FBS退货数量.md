# FBS退货数量

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/returns/company/fbs/info`
- **操作ID**: `operation/returnsCompanyFBSInfo`

## 描述

获取FBS退货及其数量的信息的方法。

## 请求参数

### Header参数

| Client-Idrequired | string用户识别号。 |
|---|---|
| Api-Keyrequired | stringAPI-密钥。 |

## 请求示例

```json
{
  "filter": {
    "place_id": 0
  },
  "pagination": {
    "last_id": 0,
    "limit": 500
  }
}
```

## 响应
