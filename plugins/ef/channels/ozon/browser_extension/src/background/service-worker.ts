/**
 * 后台服务工作线程
 *
 * 负责：
 * 1. 监听扩展安装和更新事件
 * 2. 处理跨域API请求
 * 3. 管理扩展状态
 */

// 监听扩展安装
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[EuraFlow] Extension installed:', details.reason);

  if (details.reason === 'install') {
    // 首次安装：设置默认配置
    chrome.storage.sync.set({
      apiUrl: '',
      apiKey: '',
      autoUpload: true,
      targetCount: 100,
      scrollDelay: 5000,
      scrollWaitTime: 1000
    });

    // 打开欢迎页面
    chrome.tabs.create({
      url: 'https://github.com/anthropics/euraflow'
    });
  }
});

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('[EuraFlow] Message received:', message);

  if (message.type === 'UPLOAD_PRODUCTS') {
    // 处理商品数据上传
    handleUploadProducts(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true; // 保持消息通道开启（异步响应）
  }

  if (message.type === 'TEST_CONNECTION') {
    // 测试API连接
    handleTestConnection(message.data)
      .then(response => sendResponse({ success: true, data: response }))
      .catch(error => sendResponse({ success: false, error: error.message }));

    return true;
  }
});

/**
 * 处理商品数据上传
 */
async function handleUploadProducts(data: { apiUrl: string; apiKey: string; products: any[] }) {
  const { apiUrl, apiKey, products } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/ozon/product-selection/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey
    },
    body: JSON.stringify({ products })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message || '上传失败');
  }

  return await response.json();
}

/**
 * 测试API连接
 */
async function handleTestConnection(data: { apiUrl: string; apiKey: string }) {
  const { apiUrl, apiKey } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/health`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    throw new Error('连接失败');
  }

  return { status: 'ok' };
}

// 导出类型（供TypeScript使用）
export {};
