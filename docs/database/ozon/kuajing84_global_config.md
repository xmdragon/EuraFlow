# kuajing84_global_config

## 基本信息

- **模型文件**: `plugins/ef/channels/ozon/models/kuajing84_global_config.py`
- **模型类**: `Kuajing84GlobalConfig`
- **用途**: 跨境巴士全局配置表（单例模式，只有一条记录）

## 字段结构

| 字段名 | 类型 | 可空 | 默认值 | 说明 |
|--------|------|:----:|--------|------|
| id | Integer | PK | - | 主键（固定为1） |
| username | String(100) | YES | - | 跨境巴士用户名 |
| password | Text | YES | - | 跨境巴士密码（加密存储） |
| base_url | String(200) | NO | - | 跨境巴士网站地址 |
| cookie | JSONB | YES | - | 登录Cookie（加密存储） |
| cookie_expires_at | DateTime | YES | - | Cookie过期时间 |
| customer_id | String(50) | YES | - | 客户ID（从控制台页面获取） |
| enabled | Boolean | NO | - | 是否启用 |
| created_at | DateTime | NO | server: now() | 创建时间 |
| updated_at | DateTime | NO | server: now() | 更新时间 |
