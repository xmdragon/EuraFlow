/**
 * EuraFlow 打印助手 - 后台服务
 * 处理静默打印请求
 */

// 监听来自 content script 的打印请求
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'PRINT_PDF') {
    handlePrintRequest(request.url, sendResponse);
    return true; // 保持消息通道开启，等待异步响应
  }
});

/**
 * 处理打印请求
 * @param {string} pdfUrl - PDF 文件的 URL
 * @param {function} sendResponse - 响应回调函数
 */
async function handlePrintRequest(pdfUrl, sendResponse) {
  try {
    console.log('[EuraFlow Print] 开始打印:', pdfUrl);

    // 获取 PDF 数据
    const response = await fetch(pdfUrl);
    if (!response.ok) {
      throw new Error(`无法获取 PDF: ${response.statusText}`);
    }

    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();
    const base64Data = arrayBufferToBase64(arrayBuffer);

    // 使用 chrome.printing API 打印
    const printJob = {
      job: {
        printerId: '', // 空字符串表示使用默认打印机
        title: `EuraFlow-Label-${Date.now()}`,
        ticket: {
          version: '1.0',
          print: {
            color: {
              type: 'STANDARD_MONOCHROME' // 黑白打印（标签通常不需要彩色）
            },
            duplex: {
              type: 'NO_DUPLEX' // 单面打印
            },
            page_orientation: {
              type: 'PORTRAIT' // 纵向
            },
            copies: {
              copies: 1 // 打印 1 份
            },
            dpi: {
              horizontal_dpi: 300,
              vertical_dpi: 300
            },
            media_size: {
              width_microns: 100000,  // 100mm
              height_microns: 150000  // 150mm (OZON 标签尺寸 100x150)
            }
          }
        },
        contentType: 'application/pdf',
        document: new Blob([arrayBuffer], { type: 'application/pdf' })
      }
    };

    // 提交打印任务
    chrome.printing.submitJob(printJob, (jobId) => {
      if (chrome.runtime.lastError) {
        console.error('[EuraFlow Print] 打印失败:', chrome.runtime.lastError);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        console.log('[EuraFlow Print] 打印任务已提交, Job ID:', jobId);
        sendResponse({ success: true, jobId: jobId });
      }
    });

  } catch (error) {
    console.error('[EuraFlow Print] 打印异常:', error);
    sendResponse({ success: false, error: error.message });
  }
}

/**
 * ArrayBuffer 转 Base64
 */
function arrayBufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

console.log('[EuraFlow Print] 打印助手已启动');
