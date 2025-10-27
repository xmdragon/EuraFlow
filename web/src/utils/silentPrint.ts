/**
 * 静默打印工具
 * 通过浏览器扩展实现静默打印，降级到普通打印对话框
 */

interface PrintResponse {
  success: boolean;
  error?: string;
  jobId?: string;
}

let extensionReady = false;
let requestIdCounter = 0;

// 监听扩展就绪消息
window.addEventListener('message', (event) => {
  if (event.origin === window.location.origin && event.data.type === 'EURAFLOW_PRINT_READY') {
    extensionReady = true;
    console.log('[Silent Print] EuraFlow 打印助手扩展已就绪');
  }
});

/**
 * 尝试静默打印 PDF
 * @param pdfUrl PDF 文件的 URL（可以是相对路径或完整 URL）
 * @returns Promise<boolean> 是否成功
 */
export async function trySilentPrint(pdfUrl: string): Promise<boolean> {
  if (!extensionReady) {
    console.log('[Silent Print] 打印助手扩展未安装，降级到普通打印');
    return false;
  }

  // 如果是相对路径，转换为绝对路径
  const absoluteUrl = pdfUrl.startsWith('http')
    ? pdfUrl
    : `${window.location.origin}${pdfUrl.startsWith('/') ? pdfUrl : '/' + pdfUrl}`;

  return new Promise((resolve) => {
    const requestId = `print_${++requestIdCounter}_${Date.now()}`;
    const timeout = setTimeout(() => {
      cleanup();
      console.log('[Silent Print] 打印请求超时');
      resolve(false);
    }, 10000); // 10秒超时

    const messageHandler = (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.data.type === 'EURAFLOW_PRINT_RESPONSE' &&
        event.data.requestId === requestId
      ) {
        cleanup();

        if (event.data.success) {
          console.log('[Silent Print] 打印成功, Job ID:', event.data.jobId);
          resolve(true);
        } else {
          console.error('[Silent Print] 打印失败:', event.data.error);
          resolve(false);
        }
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', messageHandler);
    };

    window.addEventListener('message', messageHandler);

    // 发送打印请求（使用绝对路径）
    window.postMessage({
      type: 'EURAFLOW_PRINT_PDF',
      url: absoluteUrl,
      requestId: requestId
    }, window.location.origin);
  });
}

/**
 * 打印 PDF（优先静默打印，降级到普通打印）
 * @param pdfUrl PDF 文件的 URL
 * @param iframeId 如果静默打印失败，使用此 iframe 进行降级打印
 */
export async function printPDF(pdfUrl: string, iframeId?: string): Promise<void> {
  const success = await trySilentPrint(pdfUrl);

  if (!success && iframeId) {
    // 降级到普通打印
    console.log('[Silent Print] 使用降级打印方式');
    const iframe = document.getElementById(iframeId) as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.print();
    }
  }
}

/**
 * 检查打印助手扩展是否已安装
 */
export function isPrintExtensionAvailable(): boolean {
  return extensionReady;
}
