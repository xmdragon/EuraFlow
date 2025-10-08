# EuraFlow 运维脚本说明

本目录包含 EuraFlow 项目的运维管理脚本。

## 📁 脚本列表

### 1. add_domain.sh - 域名添加工具
在保持现有域名的前提下添加新域名并配置SSL证书。

**使用方法：**
```bash
# 添加新域名（自动配置SSL）
sudo ./add_domain.sh example.com

# 添加新域名（跳过SSL配置）
sudo ./add_domain.sh example.com --skip-ssl

# 查看帮助
./add_domain.sh --help
```

**功能特性：**
- ✅ 自动备份 Nginx 配置
- ✅ 在所有 server 块添加新域名
- ✅ 配置测试与自动回滚
- ✅ 使用 certbot --expand 扩展 SSL 证书
- ✅ 详细的操作日志

**应用场景：**
- 为现有站点添加备用域名
- 配置地区专用域名（如 cn.example.com）
- 添加 API 专用域名（如 api.example.com）
- 多品牌域名统一管理

**前置条件：**
1. 新域名 DNS 已解析到服务器
2. 防火墙开放 80/443 端口
3. Nginx 正常运行
4. Certbot 已安装（或脚本自动安装）

---

### 2. backup.sh - 数据备份工具
执行数据库、文件和配置的全量和增量备份。

**使用方法：**
```bash
# 全量备份
sudo ./backup.sh

# 仅备份数据库
sudo ./backup.sh --db-only

# 仅备份文件
sudo ./backup.sh --files-only
```

---

### 3. health-check.sh - 健康检查工具
检查系统各组件的运行状态。

**使用方法：**
```bash
# 完整健康检查
./health-check.sh

# 仅检查 API
./health-check.sh --api-only

# 仅检查数据库
./health-check.sh --db-only
```

---

### 4. update.sh - 系统更新工具
更新系统代码和依赖。

**使用方法：**
```bash
# 正常更新
sudo ./update.sh

# 更新并重启服务
sudo ./update.sh --restart

# 回滚到上一版本
sudo ./update.sh --rollback
```

---

### 5. setup-ssl.sh - SSL 初始配置工具
首次配置 SSL 证书。

**使用方法：**
```bash
# 使用 Let's Encrypt
sudo ./setup-ssl.sh your-domain.com

# 使用自签名证书（测试用）
sudo ./setup-ssl.sh your-domain.com --self-signed
```

---

## 🔧 最佳实践

### 1. 定期备份
```bash
# 设置每日自动备份
sudo crontab -e

# 添加以下行（每天凌晨 2 点）
0 2 * * * /opt/euraflow/deploy/scripts/backup.sh
```

### 2. 健康监控
```bash
# 设置每 5 分钟健康检查
*/5 * * * * /opt/euraflow/deploy/scripts/health-check.sh >> /var/log/euraflow/health-check.log 2>&1
```

### 3. 证书续期
```bash
# 检查证书续期任务
sudo systemctl status certbot.timer

# 手动测试续期
sudo certbot renew --dry-run
```

### 4. 操作前备份
**重要：** 在进行任何变更操作前，先执行备份：
```bash
sudo ./backup.sh --all
```

---

## 🚨 故障排查

### 域名添加失败
```bash
# 检查 DNS 解析
dig +short new-domain.com
nslookup new-domain.com

# 检查 Nginx 配置
sudo nginx -t

# 查看 Nginx 日志
sudo tail -f /var/log/nginx/error.log

# 查看 Certbot 日志
sudo tail -f /var/log/letsencrypt/letsencrypt.log
```

### SSL 证书问题
```bash
# 查看证书状态
sudo certbot certificates

# 强制续期
sudo certbot renew --force-renewal

# 删除证书重新申请
sudo certbot delete --cert-name your-domain.com
sudo certbot certonly --nginx -d your-domain.com
```

### 备份恢复
```bash
# 列出所有备份
ls -lh /backup/euraflow/

# 恢复数据库
psql -U euraflow -d euraflow < /backup/euraflow/db/euraflow_20241008.sql

# 恢复配置
sudo cp /backup/euraflow/nginx/euraflow_20241008.conf /etc/nginx/sites-available/euraflow
sudo nginx -t && sudo systemctl reload nginx
```

---

## 📚 相关文档

- [部署指南](../README.md)
- [Nginx 配置模板](../nginx/euraflow.conf.template)
- [Let's Encrypt 文档](https://letsencrypt.org/docs/)
- [Certbot 文档](https://certbot.eff.org/docs/)

---

## 💡 提示

1. **权限要求**：大多数脚本需要 root 权限（使用 sudo）
2. **日志查看**：所有脚本都会记录详细日志
3. **交互确认**：关键操作会要求用户确认
4. **自动回滚**：失败时自动恢复到之前的状态
5. **备份保留**：默认保留 30 天的备份文件

---

## 🔒 安全建议

1. **定期检查**：每周检查系统健康状态
2. **备份验证**：定期验证备份文件的完整性
3. **证书监控**：监控 SSL 证书的有效期
4. **日志审计**：定期审查操作日志
5. **权限控制**：限制脚本执行权限

---

**需要帮助？**
- GitHub Issues: https://github.com/your-org/EuraFlow/issues
- 邮箱: support@euraflow.com
