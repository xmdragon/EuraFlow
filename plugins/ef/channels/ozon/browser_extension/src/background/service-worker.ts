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
      let errorDetails = '';

      try {
        const errorData = await response.json();

        // 调试日志：输出完整错误响应
        console.error('[Upload] Error response:', JSON.stringify(errorData, null, 2));

        // 多层级解析错误信息
        // 1. 尝试 errorData.detail.message (FastAPI HTTPException)
        if (errorData.detail && typeof errorData.detail === 'object' && errorData.detail.message) {
          errorMessage = errorData.detail.message;
          if (errorData.detail.code) {
            errorDetails = ` [${errorData.detail.code}]`;
          }
        }
        // 2. 尝试 errorData.detail 作为字符串
        else if (errorData.detail && typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        }
        // 3. 尝试 errorData.message
        else if (errorData.message) {
          errorMessage = errorData.message;
        }
        // 4. 尝试 errorData.error.message (统一错误格式)
        else if (errorData.error && errorData.error.message) {
          errorMessage = errorData.error.message;
        }
        // 5. 根据 code 提供友好提示
        else if (errorData.code || (errorData.detail && errorData.detail.code)) {
          const code = errorData.code || errorData.detail.code;
          switch (code) {
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
              errorMessage = `上传失败 [${code}]`;
          }
        }
        // 6. 如果都没有，使用 HTTP 状态码
        else {
          errorMessage = `服务器错误 (HTTP ${response.status})`;
          errorDetails = JSON.stringify(errorData).substring(0, 100);
        }
      } catch (parseError) {
        // JSON解析失败，尝试读取文本
        try {
          const errorText = await response.text();
          errorMessage = `服务器错误 (HTTP ${response.status})`;
          if (errorText) {
            errorDetails = `: ${errorText.substring(0, 100)}`;
          }
        } catch {
          errorMessage = `服务器错误 (HTTP ${response.status})`;
        }
      }

      throw new Error(errorMessage + errorDetails);
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
