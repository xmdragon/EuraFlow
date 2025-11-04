# 数据库备份插件

自动备份 PostgreSQL 数据库到本地和 Amazon S3（可选）。

## 功能特性

- ✅ 本地备份到 `backups/` 目录
- ✅ 可选的 S3 云备份（双重保障）
- ✅ 自动清理过期备份
- ✅ 定时任务（每天北京时间 01:00 和 13:00）
- ✅ 手动触发备份 API
- ✅ 服务端加密（AES256）
- ✅ 成本优化存储类（STANDARD_IA）

## 配置

### 必需配置（本地备份）

在 `.env` 文件中已经包含数据库配置，无需额外设置：

```bash
EF__DB_HOST=localhost
EF__DB_PORT=5432
EF__DB_NAME=euraflow
EF__DB_USER=euraflow
EF__DB_PASSWORD=your_password
```

### 可选配置（S3 备份）

如果需要启用 S3 云备份，添加以下环境变量：

```bash
# AWS S3 配置
EF__AWS_ACCESS_KEY_ID=your_access_key_id
EF__AWS_SECRET_ACCESS_KEY=your_secret_access_key
EF__AWS_REGION=us-east-1
EF__AWS_S3_BACKUP_BUCKET=your-backup-bucket-name
EF__BACKUP_RETENTION_DAYS=30
```

### 配置说明

| 变量名 | 必需 | 默认值 | 说明 |
|--------|------|--------|------|
| `EF__AWS_ACCESS_KEY_ID` | 否* | - | AWS 访问密钥 ID |
| `EF__AWS_SECRET_ACCESS_KEY` | 否* | - | AWS 访问密钥 |
| `EF__AWS_REGION` | 否 | `us-east-1` | AWS 区域 |
| `EF__AWS_S3_BACKUP_BUCKET` | 否* | - | S3 存储桶名称 |
| `EF__BACKUP_RETENTION_DAYS` | 否 | `30` | S3 备份保留天数 |

\* 如果要启用 S3 备份，这些配置项为必需

## AWS S3 设置步骤

### 1. 创建 S3 存储桶

```bash
# 使用 AWS CLI 创建存储桶
aws s3 mb s3://your-backup-bucket-name --region us-east-1
```

或在 AWS 控制台手动创建。

### 2. 创建 IAM 用户

创建一个专门用于备份的 IAM 用户，授予最小权限：

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:DeleteObject"
      ],
      "Resource": [
        "arn:aws:s3:::your-backup-bucket-name",
        "arn:aws:s3:::your-backup-bucket-name/*"
      ]
    }
  ]
}
```

### 3. 获取访问密钥

在 IAM 用户详情页创建访问密钥，获取：
- Access Key ID
- Secret Access Key

### 4. 配置环境变量

将获取的密钥添加到 `.env` 文件：

```bash
EF__AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
EF__AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
EF__AWS_REGION=us-east-1
EF__AWS_S3_BACKUP_BUCKET=your-backup-bucket-name
EF__BACKUP_RETENTION_DAYS=30
```

### 5. 重启服务

```bash
./restart.sh
```

## 备份策略

### 自动备份

- **频率**：每天 2 次
- **时间**：北京时间 01:00 和 13:00（UTC 17:00 和 05:00）
- **Cron 表达式**：`0 17,5 * * *`

### 保留策略

- **本地备份**：保留 7 天（14 个备份文件）
- **S3 备份**：保留 30 天（可配置）

### 存储优化

- **压缩**：使用 gzip 最高压缩级别
- **S3 存储类**：STANDARD_IA（不频繁访问，成本更低）
- **加密**：AES256 服务端加密

## API 接口

### 1. 手动触发备份

```bash
POST /api/ef/v1/backup/manual
Authorization: Bearer <admin_token>
```

响应：

```json
{
  "success": true,
  "message": "数据库备份成功（含S3）",
  "data": {
    "backup_file": "euraflow_backup_20251104_013000.sql.gz",
    "backup_path": "/path/to/backups/euraflow_backup_20251104_013000.sql.gz",
    "file_size_bytes": 12345678,
    "file_size_mb": 11.77,
    "timestamp": "20251104_013000",
    "s3_uploaded": true,
    "s3_error": null
  }
}
```

### 2. 查看备份状态

```bash
GET /api/ef/v1/backup/status
Authorization: Bearer <admin_token>
```

响应：

```json
{
  "local_backups": {
    "count": 14,
    "total_size_mb": 156.34,
    "retention_days": 7,
    "backup_dir": "/path/to/backups",
    "recent": [
      {
        "filename": "euraflow_backup_20251104_130000.sql.gz",
        "size_mb": 11.77,
        "created_at": 1730707200.0
      }
    ]
  },
  "s3": {
    "enabled": true,
    "bucket": "your-backup-bucket-name",
    "region": "us-east-1",
    "retention_days": 30
  },
  "schedule": "每天北京时间 01:00 和 13:00"
}
```

## 日志监控

查看备份日志：

```bash
# 本地服务
tail -f logs/backend-stderr.log | grep -i backup

# 远程服务
ssh ozon "tail -f /opt/euraflow/logs/backend-stderr.log | grep -i backup"
```

关键日志示例：

```
INFO Database backup plugin initializing...
INFO ✓ S3 备份已启用: bucket=your-backup-bucket-name, retention=30天
INFO 开始备份数据库到: /path/to/backups/euraflow_backup_20251104_013000.sql.gz
INFO 本地数据库备份成功: euraflow_backup_20251104_013000.sql.gz (11.77 MB)
INFO 开始上传到 S3: s3://your-backup-bucket-name/euraflow_backup_20251104_013000.sql.gz
INFO ✓ S3 上传成功: euraflow_backup_20251104_013000.sql.gz
INFO 开始删除 S3 中 3 个超过30天的旧备份...
INFO ✓ S3 备份清理完成，删除了 3 个旧备份
```

## 故障排查

### S3 上传失败

1. **检查 AWS 凭证**：
   ```bash
   aws s3 ls s3://your-backup-bucket-name --profile default
   ```

2. **检查存储桶策略**：确保 IAM 用户有 `PutObject` 权限

3. **检查网络连接**：确保服务器能访问 S3

### 本地备份失败

1. **检查磁盘空间**：
   ```bash
   df -h
   ```

2. **检查 pg_dump**：
   ```bash
   which pg_dump
   pg_dump --version
   ```

3. **检查数据库连接**：
   ```bash
   PGPASSWORD=your_password psql -h localhost -U euraflow -d euraflow -c "SELECT version();"
   ```

## 成本估算

### S3 存储成本（STANDARD_IA）

假设：
- 每天 2 次备份
- 每次备份 100 MB
- 保留 30 天
- 使用 STANDARD_IA 存储类

**月成本**：
- 存储：60 个文件 × 100 MB = 6 GB
- STANDARD_IA 价格：$0.0125/GB/月
- **总计：约 $0.08/月**

非常低廉！

### 注意事项

- S3 请求费用极低（PUT: $0.01/1000 请求）
- 每月约 60 次 PUT + 60 次 DELETE = $0.001
- 数据传输（出站）超过 100GB 后收费

## 最佳实践

1. **测试备份恢复**：定期测试备份文件是否可以成功恢复
2. **监控日志**：设置告警监控备份失败
3. **异地容灾**：S3 提供跨区域复制，进一步提高可靠性
4. **权限最小化**：IAM 用户只授予必需权限
5. **定期审计**：检查备份文件完整性和可用性

## 恢复数据库

### 从本地备份恢复

```bash
# 停止服务
./stop.sh

# 恢复数据库
PGPASSWORD=your_password pg_restore \
  -h localhost \
  -U euraflow \
  -d euraflow \
  -c \
  --if-exists \
  backups/euraflow_backup_20251104_013000.sql.gz

# 启动服务
./start.sh
```

### 从 S3 备份恢复

```bash
# 1. 下载备份
aws s3 cp s3://your-backup-bucket-name/euraflow_backup_20251104_013000.sql.gz ./

# 2. 恢复数据库
./stop.sh
PGPASSWORD=your_password pg_restore \
  -h localhost \
  -U euraflow \
  -d euraflow \
  -c \
  --if-exists \
  euraflow_backup_20251104_013000.sql.gz
./start.sh
```

## 许可证

EuraFlow Database Backup Plugin - MIT License
