# EuraFlow Nginx 配置文档

## 概述

EuraFlow 使用两个域名来优化性能和用户体验：

| 域名 | 用途 | 配置文件 |
|------|------|----------|
| `euraflow.hjdtrading.com` | 主站（应用入口、API） | `euraflow.conf` |
| `static.hjdtrading.com` | 静态资源 CDN 加速 | `static.hjdtrading.com.conf` |

## 架构图

```
用户浏览器
    │
    ├─── HTML/API ──→ euraflow.hjdtrading.com ──→ FastAPI (8000)
    │                        │
    │                        └─→ /opt/euraflow/web/dist/index.html
    │
    └─── JS/CSS/图片 ──→ static.hjdtrading.com ──→ /opt/euraflow/web/dist/assets/
                                │
                                └─→ /opt/euraflow/web/public/ (downloads, data, scripts)
```

## 缓存策略

### 主站 (euraflow.hjdtrading.com)

- **HTML 页面**: 禁用缓存（`no-store, no-cache`）
- **API 响应**: 无缓存
- **原因**: 确保用户总是获取最新版本

### 静态资源站 (static.hjdtrading.com)

| 路径 | 缓存时间 | 原因 |
|------|----------|------|
| `/assets/js/*` | 30天 + immutable | 文件名含 hash，内容不变 |
| `/assets/css/*` | 30天 + immutable | 文件名含 hash，内容不变 |
| `/downloads/*` | 1天 | 扩展包可能更新 |
| `/data/*` | 1天 | 数据文件可能更新 |
| `/scripts/*` | 1天 | 用户脚本可能更新 |

## 前端构建配置

前端使用 Vite 构建，通过 `STATIC_CDN` 环境变量指定 CDN 域名：

```bash
# 本地开发（不使用 CDN）
cd web && npm run build

# 生产部署（使用 CDN）
cd web && STATIC_CDN=https://static.hjdtrading.com npm run build
```

构建后的 `index.html` 会自动引用 CDN 上的资源：

```html
<script type="module" crossorigin src="https://static.hjdtrading.com/assets/js/index-BzgfvbuP.js"></script>
<link rel="stylesheet" crossorigin href="https://static.hjdtrading.com/assets/css/index-6m733ud6.css">
```

## 部署到新服务器

### 1. 安装 Nginx

```bash
sudo apt update
sudo apt install nginx
```

### 2. 复制配置文件

```bash
# 复制配置
sudo cp docs/nginx/euraflow.conf /etc/nginx/sites-available/euraflow
sudo cp docs/nginx/static.hjdtrading.com.conf /etc/nginx/sites-available/static.hjdtrading.com

# 启用站点
sudo ln -s /etc/nginx/sites-available/euraflow /etc/nginx/sites-enabled/
sudo ln -s /etc/nginx/sites-available/static.hjdtrading.com /etc/nginx/sites-enabled/

# 删除默认站点
sudo rm /etc/nginx/sites-enabled/default
```

### 3. 申请 SSL 证书

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 创建验证目录
sudo mkdir -p /var/www/certbot

# 申请证书（需要先配置 DNS 解析）
sudo certbot certonly --webroot -w /var/www/certbot -d euraflow.hjdtrading.com
sudo certbot certonly --webroot -w /var/www/certbot -d static.hjdtrading.com
```

### 4. 优化 Nginx 配置

编辑 `/etc/nginx/nginx.conf`：

```nginx
# 根据服务器内存调整
# 4GB 内存: 4 workers, 2048 connections
# 2GB 内存: 2 workers, 1024 connections

worker_processes 4;
worker_rlimit_nofile 65535;

events {
    worker_connections 2048;
    multi_accept on;
    use epoll;
}

http {
    # 基础配置
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 1000;
    types_hash_max_size 2048;

    # 隐藏版本号
    server_tokens off;

    # Gzip 压缩
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 4;
    gzip_min_length 256;
    gzip_types text/plain text/css text/xml application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml application/vnd.ms-fontobject application/x-font-ttf font/opentype;

    # 文件缓存（减少磁盘 IO）
    open_file_cache max=10000 inactive=30s;
    open_file_cache_valid 60s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
```

### 5. 重启 Nginx

```bash
# 测试配置
sudo nginx -t

# 重启服务
sudo systemctl restart nginx
```

## 常见问题

### Q: 静态资源 404?

1. 检查文件是否存在：`ls /opt/euraflow/web/dist/assets/`
2. 检查 nginx 配置是否正确：`sudo nginx -t`
3. 检查文件权限：`ls -la /opt/euraflow/web/dist/`

### Q: CORS 错误?

静态资源站已配置 `Access-Control-Allow-Origin: *`，如果仍有问题：
1. 检查浏览器控制台的具体错误
2. 确认 nginx 配置已重新加载

### Q: SSL 证书过期?

Let's Encrypt 证书有效期 90 天，certbot 会自动续期。检查：

```bash
# 查看证书状态
sudo certbot certificates

# 手动续期
sudo certbot renew
```

### Q: 如何验证 CDN 是否生效?

1. 打开浏览器开发者工具 → Network 标签
2. 刷新页面
3. 检查 JS/CSS 请求的域名是否为 `static.hjdtrading.com`
4. 检查响应头是否包含 `Cache-Control: public, max-age=2592000, immutable`

## 更新日志

- **2024-12-01**: 新增 `static.hjdtrading.com` 静态资源站，优化缓存策略
