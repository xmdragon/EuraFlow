/**
 * EuraFlow 打印助手 - Content Script
 * 监听页面的打印请求并转发给后台服务
 */

// 监听来自网页的消息
window.addEventListener('message', (event) => {
  // 只接受来自同源的消息
  if (event.origin !== window.location.origin) {
    return;
  }

  // 检查消息类型
  if (event.data && event.data.type === 'EURAFLOW_PRINT_PDF') {
    const { url, requestId } = event.data;

    console.log('[EuraFlow Print Content] 接收到打印请求:', url);

    // 转发给 background
    chrome.runtime.sendMessage(
      { type: 'PRINT_PDF', url: url },
      (response) => {
        // 将响应发回给网页
        window.postMessage({
          type: 'EURAFLOW_PRINT_RESPONSE',
          requestId: requestId,
          success: response?.success || false,
          error: response?.error,
          jobId: response?.jobId
        }, window.location.origin);
      }
    );
  }
});

// 通知页面扩展已就绪（定期发送，确保前端能接收到）
let readyMessageCount = 0;
const maxReadyMessages = 10; // 最多发送10次

function sendReadyMessage() {
  window.postMessage({ type: 'EURAFLOW_PRINT_READY' }, window.location.origin);
  readyMessageCount++;

  if (readyMessageCount < maxReadyMessages) {
    setTimeout(sendReadyMessage, 500); // 每500ms发送一次
  }
}

// 立即发送第一次
sendReadyMessage();

console.log('[EuraFlow Print Content] Content script 已加载');
