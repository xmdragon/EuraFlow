/**
 * 复制到剪贴板 Hook
 * 提供统一的复制功能，包含降级方案和提示
 */
import { notifySuccess, notifyError } from '@/utils/notification';

export const useCopy = () => {
  const copyToClipboard = async (text: string | number, label?: string) => {
    const textToCopy = String(text);

    try {
      // 现代浏览器：使用 Clipboard API
      await navigator.clipboard.writeText(textToCopy);
      notifySuccess('复制成功', label ? `${label} 已复制到剪贴板` : '已复制到剪贴板');
      return true;
    } catch {
      // 降级方案：创建临时输入框
      try {
        const textArea = document.createElement('textarea');
        textArea.value = textToCopy;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        const successful = document.execCommand('copy');
        document.body.removeChild(textArea);

        if (successful) {
          notifySuccess('复制成功', label ? `${label} 已复制到剪贴板` : '已复制到剪贴板');
          return true;
        } else {
          notifyError('复制失败', '请手动复制');
          return false;
        }
      } catch (err) {
        notifyError('复制失败', '请手动复制');
        return false;
      }
    }
  };

  return { copyToClipboard };
};
