import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import {
  getApiConfig,
  setApiConfig,
  getCollectorConfig,
  setCollectorConfig,
  testApiConnection
} from '../shared/storage';
import type { ApiConfig, CollectorConfig } from '../shared/types';
import './popup.scss';

function Popup() {
  // API配置
  const [apiConfig, setApiConfigState] = useState<ApiConfig>({
    apiUrl: '',
    apiKey: ''
  });

  // 采集配置
  const [collectorConfig, setCollectorConfigState] = useState<CollectorConfig>({
    targetCount: 100,
    scrollDelay: 5000,
    scrollWaitTime: 1000
  });

  // UI状态
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      const api = await getApiConfig();
      const collector = await getCollectorConfig();
      setApiConfigState(api);
      setCollectorConfigState(collector);
    };
    loadConfig();
  }, []);

  // 测试连接
  const handleTestConnection = async () => {
    if (!apiConfig.apiUrl || !apiConfig.apiKey) {
      setTestResult('error');
      return;
    }

    setIsTesting(true);
    setTestResult(null);

    try {
      const success = await testApiConnection(apiConfig.apiUrl, apiConfig.apiKey);
      setTestResult(success ? 'success' : 'error');
    } catch (error) {
      setTestResult('error');
    } finally {
      setIsTesting(false);
    }
  };

  // 保存配置
  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      await setApiConfig(apiConfig);
      await setCollectorConfig(collectorConfig);
      setSaveMessage('配置已保存');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="popup-container">
      <header className="popup-header">
        <h1>🛒 EuraFlow 选品助手</h1>
        <p className="version">v1.3.0</p>
      </header>

      {/* API配置 */}
      <section className="popup-section">
        <h2>API 配置</h2>

        <div className="form-group">
          <label className="form-label">API URL:</label>
          <input
            type="text"
            className="form-input"
            placeholder="https://your-euraflow-api.com/api/ef/v1"
            value={apiConfig.apiUrl}
            onChange={(e) => setApiConfigState({ ...apiConfig, apiUrl: e.target.value })}
          />
        </div>

        <div className="form-group">
          <label className="form-label">API Key:</label>
          <input
            type="password"
            className="form-input"
            placeholder="your-api-key"
            value={apiConfig.apiKey}
            onChange={(e) => setApiConfigState({ ...apiConfig, apiKey: e.target.value })}
          />
        </div>
      </section>

      {/* 采集参数 */}
      <section className="popup-section">
        <h2>采集参数</h2>

        <div className="form-group">
          <label className="form-label">默认采集数量:</label>
          <input
            type="number"
            className="form-input"
            min={1}
            max={1000}
            value={collectorConfig.targetCount}
            onChange={(e) =>
              setCollectorConfigState({
                ...collectorConfig,
                targetCount: parseInt(e.target.value) || 100
              })
            }
          />
        </div>

        <div className="form-group">
          <label className="form-label">滚动延迟 (毫秒):</label>
          <input
            type="number"
            className="form-input"
            min={1000}
            max={30000}
            step={1000}
            value={collectorConfig.scrollDelay}
            onChange={(e) =>
              setCollectorConfigState({
                ...collectorConfig,
                scrollDelay: parseInt(e.target.value) || 5000
              })
            }
          />
          <p className="hint">防反爬虫延迟，建议 3000-8000ms</p>
        </div>

        <div className="form-group">
          <label className="form-label">加载等待时间 (毫秒):</label>
          <input
            type="number"
            className="form-input"
            min={500}
            max={10000}
            step={500}
            value={collectorConfig.scrollWaitTime}
            onChange={(e) =>
              setCollectorConfigState({
                ...collectorConfig,
                scrollWaitTime: parseInt(e.target.value) || 1000
              })
            }
          />
          <p className="hint">滚动后等待内容加载的时间</p>
        </div>
      </section>

      {/* 操作按钮 */}
      <section className="popup-section">
        <div className="button-group">
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={isTesting || !apiConfig.apiUrl || !apiConfig.apiKey}
          >
            {isTesting ? '测试中...' : '测试连接'}
          </button>

          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={isSaving}
          >
            {isSaving ? '保存中...' : '保存配置'}
          </button>
        </div>

        {testResult && (
          <p className={`test-result ${testResult}`}>
            {testResult === 'success' ? '✓ 连接成功' : '✗ 连接失败'}
          </p>
        )}

        {saveMessage && (
          <p className={`save-message ${saveMessage.includes('失败') ? 'error' : 'success'}`}>
            {saveMessage}
          </p>
        )}
      </section>

      {/* 使用说明 */}
      <section className="popup-section usage-section">
        <h2>使用说明</h2>
        <ol className="usage-list">
          <li>访问 OZON 商品列表页面（如搜索结果、分类页面）</li>
          <li>等待数据源工具（上品帮/毛子ERP）加载完成</li>
          <li>点击页面右上角的控制面板中的"开始采集"按钮</li>
          <li>采集完成后数据将自动上传到 EuraFlow（如启用自动上传）</li>
        </ol>
      </section>

      {/* 调试方法 */}
      <section className="popup-section debug-section">
        <h2>调试方法</h2>
        <p className="debug-description">
          如需查看详细的调试日志，请在浏览器控制台（F12）执行以下命令：
        </p>
        <div className="code-block">
          <code>localStorage.setItem('EURAFLOW_DEBUG', 'true')</code>
        </div>
        <p className="debug-hint">
          刷新页面后生效。关闭调试模式：
        </p>
        <div className="code-block">
          <code>localStorage.removeItem('EURAFLOW_DEBUG')</code>
        </div>
      </section>

      <footer className="popup-footer">
        <p>© 2024 EuraFlow Team</p>
      </footer>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<Popup />);
