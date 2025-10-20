import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Spin, message } from 'antd';
import * as pdfjsLib from 'pdfjs-dist';

// 设置 PDF.js worker - 使用 Vite 打包后的 worker URL
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

/**
 * PDF 打印预览页面
 * 用于加载 PDF 文件并自动触发打印对话框
 */
const PrintPDF = () => {
  const [searchParams] = useSearchParams();
  const canvasRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const pdfUrl = searchParams.get('url');

    if (!pdfUrl) {
      setError('缺少 PDF 文件 URL');
      setLoading(false);
      return;
    }

    loadAndPrintPDF(pdfUrl);
  }, [searchParams]);

  const loadAndPrintPDF = async (url: string) => {
    try {
      setLoading(true);
      setError(null);

      // 加载 PDF 文档
      const loadingTask = pdfjsLib.getDocument(url);
      const pdf = await loadingTask.promise;

      console.log('PDF 加载成功，页数：', pdf.numPages);

      // 渲染所有页面到画布
      const container = canvasRef.current;
      if (!container) {
        throw new Error('Canvas 容器未找到');
      }

      // 清空容器
      container.innerHTML = '';

      // 渲染每一页
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });

        // 创建画布
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');

        if (!context) {
          throw new Error('无法获取 canvas context');
        }

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.display = 'block';
        canvas.style.margin = '0 auto 10px';
        canvas.style.pageBreakAfter = 'always';

        container.appendChild(canvas);

        // 渲染页面
        await page.render({
          canvasContext: context,
          viewport: viewport,
        }).promise;

        console.log(`页面 ${pageNum} 渲染完成`);
      }

      setLoading(false);

      // 所有页面渲染完成后，延迟触发打印
      setTimeout(() => {
        console.log('触发打印对话框');
        window.print();
      }, 500);

    } catch (err) {
      console.error('加载 PDF 失败:', err);
      setError(err instanceof Error ? err.message : '加载 PDF 失败');
      setLoading(false);
      message.error('加载 PDF 失败');
    }
  };

  return (
    <div style={{
      padding: '20px',
      minHeight: '100vh',
      backgroundColor: '#f0f0f0'
    }}>
      {loading && (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh'
        }}>
          <Spin size="large" />
          <p style={{ marginTop: 20, fontSize: 16 }}>正在加载 PDF...</p>
        </div>
      )}

      {error && (
        <div style={{
          textAlign: 'center',
          padding: 40,
          color: '#ff4d4f'
        }}>
          <h2>加载失败</h2>
          <p>{error}</p>
        </div>
      )}

      <div
        ref={canvasRef}
        className="pdf-canvas-container"
        style={{
          display: loading ? 'none' : 'block'
        }}
      />

      <style>{`
        @media print {
          body {
            margin: 0;
            padding: 0;
          }

          .pdf-canvas-container canvas {
            page-break-after: always;
            page-break-inside: avoid;
            margin: 0;
          }

          .pdf-canvas-container canvas:last-child {
            page-break-after: auto;
          }
        }
      `}</style>
    </div>
  );
};

export default PrintPDF;
