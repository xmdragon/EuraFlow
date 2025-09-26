# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/warehouse/fbo/list` |
| **Content-Type** | `application/json` |

## 请求参数

| 参数名 | 类型 | 必需 | 默认值 | 描述 |
|--------|------|------|--------|------|
| `phonestring仓库电话号码。postings_limitinteger<int32>订单限额。如果没有限额，则返回值为-1。sla_cut_ininteger<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `string仓库电话号码。postings_limitinteger<int32>订单限额。如果没有限额，则返回值为-1。sla_cut_ininteger<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `integer<int32>订单限额。如果没有限额，则返回值为-1。sla_cut_ininteger<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `integer<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `string仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `object仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `string<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `integer<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `boolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | 否 | - | - |

## 响应结构

### 200 - 成功响应

| 字段名 | 类型 | 描述 |
|--------|------|------|
| `phonestring仓库电话号码。postings_limitinteger<int32>订单限额。如果没有限额，则返回值为-1。sla_cut_ininteger<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `postings_limitinteger<int32>订单限额。如果没有限额，则返回值为-1。sla_cut_ininteger<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `sla_cut_ininteger<int64>以分钟为单位的订单备货最低时间。statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `statusstring仓库状态。timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `timetableobject仓库工作时间表。updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `updated_atstring<date-time>仓库信息最后一次更新的日期和时间。warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `warehouse_idinteger<int64>仓库识别符。with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `with_item_listboolean拣货单打印开启的标识。working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `working_daysArray ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |
| `Array ofstringsItems Enum:"UNSPECIFIED""MONDAY""TUESDAY""WEDNESDAY""THURSDAY""FRIDAY""SATURDAY""SUNDAY"仓库工作日：UNSPECIFIED— 值未确定；MONDAY— 星期一；TUESDAY— 星期二；WEDNESDAY— 星期三；THURSDAY— 星期四；FRIDAY— 星期五；SATURDAY— 星期六；SUNDAY— 星期日。` | - | - |

## 通用错误码

| HTTP状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未授权访问 |
| 403 | FORBIDDEN | 禁止访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 429 | TOO_MANY_REQUESTS | 请求频率限制 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
