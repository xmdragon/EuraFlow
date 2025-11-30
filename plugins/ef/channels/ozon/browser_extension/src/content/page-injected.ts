/**
 * 注入到页面上下文的脚本
 * 【重要】此脚本在页面的 JavaScript 上下文中运行，可以绕过反爬虫检测
 */

// 监听来自 Content Script 的请求
window.addEventListener('euraflow_page_request', async (event: Event) => {
  const customEvent = event as CustomEvent;
  const { requestId, type, url } = customEvent.detail || {};

  if (!requestId || !type) return;

  if (type === 'fetch') {
    try {
      const response = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        window.dispatchEvent(new CustomEvent('euraflow_page_response', {
          detail: { requestId, success: false, error: `HTTP ${response.status}` }
        }));
        return;
      }

      const data = await response.json();
      window.dispatchEvent(new CustomEvent('euraflow_page_response', {
        detail: { requestId, success: true, data }
      }));
    } catch (error: any) {
      window.dispatchEvent(new CustomEvent('euraflow_page_response', {
        detail: { requestId, success: false, error: error.message }
      }));
    }
  }
});

// 标记脚本已加载
(window as any).__EURAFLOW_PAGE_SCRIPT_LOADED__ = true;
