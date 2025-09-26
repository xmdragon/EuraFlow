# 回复

## 接口信息

| 属性 | 值 |
|------|-----|
| **HTTP方法** | `POST` |
| **请求路径** | `/v1/cluster/list` |
| **Content-Type** | `application/json` |

## 响应结构

### 200 - 成功响应

| 字段名 | 类型 | 描述 |
|--------|------|------|
| `warehouse_idinteger<int64>仓库识别号。can_print_act_in_advanceboolean有可能提前打印收发证书。true, 如果可以提前打印的话。first_mile_typeobject第一英里 FBS。has_postings_limitboolean该迹象表明对最小订单数有限制。true, 如果有限制。is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | has_postings_limitboolean该迹象表明对最小订单数有限制。true, 如果有限制。is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `can_print_act_in_advanceboolean有可能提前打印收发证书。true, 如果可以提前打印的话。first_mile_typeobject第一英里 FBS。has_postings_limitboolean该迹象表明对最小订单数有限制。true, 如果有限制。is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `first_mile_typeobject第一英里 FBS。has_postings_limitboolean该迹象表明对最小订单数有限制。true, 如果有限制。is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `has_postings_limitboolean该迹象表明对最小订单数有限制。true, 如果有限制。is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `is_karantinboolean该迹象表明仓库因隔离而停止运作。is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `is_kgtboolean该迹象表明仓库接受大宗商品。is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `is_timetable_editableboolean该迹象表明可以改变仓库运行时间表。min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `min_postings_limitinteger<int32>限制的最小值是指在一次供货中可以带来的订单数量。postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。 | - |
| `postings_limitinteger<int32>极限值。-1, 如果没有限制min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | 状态 Seller API | - |
| `min_working_daysinteger<int64>仓库运行天数。statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | new | - |
| `statusstring仓库状况。仓库状态与个人账户中的状态的对应关系:状态 Seller API个人账户中的状态new正在激活created已激活disabled存档blocked已封禁disabled_due_to_limit暂停中error错误working_daysArray ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | created | - |
| `状态 Seller API` | disabled | - |
| `new` | blocked | - |
| `个人账户中的状态` | - | - |
| `正在激活` | - | - |
| `已激活` | - | - |
| `存档` | - | - |
| `已封禁` | - | - |
| `暂停中` | - | - |
| `错误` | - | - |
| `Array ofstringsItems Enum:"1""2""3""4""5""6""7"仓库运行天数。` | - | - |

## 通用错误码

| HTTP状态码 | 错误码 | 说明 |
|------------|--------|------|
| 400 | BAD_REQUEST | 请求参数错误 |
| 401 | UNAUTHORIZED | 未授权访问 |
| 403 | FORBIDDEN | 禁止访问 |
| 404 | NOT_FOUND | 资源不存在 |
| 429 | TOO_MANY_REQUESTS | 请求频率限制 |
| 500 | INTERNAL_ERROR | 服务器内部错误 |
