#!/bin/bash

#===============================================================================
# EuraFlow 更新脚本
# 支持零停机时间更新（滚动更新）
#===============================================================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 配置
INSTALL_DIR="/opt/euraflow"
BACKUP_DIR="/backup/euraflow/updates"
BRANCH="master"
FORCE_UPDATE=false
SKIP_BACKUP=false
SKIP_TESTS=false
ZERO_DOWNTIME=true

# 日志函数
log_info() {
    echo -e "${GREEN}[INFO]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
    rollback
    exit 1
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $(date '+%Y-%m-%d %H:%M:%S') - $1"
}

# 显示横幅
show_banner() {
    echo -e "${BLUE}"
    cat << "EOF"
╔══════════════════════════════════════════════════════════════╗
║              EuraFlow 更新工具 v1.0                          ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# 检查前提条件
check_prerequisites() {
    log_info "检查更新前提条件..."

    # 检查是否为root
    if [[ $EUID -ne 0 ]]; then
        log_error "此脚本必须以 root 权限运行"
    fi

    # 检查目录是否存在
    if [[ ! -d "$INSTALL_DIR" ]]; then
        log_error "EuraFlow 未安装在 $INSTALL_DIR"
    fi

    # 检查Git仓库
    if [[ ! -d "$INSTALL_DIR/.git" ]]; then
        log_error "$INSTALL_DIR 不是Git仓库"
    fi

    # 检查磁盘空间
    AVAILABLE_SPACE=$(df "$INSTALL_DIR" | awk 'NR==2 {print $4}')
    if [[ $AVAILABLE_SPACE -lt 1048576 ]]; then  # 1GB
        log_error "磁盘空间不足（需要至少1GB）"
    fi

    log_success "前提条件检查通过"
}

# 检查更新
check_updates() {
    log_info "检查可用更新..."

    cd "$INSTALL_DIR"

    # 获取当前版本
    CURRENT_VERSION=$(git rev-parse HEAD)
    CURRENT_BRANCH=$(git branch --show-current)

    # 获取远程更新
    git fetch origin

    # 获取最新版本
    LATEST_VERSION=$(git rev-parse origin/$BRANCH)

    if [[ "$CURRENT_VERSION" == "$LATEST_VERSION" ]]; then
        log_info "已是最新版本"
        if [[ "$FORCE_UPDATE" != "true" ]]; then
            exit 0
        fi
        log_warn "强制更新模式"
    else
        log_info "发现新版本"
        echo "当前版本: ${CURRENT_VERSION:0:8}"
        echo "最新版本: ${LATEST_VERSION:0:8}"

        # 显示更新日志
        echo ""
        echo "更新内容:"
        git log --oneline HEAD..origin/$BRANCH | head -20
        echo ""
    fi
}

# 创建备份
create_backup() {
    if [[ "$SKIP_BACKUP" == "true" ]]; then
        log_warn "跳过备份"
        return
    fi

    log_info "创建备份..."

    # 创建备份目录
    mkdir -p "$BACKUP_DIR"
    BACKUP_NAME="euraflow_$(date +%Y%m%d_%H%M%S)"
    BACKUP_PATH="$BACKUP_DIR/$BACKUP_NAME"

    # 运行备份脚本
    if [[ -f "$INSTALL_DIR/deploy/scripts/backup.sh" ]]; then
        "$INSTALL_DIR/deploy/scripts/backup.sh" -a
    else
        # 手动备份
        mkdir -p "$BACKUP_PATH"

        # 备份数据库
        sudo -u postgres pg_dump euraflow | gzip > "$BACKUP_PATH/database.sql.gz"

        # 备份文件
        tar czf "$BACKUP_PATH/files.tar.gz" \
            -C "$INSTALL_DIR" \
            --exclude=venv \
            --exclude=node_modules \
            --exclude=.git \
            .

        # 备份配置
        cp "$INSTALL_DIR/.env" "$BACKUP_PATH/"
        cp -r /etc/nginx/sites-available/euraflow "$BACKUP_PATH/" 2>/dev/null || true
        cp /etc/systemd/system/euraflow*.service "$BACKUP_PATH/" 2>/dev/null || true
    fi

    # 记录备份位置（用于回滚）
    echo "$BACKUP_PATH" > /tmp/euraflow_last_backup

    log_success "备份完成: $BACKUP_PATH"
}

# 停止服务
stop_services() {
    if [[ "$ZERO_DOWNTIME" == "true" ]]; then
        log_info "准备零停机更新..."
        return
    fi

    log_info "停止服务..."

    systemctl stop euraflow-backend || true
    systemctl stop euraflow-worker || true
    systemctl stop euraflow-scheduler || true
    systemctl stop euraflow-watermark || true
    systemctl stop euraflow-competitor || true
    systemctl stop euraflow-ozon-sync || true

    log_success "服务已停止"
}

# 更新代码
update_code() {
    log_info "更新代码..."

    cd "$INSTALL_DIR"

    # 保存本地修改
    if git diff-index --quiet HEAD --; then
        log_info "没有本地修改"
    else
        log_warn "检测到本地修改，暂存中..."
        git stash push -m "Auto stash before update $(date)"
    fi

    # 拉取更新
    git pull origin $BRANCH

    # 恢复本地修改
    if git stash list | grep -q "Auto stash before update"; then
        log_info "恢复本地修改..."
        git stash pop || {
            log_warn "无法自动恢复本地修改，请手动处理"
            git stash list
        }
    fi

    # 更新子模块
    git submodule update --init --recursive

    log_success "代码更新完成"
}

# 更新依赖
update_dependencies() {
    log_info "更新依赖..."

    cd "$INSTALL_DIR"

    # 激活虚拟环境
    source venv/bin/activate

    # 更新Python依赖
    log_info "更新Python依赖..."
    pip install --upgrade pip
    pip install -r requirements.txt

    # 更新前端依赖
    if [[ -f "web/package.json" ]]; then
        log_info "更新前端依赖..."
        cd web
        npm install
        cd ..
    fi

    deactivate

    log_success "依赖更新完成"
}

# 运行数据库迁移
run_migrations() {
    log_info "运行数据库迁移..."

    cd "$INSTALL_DIR"
    source venv/bin/activate

    # 检查待迁移
    alembic current
    alembic history --verbose

    # 运行迁移
    alembic upgrade head

    deactivate

    log_success "数据库迁移完成"
}

# 构建前端
build_frontend() {
    log_info "构建前端资源..."

    if [[ ! -f "$INSTALL_DIR/web/package.json" ]]; then
        log_info "跳过前端构建（无前端）"
        return
    fi

    cd "$INSTALL_DIR/web"

    # 构建生产版本
    npm run build

    log_success "前端构建完成"
}

# 运行测试
run_tests() {
    if [[ "$SKIP_TESTS" == "true" ]]; then
        log_warn "跳过测试"
        return
    fi

    log_info "运行测试..."

    cd "$INSTALL_DIR"
    source venv/bin/activate

    # 运行Python测试
    if [[ -f "pytest.ini" ]] || [[ -f "setup.cfg" ]]; then
        pytest --tb=short || {
            log_error "测试失败"
        }
    fi

    # 运行前端测试
    if [[ -f "web/package.json" ]]; then
        cd web
        npm test -- --watchAll=false || {
            log_error "前端测试失败"
        }
        cd ..
    fi

    deactivate

    log_success "测试通过"
}

# 零停机更新
zero_downtime_update() {
    if [[ "$ZERO_DOWNTIME" != "true" ]]; then
        return
    fi

    log_info "执行零停机更新..."

    # 启动新实例
    log_info "启动新实例..."

    # 创建临时端口配置
    NEW_PORT=8001
    cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.new"
    sed -i "s/EF__API__PORT=8000/EF__API__PORT=$NEW_PORT/" "$INSTALL_DIR/.env.new"

    # 启动新版本服务
    cd "$INSTALL_DIR"
    source venv/bin/activate
    EF_CONFIG="$INSTALL_DIR/.env.new" gunicorn ef_core.app:app \
        --bind 0.0.0.0:$NEW_PORT \
        --workers 2 \
        --worker-class uvicorn.workers.UvicornWorker \
        --daemon \
        --pid /tmp/euraflow_new.pid

    # 等待新服务就绪
    sleep 5

    # 健康检查
    for i in {1..10}; do
        if curl -f http://localhost:$NEW_PORT/health > /dev/null 2>&1; then
            log_info "新实例就绪"
            break
        fi
        sleep 2
    done

    # 更新Nginx配置指向新实例
    log_info "切换流量到新实例..."
    sed -i "s/127.0.0.1:8000/127.0.0.1:$NEW_PORT/" /etc/nginx/sites-available/euraflow
    nginx -t && systemctl reload nginx

    # 停止旧实例
    log_info "停止旧实例..."
    systemctl stop euraflow-backend

    # 更新systemd服务
    systemctl daemon-reload
    systemctl start euraflow-backend

    # 恢复Nginx配置
    sed -i "s/127.0.0.1:$NEW_PORT/127.0.0.1:8000/" /etc/nginx/sites-available/euraflow
    nginx -t && systemctl reload nginx

    # 清理临时进程
    if [[ -f /tmp/euraflow_new.pid ]]; then
        kill $(cat /tmp/euraflow_new.pid) 2>/dev/null || true
        rm /tmp/euraflow_new.pid
    fi
    rm "$INSTALL_DIR/.env.new"

    log_success "零停机更新完成"
}

# 启动服务
start_services() {
    log_info "启动服务..."

    systemctl daemon-reload

    systemctl start euraflow-backend
    systemctl start euraflow-worker
    systemctl start euraflow-scheduler
    systemctl start euraflow-watermark
    systemctl start euraflow-competitor
    systemctl start euraflow-ozon-sync

    # 等待服务启动
    sleep 5

    log_success "服务已启动"
}

# 健康检查
health_check() {
    log_info "执行健康检查..."

    local all_healthy=true

    # 检查后端API
    if curl -f http://localhost:8000/health > /dev/null 2>&1; then
        log_success "API健康"
    else
        log_error "API不健康"
        all_healthy=false
    fi

    # 检查服务状态
    for service in backend worker scheduler watermark competitor ozon-sync; do
        if systemctl is-active --quiet euraflow-$service; then
            echo "  ✓ euraflow-$service 运行中"
        else
            echo "  ✗ euraflow-$service 未运行"
            all_healthy=false
        fi
    done

    # 检查数据库连接
    cd "$INSTALL_DIR"
    source venv/bin/activate
    python -c "
from ef_core.database import get_db
try:
    db = next(get_db())
    db.execute('SELECT 1')
    print('  ✓ 数据库连接正常')
except Exception as e:
    print(f'  ✗ 数据库连接失败: {e}')
    exit(1)
" || all_healthy=false
    deactivate

    if [[ "$all_healthy" == "true" ]]; then
        log_success "健康检查通过"
    else
        log_error "健康检查失败"
    fi
}

# 回滚
rollback() {
    log_warn "执行回滚..."

    # 获取最后的备份
    if [[ -f /tmp/euraflow_last_backup ]]; then
        BACKUP_PATH=$(cat /tmp/euraflow_last_backup)
        if [[ -d "$BACKUP_PATH" ]]; then
            log_info "从备份恢复: $BACKUP_PATH"

            # 停止服务
            systemctl stop euraflow-backend euraflow-worker euraflow-scheduler || true

            # 恢复代码
            cd "$INSTALL_DIR"
            git reset --hard HEAD~1

            # 恢复数据库
            if [[ -f "$BACKUP_PATH/database.sql.gz" ]]; then
                gunzip -c "$BACKUP_PATH/database.sql.gz" | sudo -u postgres psql euraflow
            fi

            # 恢复配置
            if [[ -f "$BACKUP_PATH/.env" ]]; then
                cp "$BACKUP_PATH/.env" "$INSTALL_DIR/.env"
            fi

            # 重启服务
            systemctl start euraflow-backend euraflow-worker euraflow-scheduler

            log_success "回滚完成"
        fi
    else
        log_error "没有可用的备份用于回滚"
    fi
}

# 清理
cleanup() {
    log_info "清理临时文件..."

    # 清理Python缓存
    find "$INSTALL_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
    find "$INSTALL_DIR" -type f -name "*.pyc" -delete 2>/dev/null || true

    # 清理日志
    find /var/log/euraflow -type f -name "*.log" -mtime +30 -delete 2>/dev/null || true

    # 清理旧备份
    find "$BACKUP_DIR" -type f -mtime +7 -delete 2>/dev/null || true

    log_success "清理完成"
}

# 显示更新摘要
show_summary() {
    echo ""
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                    更新完成！                                ║${NC}"
    echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # 显示版本信息
    cd "$INSTALL_DIR"
    echo "当前版本: $(git rev-parse --short HEAD)"
    echo "分支: $(git branch --show-current)"
    echo "最后提交: $(git log -1 --pretty=format:'%h - %s (%cr) <%an>')"
    echo ""

    # 显示服务状态
    echo "服务状态:"
    systemctl status euraflow-backend --no-pager | grep "Active:"
    systemctl status euraflow-worker --no-pager | grep "Active:"
    echo ""

    echo "访问地址: https://$(grep DOMAIN_NAME "$INSTALL_DIR/.env" | cut -d'=' -f2)"
    echo "日志文件: /var/log/euraflow/"
    echo ""
}

# 显示帮助
show_help() {
    cat << EOF
用法: $0 [选项]

选项:
  -h, --help           显示帮助信息
  -f, --force          强制更新（即使已是最新版本）
  -b, --branch BRANCH  指定分支（默认: master）
  -s, --skip-backup    跳过备份
  -t, --skip-tests     跳过测试
  -d, --downtime       使用停机更新（默认: 零停机）
  -r, --rollback       回滚到上一个版本
  --dry-run            模拟运行（不实际执行）

示例:
  $0                   # 正常更新
  $0 -f                # 强制更新
  $0 -b develop        # 从develop分支更新
  $0 -s -t            # 跳过备份和测试
  $0 -r                # 回滚

EOF
}

# 主函数
main() {
    # 解析参数
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -f|--force)
                FORCE_UPDATE=true
                ;;
            -b|--branch)
                BRANCH=$2
                shift
                ;;
            -s|--skip-backup)
                SKIP_BACKUP=true
                ;;
            -t|--skip-tests)
                SKIP_TESTS=true
                ;;
            -d|--downtime)
                ZERO_DOWNTIME=false
                ;;
            -r|--rollback)
                rollback
                exit 0
                ;;
            --dry-run)
                DRY_RUN=true
                ;;
            *)
                echo "未知选项: $1"
                show_help
                exit 1
                ;;
        esac
        shift
    done

    # 显示横幅
    show_banner

    # 执行更新流程
    check_prerequisites
    check_updates

    # 确认更新
    if [[ "$DRY_RUN" != "true" ]]; then
        read -p "确定要更新吗？(y/n): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log_info "更新已取消"
            exit 0
        fi
    fi

    # 更新步骤
    create_backup
    stop_services
    update_code
    update_dependencies
    run_migrations
    build_frontend
    run_tests
    zero_downtime_update
    start_services
    health_check
    cleanup
    show_summary

    log_success "EuraFlow更新成功！"
}

# 错误处理
trap 'log_error "更新失败: 错误代码 $?"' ERR

# 运行主函数
main "$@"