# EuraFlow 外网部署指南

## 📋 目录

- [系统要求](#系统要求)
- [快速开始](#快速开始)
- [详细安装](#详细安装)
- [配置说明](#配置说明)
- [服务管理](#服务管理)
- [维护操作](#维护操作)
- [故障排除](#故障排除)
- [安全建议](#安全建议)

## 🖥️ 系统要求

### 最低配置
- **操作系统**: Ubuntu 22.04 LTS 或 24.04 LTS
- **CPU**: 2核心
- **内存**: 2GB RAM
- **磁盘**: 20GB可用空间
- **网络**: 公网IP，域名已解析

### 推荐配置
- **CPU**: 4核心或以上
- **内存**: 4GB RAM或以上
- **磁盘**: 50GB SSD
- **带宽**: 10Mbps或以上

### 需要开放的端口
- **22**: SSH（可选，用于远程管理）
- **80**: HTTP
- **443**: HTTPS
- **8000**: API服务（内部）
- **5432**: PostgreSQL（内部）
- **6379**: Redis（内部）

## 🚀 快速开始

### 一键安装

```bash
# 方法1: 直接运行远程脚本
curl -sSL https://raw.githubusercontent.com/your-org/EuraFlow/master/deploy/install.sh | sudo bash

# 方法2: 下载后运行
wget https://raw.githubusercontent.com/your-org/EuraFlow/master/deploy/install.sh
chmod +x install.sh
sudo ./install.sh
```

### 最小化安装

如果你已经有部分环境，可以跳过某些步骤：

```bash
# 克隆仓库
git clone https://github.com/your-org/EuraFlow.git
cd EuraFlow/deploy

# 运行安装脚本
sudo ./install.sh
```

## 📦 详细安装

### 1. 准备工作

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 设置时区
sudo timedatectl set-timezone Asia/Shanghai

# 设置主机名
sudo hostnamectl set-hostname euraflow-server

# 配置防火墙
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
```

### 2. 安装依赖

```bash
# 安装基础工具
sudo apt install -y curl wget git vim htop

# 安装Python 3.12
sudo add-apt-repository ppa:deadsnakes/ppa -y
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3.12-dev

# 安装Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs

# 安装PostgreSQL 15
sudo apt install -y postgresql-15 postgresql-contrib-15

# 安装Redis
sudo apt install -y redis-server

# 安装Nginx
sudo apt install -y nginx certbot python3-certbot-nginx
```

### 3. 创建用户和目录

```bash
# 创建系统用户
sudo useradd -m -s /bin/bash euraflow
sudo usermod -aG sudo euraflow

# 创建目录
sudo mkdir -p /opt/euraflow
sudo mkdir -p /var/log/euraflow
sudo mkdir -p /backup/euraflow

# 设置权限
sudo chown -R euraflow:euraflow /opt/euraflow
sudo chown -R euraflow:euraflow /var/log/euraflow
sudo chown -R euraflow:euraflow /backup/euraflow
```

### 4. 克隆项目

```bash
# 切换到安装目录
cd /opt

# 克隆项目
sudo -u euraflow git clone https://github.com/your-org/EuraFlow.git euraflow
cd euraflow
```

### 5. 配置环境

```bash
# 创建Python虚拟环境
sudo -u euraflow python3.12 -m venv venv
source venv/bin/activate

# 安装Python依赖
pip install --upgrade pip
pip install -r requirements.txt

# 安装前端依赖
cd web
npm install
npm run build
cd ..
```

### 6. 配置数据库

```bash
# 创建数据库用户
sudo -u postgres createuser euraflow
sudo -u postgres createdb euraflow -O euraflow

# 设置密码
sudo -u postgres psql -c "ALTER USER euraflow PASSWORD 'your_password';"

# 运行迁移
alembic upgrade head
```

### 7. 配置Nginx和SSL

```bash
# 配置Nginx
sudo cp deploy/nginx/euraflow.conf.template /etc/nginx/sites-available/euraflow
sudo ln -s /etc/nginx/sites-available/euraflow /etc/nginx/sites-enabled/
sudo rm /etc/nginx/sites-enabled/default

# 编辑配置，替换域名
sudo vim /etc/nginx/sites-available/euraflow

# 申请SSL证书
sudo certbot --nginx -d your-domain.com

# 重启Nginx
sudo nginx -t && sudo systemctl restart nginx
```

### 8. 配置系统服务

```bash
# 复制服务文件
sudo cp deploy/systemd/*.service /etc/systemd/system/

# 重载systemd
sudo systemctl daemon-reload

# 启用服务
sudo systemctl enable euraflow-backend
sudo systemctl enable euraflow-worker
sudo systemctl enable euraflow-scheduler

# 启动服务
sudo systemctl start euraflow-backend
sudo systemctl start euraflow-worker
sudo systemctl start euraflow-scheduler
```

## ⚙️ 配置说明

### 环境变量配置

复制模板并编辑：

```bash
cp deploy/config/.env.template .env
vim .env
```

关键配置项：

```bash
# 基础配置
EF__ENV=production              # 运行环境
EF__DEBUG=false                 # 调试模式
EF__SECRET_KEY=<生成的密钥>     # 应用密钥

# 数据库
EF__DATABASE__URL=postgresql://user:pass@localhost/db

# Redis
EF__REDIS__URL=redis://localhost:6379/0

# API
EF__API__BASE_URL=https://your-domain.com

# OZON（如需要）
EF__OZON__CLIENT_ID=<你的Client ID>
EF__OZON__API_KEY=<你的API Key>
```

### Nginx配置优化

编辑 `/etc/nginx/sites-available/euraflow`：

```nginx
# 调整上传大小限制
client_max_body_size 100M;

# 启用缓存
proxy_cache_path /var/cache/nginx levels=1:2 keys_zone=cache:10m;

# 启用Gzip压缩
gzip on;
gzip_types text/plain text/css application/json application/javascript;
```

## 🔧 服务管理

### 服务控制命令

```bash
# 启动所有服务
sudo systemctl start euraflow-backend euraflow-worker euraflow-scheduler

# 停止所有服务
sudo systemctl stop euraflow-backend euraflow-worker euraflow-scheduler

# 重启服务
sudo systemctl restart euraflow-backend

# 查看服务状态
sudo systemctl status euraflow-backend

# 查看服务日志
sudo journalctl -u euraflow-backend -f
```

### 使用管理脚本

```bash
# 健康检查
./deploy/scripts/health-check.sh

# 备份
./deploy/scripts/backup.sh

# 更新
./deploy/scripts/update.sh

# SSL证书管理
./deploy/scripts/setup-ssl.sh

# 添加新域名（保持现有域名）
sudo ./deploy/scripts/add_domain.sh example.com
```

## 🔄 维护操作

### 日常备份

设置自动备份：

```bash
# 编辑crontab
sudo crontab -e

# 添加每日备份
0 2 * * * /opt/euraflow/deploy/scripts/backup.sh -a
```

### 更新流程

```bash
# 备份当前版本
./deploy/scripts/backup.sh

# 执行更新
./deploy/scripts/update.sh

# 如果失败，回滚
./deploy/scripts/update.sh --rollback
```

### 日志管理

```bash
# 查看日志
tail -f /var/log/euraflow/app.log

# 清理旧日志
find /var/log/euraflow -name "*.log" -mtime +30 -delete

# 设置日志轮转
sudo vim /etc/logrotate.d/euraflow
```

logrotate配置示例：

```
/var/log/euraflow/*.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0640 euraflow euraflow
    sharedscripts
    postrotate
        systemctl reload euraflow-backend
    endscript
}
```

### 域名管理

#### 添加新域名

如果需要为已部署的系统添加新域名（例如添加备用域名或地区专用域名）：

```bash
# 添加新域名并自动配置SSL
sudo ./deploy/scripts/add_domain.sh new-domain.com

# 仅添加域名，跳过SSL配置
sudo ./deploy/scripts/add_domain.sh new-domain.com --skip-ssl
```

**脚本功能：**
- ✅ 自动备份当前 Nginx 配置
- ✅ 在所有 server 块中添加新域名
- ✅ 测试 Nginx 配置有效性
- ✅ 使用 certbot --expand 扩展 SSL 证书
- ✅ 失败时自动回滚配置

**前置条件：**
1. 新域名的 DNS 已解析到服务器 IP
2. 防火墙已开放 80 和 443 端口
3. 服务器可访问外网（用于 Let's Encrypt 验证）

**示例输出：**
```
╔═══════════════════════════════════════════════════════════╗
║           EuraFlow - 域名添加工具 v1.0                   ║
╚═══════════════════════════════════════════════════════════╝

[INFO] 当前已配置的域名:
  • euraflow.com
  • www.euraflow.com

[INFO] 即将添加新域名: api.euraflow.com

确认继续？(y/N): y

[INFO] 备份 Nginx 配置...
[SUCCESS] 配置已备份到: /backup/euraflow/nginx/euraflow_20241008_203000.conf
[INFO] 添加域名到 Nginx 配置...
[SUCCESS] 域名已添加到配置文件
[INFO] 测试 Nginx 配置...
[SUCCESS] Nginx 配置测试通过
[INFO] 重载 Nginx...
[SUCCESS] Nginx 已重载
[INFO] 配置 SSL 证书...
[SUCCESS] SSL 证书配置成功

[SUCCESS] 域名添加完成！

═══════════════════════════════════════════════════════════
已配置的域名:
  • api.euraflow.com
  • euraflow.com
  • www.euraflow.com

后续步骤:
  1. 访问 https://api.euraflow.com 验证配置
  2. 检查 SSL 证书: https://www.ssllabs.com/ssltest/
  3. 配置 DNS CAA 记录（可选但推荐）
```

**常见问题：**

1. **DNS 未解析**：确保域名已正确解析到服务器 IP
   ```bash
   # 检查 DNS 解析
   dig +short new-domain.com
   nslookup new-domain.com
   ```

2. **SSL 申请失败**：检查 80 端口是否可从外网访问
   ```bash
   # 检查端口
   sudo netstat -tlnp | grep :80
   sudo ufw status
   ```

3. **证书续期**：Let's Encrypt 证书自动续期
   ```bash
   # 检查续期任务
   sudo systemctl status certbot.timer

   # 手动测试续期
   sudo certbot renew --dry-run
   ```

## 🔍 监控

### Prometheus指标

API暴露指标端点：`http://localhost:8000/metrics`

### 健康检查端点

- API健康：`https://your-domain.com/health`
- 详细状态：`https://your-domain.com/api/status`

### 告警配置

编辑 `.env` 添加webhook：

```bash
EF__ALERT__WEBHOOK_URL=https://hooks.slack.com/services/xxx
```

## 🐛 故障排除

### 常见问题

#### 1. 服务无法启动

```bash
# 检查日志
sudo journalctl -u euraflow-backend -n 100

# 检查端口占用
sudo lsof -i:8000

# 验证配置
source venv/bin/activate
python -c "from ef_core.config import settings; print(settings)"
```

#### 2. 数据库连接失败

```bash
# 检查PostgreSQL状态
sudo systemctl status postgresql

# 测试连接
psql -U euraflow -h localhost -d euraflow

# 检查pg_hba.conf
sudo vim /etc/postgresql/15/main/pg_hba.conf
```

#### 3. Nginx 502错误

```bash
# 检查后端服务
curl http://localhost:8000/health

# 检查Nginx错误日志
sudo tail -f /var/log/nginx/error.log

# 重启服务
sudo systemctl restart euraflow-backend nginx
```

#### 4. SSL证书问题

```bash
# 手动更新证书
sudo certbot renew

# 检查证书状态
sudo certbot certificates

# 强制更新
sudo certbot renew --force-renewal
```

### 性能优化

#### 数据库优化

编辑 `/etc/postgresql/15/main/postgresql.conf`：

```conf
shared_buffers = 256MB
effective_cache_size = 1GB
maintenance_work_mem = 64MB
work_mem = 4MB
max_connections = 200
```

#### Redis优化

编辑 `/etc/redis/redis.conf`：

```conf
maxmemory 512mb
maxmemory-policy allkeys-lru
```

#### 系统优化

编辑 `/etc/sysctl.conf`：

```conf
# 网络优化
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30

# 文件描述符
fs.file-max = 65535
```

应用配置：

```bash
sudo sysctl -p
```

## 🔒 安全建议

### 1. SSH安全

```bash
# 禁用root登录
sudo sed -i 's/PermitRootLogin yes/PermitRootLogin no/' /etc/ssh/sshd_config

# 更改SSH端口
sudo sed -i 's/#Port 22/Port 2222/' /etc/ssh/sshd_config

# 仅允许密钥登录
sudo sed -i 's/#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config

sudo systemctl restart sshd
```

### 2. 防火墙配置

```bash
# 仅允许必要端口
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp  # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable
```

### 3. fail2ban配置

```bash
# 安装fail2ban
sudo apt install fail2ban

# 配置
sudo vim /etc/fail2ban/jail.local
```

### 4. 定期更新

```bash
# 系统更新
sudo apt update && sudo apt upgrade

# 依赖更新
./deploy/scripts/update.sh

# 安全补丁
sudo unattended-upgrades
```

### 5. 数据加密

- 使用HTTPS传输
- 数据库密码加密存储
- 敏感配置使用环境变量
- 定期更换密钥和密码

## 📞 支持

### 获取帮助

- 文档：https://docs.euraflow.com
- Issues：https://github.com/your-org/EuraFlow/issues
- 邮箱：support@euraflow.com

### 紧急联系

如遇紧急问题：

1. 查看健康检查：`./deploy/scripts/health-check.sh`
2. 查看错误日志：`tail -f /var/log/euraflow/error.log`
3. 临时回滚：`./deploy/scripts/update.sh --rollback`
4. 联系技术支持

## 📝 许可证

Copyright (c) 2024 EuraFlow Team. All rights reserved.