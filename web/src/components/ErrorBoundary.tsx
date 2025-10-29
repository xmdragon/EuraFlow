/**
 * React 错误边界组件
 * 用于捕获组件树中的 JavaScript 错误，记录错误并显示降级 UI
 *
 * 使用场景：
 * 1. 包裹整个应用，捕获全局未处理错误
 * 2. 包裹懒加载路由，隔离各页面错误
 * 3. 包裹复杂组件，防止局部错误影响整体
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button, Result } from 'antd';
import { loggers } from '@/utils/logger';

interface Props {
  children: ReactNode;
  /** 错误边界名称，用于日志记录 */
  name?: string;
  /** 自定义降级 UI */
  fallback?: (error: Error, errorInfo: ErrorInfo, reset: () => void) => ReactNode;
  /** 错误回调函数 */
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

/**
 * ErrorBoundary 类组件
 * 注意：错误边界必须使用类组件，因为函数组件无法使用 componentDidCatch
 */
class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  /**
   * 静态方法：从错误中派生状态
   * 当子组件抛出错误时调用
   */
  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  /**
   * 捕获错误并记录日志
   * 在组件抛出错误后被调用
   */
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const { name = 'Unknown', onError } = this.props;

    // 记录错误到日志系统
    loggers.api.error(`[ErrorBoundary:${name}] 捕获到错误:`, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    // 更新状态以显示错误信息
    this.setState({
      errorInfo,
    });

    // 调用外部错误处理回调
    if (onError) {
      onError(error, errorInfo);
    }

    // 在开发环境下，也输出到控制台以便调试
    if (import.meta.env.MODE === 'development') {
      // eslint-disable-next-line no-console -- 开发环境允许使用 console.error
      console.error('ErrorBoundary 捕获错误:', error, errorInfo);
    }
  }

  /**
   * 重置错误状态
   * 用户点击重试按钮时调用
   */
  resetError = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  /**
   * 刷新页面
   * 当错误严重无法恢复时使用
   */
  reloadPage = () => {
    window.location.reload();
  };

  render() {
    const { hasError, error, errorInfo } = this.state;
    const { children, fallback, name = 'Unknown' } = this.props;

    if (hasError && error) {
      // 如果提供了自定义降级 UI，使用自定义 UI
      if (fallback && errorInfo) {
        return fallback(error, errorInfo, this.resetError);
      }

      // 检查是否为chunk加载错误
      const isChunkLoadError = error.name === 'ChunkLoadError' ||
        error.message.includes('Loading chunk') ||
        error.message.includes('Failed to fetch') ||
        error.message.includes('importing a module script failed');

      // 默认降级 UI
      return (
        <div style={{ padding: '50px 20px', maxWidth: '800px', margin: '0 auto' }}>
          <Result
            status={isChunkLoadError ? "warning" : "error"}
            title={isChunkLoadError ? "页面资源加载失败" : "页面加载失败"}
            subTitle={
              isChunkLoadError
                ? "系统可能已更新到新版本，请刷新页面以获取最新内容。"
                : `很抱歉，${name === 'Unknown' ? '此页面' : name}遇到了一些问题。您可以尝试刷新页面或返回首页。`
            }
            extra={
              isChunkLoadError
                ? [
                    <Button type="primary" key="reload" onClick={this.reloadPage}>
                      立即刷新
                    </Button>,
                    <Button key="home" onClick={() => (window.location.href = '/dashboard')}>
                      返回首页
                    </Button>,
                  ]
                : [
                    <Button type="primary" key="retry" onClick={this.resetError}>
                      重试
                    </Button>,
                    <Button key="reload" onClick={this.reloadPage}>
                      刷新页面
                    </Button>,
                    <Button key="home" onClick={() => (window.location.href = '/dashboard')}>
                      返回首页
                    </Button>,
                  ]
            }
          >
            {import.meta.env.MODE === 'development' && (
              <div style={{
                marginTop: '20px',
                padding: '16px',
                background: '#f5f5f5',
                borderRadius: '4px',
                textAlign: 'left'
              }}>
                <p><strong>错误信息：</strong></p>
                <pre style={{
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  fontSize: '12px',
                  color: '#d32f2f'
                }}>
                  {error.toString()}
                </pre>
                {error.stack && (
                  <>
                    <p style={{ marginTop: '12px' }}><strong>错误堆栈：</strong></p>
                    <pre style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '11px',
                      color: '#666',
                      maxHeight: '200px',
                      overflow: 'auto'
                    }}>
                      {error.stack}
                    </pre>
                  </>
                )}
              </div>
            )}
          </Result>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;
