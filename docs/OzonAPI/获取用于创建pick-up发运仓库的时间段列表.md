# 获取用于创建pick-up发运仓库的时间段列表

## 接口信息

- **HTTP方法**: `POST`
- **API路径**: `/v1/warehouse/fbs/create/pick-up/timeslot/list`
- **操作ID**: `operation/WarehouseFbsCreatePickUpTimeslotList`

## 描述

您可以在讨论的评论中对此方法提供反馈 在 Ozon for dev 开发者社区中。

## 请求参数

### Header参数

| Client-Idrequired | string用户识别号。 |
|---|---|
| Api-Keyrequired | stringAPI-密钥。 |

## 请求示例

```json
{
  "is_kgt": true,
  "address_coordinates": {
    "latitude": 55.7558,
    "longitude": 37.6173
  }
}
```

## 响应
