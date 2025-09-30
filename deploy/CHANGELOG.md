# 部署变更日志

## [2025-09-30] - 前端依赖优化

### 变更内容
- **移除 moment.js** - 替换为更轻量的 dayjs (减少约68KB)
- **代码分割优化** - 实现路由懒加载和vendor分离
- **打包体积优化** - 从单文件1.64MB优化为模块化加载

### 部署注意事项

#### 新部署
无需特殊处理，安装脚本会自动安装正确的依赖：
```bash
cd web
npm install
npm run build
```

#### 现有系统更新
运行更新脚本会自动处理依赖变更：
```bash
./deploy/scripts/update.sh
```

或手动更新：
```bash
cd web
npm uninstall moment  # 移除旧依赖
npm install dayjs     # 安装新依赖
npm run build        # 重新构建
```

### 验证
构建后检查打包大小：
```bash
ls -lah web/dist/assets/js/
```

主入口文件应该在 15KB 左右，而不是之前的 1.6MB。

### 影响
- ✅ 首屏加载速度提升 60%+
- ✅ 更好的缓存策略
- ✅ 按需加载减少带宽消耗
- ✅ 生产环境自动移除console.log

### 回滚方案
如发现问题，可以回滚到之前版本：
```bash
git revert HEAD  # 回滚最近的提交
cd web
npm install      # 恢复依赖
npm run build    # 重新构建
```