/**
 * 开发环境性能监控工具
 * - react-scan: 组件渲染性能分析
 * - stats.js: FPS/内存监控
 */

export async function initPerformanceMonitoring(): Promise<void> {
  // 仅开发环境启用
  if (import.meta.env.MODE !== 'development') return;

  // 动态导入，避免生产构建包含这些依赖
  const [{ scan }, Stats] = await Promise.all([
    import('react-scan'),
    import('stats.js'),
  ]);

  // 初始化 react-scan
  scan({
    enabled: true,
    log: false, // 避免控制台刷屏，使用可视化面板即可
  });

  // 初始化 stats.js（FPS 监控）
  const stats = new Stats.default();
  stats.showPanel(0); // 0: FPS, 1: MS, 2: MB
  stats.dom.style.cssText = 'position:fixed;top:0;right:0;z-index:99999;';
  document.body.appendChild(stats.dom);

  // 启动帧率监控循环
  function animate() {
    stats.begin();
    stats.end();
    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // eslint-disable-next-line no-console
  console.info('[Performance] 性能监控已启用 (react-scan + stats.js)');
}
