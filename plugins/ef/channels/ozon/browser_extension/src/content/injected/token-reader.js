/**
 * Token 读取器（注入到页面上下文）
 *
 * Content Script 无法直接访问页面的 localStorage，
 * 需要注入此脚本到页面上下文来读取 localStorage
 */
(function() {
  try {
    const token = localStorage.getItem('ozonid-auth-tokens');
    window.postMessage({
      type: 'EURAFLOW_OZON_TOKEN',
      token: token
    }, '*');
  } catch (error) {
    console.error('[EuraFlow] 读取 ozonid-auth-tokens 失败:', error);
    window.postMessage({
      type: 'EURAFLOW_OZON_TOKEN',
      token: null
    }, '*');
  }
})();
