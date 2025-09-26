# /v3/posting/fbs/get

## 接口信息

- **HTTP方法**: POST
- **路径**: `/v3/posting/fbs/get`

## 详细信息

通知在测试模式下工作。我们建议您使用以下方法检查发货日期 POST /v3/posting/fbs/get 在字段 `result.shipment_date`。  
  
字段 `new_cutoff_date` 可能会出现空白, 因为快递间隔已经被删除。请等到新的日期被确定下来--后新的通知就会到来。    
有时, 这种类型的通知可能在备货完成后才到达。 — 请忽略之。 

通知仅适用于FBS和rFBS货件：
    
    
    {
      "message_type": "TYPE_CUTOFF_DATE_CHANGED",
      "posting_number": "24219509-0020-2",
      "new_cutoff_date": "2021-11-24T07:00:00Z",
      "old_cutoff_date": "2021-11-21T10:00:00Z",
      "warehouse_id": 0,
      "seller_id": 15
    }

参数 | 类型 | 形式 | 描述  
---|---|---|---  
`message_type` | string | — | 通知类型 — `TYPE_CUTOFF_DATE_CHANGED`。  
`posting_number` | string | — | 发货号。  
`new_cutoff_date` | string | date-time | 新的装运日期和时间以UTC格式显示。  
`old_cutoff_date` | string | date-time | 上一个装运日期和时间以UTC格式显示。  
`warehouse_id` | integer | int64 | 储存该批发货的仓库的识别号。  
`seller_id` | integer | int64 | 卖家识别号。
