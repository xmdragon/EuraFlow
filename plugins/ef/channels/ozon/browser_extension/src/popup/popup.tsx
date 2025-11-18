import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import {
  getApiConfig,
  setApiConfig,
  getCollectorConfig,
  setCollectorConfig,
  testApiConnection,
  getShangpinbangConfig,
  getDataPanelConfig,
  setDataPanelConfig
} from '../shared/storage';
import type { ApiConfig, CollectorConfig, ShangpinbangConfig, DataPanelConfig } from '../shared/types';
import { FIELD_GROUPS, DEFAULT_FIELDS } from '../shared/types';
import './popup.scss';

function Popup() {
  // 标签页状态
  const [activeTab, setActiveTab] = useState<'api' | 'spb' | 'collector' | 'dataPanel'>('api');

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

  // 上品帮配置
  const [spbConfig, setSpbConfig] = useState<ShangpinbangConfig>({
    phone: '',
    password: '',
    token: undefined
  });

  // 数据面板配置
  const [dataPanelConfig, setDataPanelConfigState] = useState<DataPanelConfig>({
    visibleFields: [...DEFAULT_FIELDS]
  });

  // UI状态
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // 上品帮登录状态
  const [isSpbLoggingIn, setIsSpbLoggingIn] = useState(false);
  const [spbLoginResult, setSpbLoginResult] = useState<'success' | 'error' | null>(null);
  const [spbLoginMessage, setSpbLoginMessage] = useState('');

  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      const api = await getApiConfig();
      const collector = await getCollectorConfig();
      const spb = await getShangpinbangConfig();
      const dataPanel = await getDataPanelConfig();
      setApiConfigState(api);
      setCollectorConfigState(collector);
      setSpbConfig(spb);
      setDataPanelConfigState(dataPanel);
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

  // 上品帮登录
  const handleSpbLogin = async () => {
    if (!spbConfig.phone || !spbConfig.password) {
      setSpbLoginResult('error');
      setSpbLoginMessage('请填写手机号和密码');
      return;
    }

    setIsSpbLoggingIn(true);
    setSpbLoginResult(null);
    setSpbLoginMessage('');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SPB_LOGIN',
        data: {
          phone: spbConfig.phone,
          password: spbConfig.password
        }
      });

      if (response.success) {
        setSpbLoginResult('success');
        setSpbLoginMessage('✓ 登录成功');
        // 更新本地token状态
        setSpbConfig({ ...spbConfig, token: response.data.token });
        setTimeout(() => {
          setSpbLoginResult(null);
          setSpbLoginMessage('');
        }, 3000);
      } else {
        setSpbLoginResult('error');
        setSpbLoginMessage(`✗ ${response.error || '登录失败'}`);
      }
    } catch (error: any) {
      setSpbLoginResult('error');
      setSpbLoginMessage(`✗ ${error.message || '登录失败'}`);
    } finally {
      setIsSpbLoggingIn(false);
    }
  };

  // 数据面板：切换字段显示
  const handleToggleField = (fieldKey: string) => {
    const newVisibleFields = dataPanelConfig.visibleFields.includes(fieldKey)
      ? dataPanelConfig.visibleFields.filter(key => key !== fieldKey)
      : [...dataPanelConfig.visibleFields, fieldKey];
    setDataPanelConfigState({ visibleFields: newVisibleFields });
  };

  // 数据面板：重置为默认字段
  const handleResetFields = () => {
    setDataPanelConfigState({ visibleFields: [...DEFAULT_FIELDS] });
  };

  // 数据面板：保存配置
  const handleSaveDataPanel = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      await setDataPanelConfig(dataPanelConfig);
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
        <h1>EuraFlow 选品助手</h1>
        <p className="version">v1.6.0</p>
      </header>

      {/* 标签页导航 */}
      <nav className="tab-nav">
        <button
          className={`tab-button ${activeTab === 'api' ? 'active' : ''}`}
          onClick={() => setActiveTab('api')}
        >
          API配置
        </button>
        <button
          className={`tab-button ${activeTab === 'spb' ? 'active' : ''}`}
          onClick={() => setActiveTab('spb')}
        >
          上品帮
        </button>
        <button
          className={`tab-button ${activeTab === 'collector' ? 'active' : ''}`}
          onClick={() => setActiveTab('collector')}
        >
          采集参数
        </button>
        <button
          className={`tab-button ${activeTab === 'dataPanel' ? 'active' : ''}`}
          onClick={() => setActiveTab('dataPanel')}
        >
          数据面板
        </button>
      </nav>

      {/* 标签页内容 */}
      <div className="tab-content">
        {/* API配置 */}
        {activeTab === 'api' && (
          <div className="tab-panel">
            <div className="form-group">
              <label className="form-label">API URL:</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://euraflow.hjdtrading.com"
                value={apiConfig.apiUrl}
                onChange={(e) => setApiConfigState({ ...apiConfig, apiUrl: e.target.value })}
              />
              <p className="hint">只需填写域名，不需要带路径</p>
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
          </div>
        )}

        {/* 上品帮配置 */}
        {activeTab === 'spb' && (
          <div className="tab-panel">
            <div className="form-group">
              <label className="form-label">手机号:</label>
              <input
                type="text"
                className="form-input"
                placeholder="请输入手机号"
                value={spbConfig.phone}
                onChange={(e) => setSpbConfig({ ...spbConfig, phone: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">密码:</label>
              <input
                type="password"
                className="form-input"
                placeholder="请输入密码"
                value={spbConfig.password}
                onChange={(e) => setSpbConfig({ ...spbConfig, password: e.target.value })}
              />
            </div>

            <div className="button-group">
              <button
                className="btn btn-primary"
                onClick={handleSpbLogin}
                disabled={isSpbLoggingIn || !spbConfig.phone || !spbConfig.password}
              >
                {isSpbLoggingIn ? '登录中...' : '测试登录'}
              </button>

              {spbConfig.token && (
                <span className="spb-status success">✓ 已登录</span>
              )}
            </div>

            {spbLoginMessage && (
              <p className={`test-result ${spbLoginResult}`}>
                {spbLoginMessage}
              </p>
            )}

            <p className="hint">用于后续直接调用上品帮 API</p>
          </div>
        )}

        {/* 采集参数 */}
        {activeTab === 'collector' && (
          <div className="tab-panel">
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

            <button
              className="btn btn-primary btn-save"
              onClick={handleSave}
              disabled={isSaving}
            >
              {isSaving ? '保存中...' : '保存配置'}
            </button>

            {saveMessage && (
              <p className={`save-message ${saveMessage.includes('失败') ? 'error' : 'success'}`}>
                {saveMessage}
              </p>
            )}
          </div>
        )}

        {/* 数据面板配置 */}
        {activeTab === 'dataPanel' && (
          <div className="tab-panel data-panel-config">
            <p className="hint">选择在商品详情页数据面板中显示的字段</p>

            {/* 字段分组 */}
            {Object.entries(FIELD_GROUPS).map(([groupKey, fields]) => {
              // 分组标题映射
              const groupTitles: Record<string, string> = {
                sales: '销售数据',
                marketing: '营销数据',
                basic: '基础信息',
                competitor: '竞品数据',
                commission: '佣金信息'
              };

              return (
                <div key={groupKey} className="field-group">
                  <h3 className="group-title">{groupTitles[groupKey]}</h3>
                  <div className="field-list">
                    {fields.map((field) => (
                      <label key={field.key} className="field-item">
                        <input
                          type="checkbox"
                          checked={dataPanelConfig.visibleFields.includes(field.key)}
                          onChange={() => handleToggleField(field.key)}
                        />
                        <span className="field-label">{field.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}

            {/* 操作按钮 */}
            <div className="button-group">
              <button
                className="btn btn-secondary"
                onClick={handleResetFields}
              >
                重置为默认
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveDataPanel}
                disabled={isSaving}
              >
                {isSaving ? '保存中...' : '保存配置'}
              </button>
            </div>

            {saveMessage && (
              <p className={`save-message ${saveMessage.includes('失败') ? 'error' : 'success'}`}>
                {saveMessage}
              </p>
            )}

            <p className="hint">
              已选择 {dataPanelConfig.visibleFields.length} 个字段
            </p>
          </div>
        )}
      </div>

      <footer className="popup-footer">
        <p>© 2024 EuraFlow Team</p>
      </footer>
    </div>
  );
}

const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<Popup />);
