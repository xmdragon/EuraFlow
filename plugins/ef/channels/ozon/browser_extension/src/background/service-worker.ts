/**
 * 后台服务工作线程
 *
 * 负责：
 * 1. 监听扩展安装和更新事件
 * 2. 处理跨域API请求
 * 3. 管理扩展状态
 */

// 监听扩展安装
chrome.runtime.onInstalled.addListener((details: chrome.runtime.InstalledDetails) => {

  if (details.reason === 'install' || details.reason === 'update') {
    // 首次安装或更新：确保默认配置存在
    chrome.storage.sync.get(['targetCount', 'scrollDelay', 'scrollWaitTime'], (result) => {
      const updates: { [key: string]: any } = {};

      // 只设置缺失的配置项
      if (result.targetCount === undefined) {
        updates.targetCount = 100;
      }
      if (result.scrollDelay === undefined) {
        updates.scrollDelay = 5000;
      }
      if (result.scrollWaitTime === undefined) {
        updates.scrollWaitTime = 1000;
      }

      // 如果有缺失项，更新存储
      if (Object.keys(updates).length > 0) {
        chrome.storage.sync.set(updates);
      }
    });
  }
});

// 监听来自内容脚本的消息
chrome.runtime.onMessage.addListener((message: any, _sender: chrome.runtime.MessageSender, sendResponse: (response?: any) => void) => {


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

  // 创建超时控制器（60秒超时）
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${apiUrl}/api/ef/v1/ozon/product-selection/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ products }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorMessage = '上传失败';

      try {
        const errorData = await response.json();

        // 解析错误详情
        if (errorData.detail) {
          if (typeof errorData.detail === 'string') {
            errorMessage = errorData.detail;
          } else if (errorData.detail.message) {
            errorMessage = errorData.detail.message;
          } else if (errorData.detail.code) {
            // 根据错误代码提供友好提示
            switch (errorData.detail.code) {
              case 'UNAUTHORIZED':
                errorMessage = 'API Key无效或权限不足';
                break;
              case 'PAYLOAD_TOO_LARGE':
                errorMessage = '数据量过大（最多1000条）';
                break;
              case 'EMPTY_PAYLOAD':
                errorMessage = '没有可上传的商品';
                break;
              default:
                errorMessage = errorData.detail.code;
            }
          }
        } else if (errorData.message) {
          errorMessage = errorData.message;
        }
      } catch (parseError) {
        // JSON解析失败，使用HTTP状态码
        errorMessage = `服务器错误 (HTTP ${response.status})`;
      }

      throw new Error(errorMessage);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);

    // 处理不同类型的错误
    if (error.name === 'AbortError') {
      throw new Error('上传超时（请检查网络连接或减少上传数量）');
    } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
      throw new Error('网络连接失败（请检查API地址和网络）');
    } else {
      throw error;
    }
  }
}

/**
 * 测试API连接
 */
async function handleTestConnection(data: { apiUrl: string; apiKey: string }) {
  const { apiUrl, apiKey } = data;

  const response = await fetch(`${apiUrl}/api/ef/v1/auth/me`, {
    method: 'GET',
    headers: {
      'X-API-Key': apiKey
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }

  const userData = await response.json();
  return { status: 'ok', username: userData.username };
}

// 导出类型（供TypeScript使用）
export {};
