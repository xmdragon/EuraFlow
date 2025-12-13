import { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import {
  getShangpinbangConfig,
  getDataPanelConfig,
  setDataPanelConfig,
  getRateLimitConfig,
  setRateLimitConfig,
  getFilterConfig,
  setFilterConfig,
  clearFilterConfig,
  getAutoCollectConfig,
  setAutoCollectConfig
} from '../shared/storage';
import type { ShangpinbangConfig, DataPanelConfig, RateLimitConfig, FilterConfig, AutoCollectConfig } from '../shared/types';
import { FIELD_GROUPS, DEFAULT_FIELDS } from '../shared/types';
import './popup.scss';

// 自动采集状态类型
interface AutoCollectorState {
  isRunning: boolean;
  currentSource: { source_path: string; display_name: string | null } | null;
  collectedCount: number;
  processedSources: number;
  errors: string[];
}

// 认证信息类型
interface AuthInfo {
  authenticated: boolean;
  username: string | null;
  apiUrl: string | null;
}

function Popup() {
  // 标签页状态
  const [activeTab, setActiveTab] = useState<'auth' | 'autoCollect' | 'filter' | 'rateLimit' | 'dataPanel'>('auth');

  // 认证状态
  const [authInfo, setAuthInfo] = useState<AuthInfo>({
    authenticated: false,
    username: null,
    apiUrl: null
  });

  // 登录表单（服务器地址写死）
  const API_URL = 'http://localhost';
  const [loginForm, setLoginForm] = useState({
    username: '',
    password: ''
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

  // 频率限制配置
  const [rateLimitConfig, setRateLimitConfigState] = useState<RateLimitConfig>({
    mode: 'random',
    fixedDelay: 1000,
    randomDelayMin: 500,
    randomDelayMax: 2000,
    enabled: true
  });

  // 采集过滤配置
  const [filterConfig, setFilterConfigState] = useState<FilterConfig>({
    priceMin: undefined,
    priceMax: undefined,
    monthlySalesMin: undefined,
    weightMax: undefined,
    listingDateAfter: undefined,
    sellerMode: 'ALL',
    followSellerMax: undefined
  });

  // 自动采集配置
  const [autoCollectConfig, setAutoCollectConfigState] = useState<AutoCollectConfig>({
    enabled: false,
    intervalMinutes: 30,
    maxConcurrentTabs: 1,
    productsPerSource: 100,
    autoUpload: true,
    closeTabAfterCollect: true,
    collectionTimeoutMinutes: 10
  });

  // 自动采集器状态
  const [autoCollectorState, setAutoCollectorState] = useState<AutoCollectorState>({
    isRunning: false,
    currentSource: null,
    collectedCount: 0,
    processedSources: 0,
    errors: []
  });

  // UI状态
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');

  // 上品帮登录状态
  const [isSpbLoggingIn, setIsSpbLoggingIn] = useState(false);
  const [spbLoginResult, setSpbLoginResult] = useState<'success' | 'error' | null>(null);
  const [spbLoginMessage, setSpbLoginMessage] = useState('');

  // 加载配置
  useEffect(() => {
    const loadConfig = async () => {
      // 加载认证信息
      const authResponse = await chrome.runtime.sendMessage({ type: 'GET_AUTH_INFO' });
      if (authResponse.success) {
        setAuthInfo(authResponse.data);
      }

      const spb = await getShangpinbangConfig();
      const dataPanel = await getDataPanelConfig();
      const rateLimit = await getRateLimitConfig();
      const filter = await getFilterConfig();
      const autoCollect = await getAutoCollectConfig();
      setSpbConfig(spb);
      setDataPanelConfigState(dataPanel);
      setRateLimitConfigState(rateLimit);
      setFilterConfigState(filter);
      setAutoCollectConfigState(autoCollect);
    };
    loadConfig();
  }, []);

  // 轮询自动采集状态
  useEffect(() => {
    const pollStatus = async () => {
      try {
        const response = await chrome.runtime.sendMessage({ type: 'AUTO_COLLECTOR_STATUS' });
        if (response.success) {
          setAutoCollectorState(response.data);
        }
      } catch (error) {
        // 忽略错误
      }
    };

    // 首次加载
    pollStatus();

    // 每2秒轮询一次
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, []);

  // 登录处理
  const handleLogin = async () => {
    if (!loginForm.username || !loginForm.password) {
      setLoginError('请填写用户名和密码');
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'EURAFLOW_LOGIN',
        data: {
          apiUrl: API_URL,
          username: loginForm.username,
          password: loginForm.password
        }
      });

      if (response.success) {
        // 更新认证状态
        setAuthInfo({
          authenticated: true,
          username: loginForm.username,
          apiUrl: API_URL
        });
        // 清空密码
        setLoginForm(prev => ({ ...prev, password: '' }));
      } else {
        setLoginError(response.error || '登录失败');
      }
    } catch (error: any) {
      setLoginError(error.message || '登录失败');
    } finally {
      setIsLoggingIn(false);
    }
  };

  // 登出处理
  const handleLogout = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'EURAFLOW_LOGOUT' });
      setAuthInfo({
        authenticated: false,
        username: null,
        apiUrl: null
      });
    } catch (error: any) {
      console.error('登出失败:', error);
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

  // 频率限制：保存配置
  const handleSaveRateLimit = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      await setRateLimitConfig(rateLimitConfig);
      setSaveMessage('配置已保存');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 采集过滤：处理配置变更
  const handleFilterChange = (field: keyof FilterConfig, value: string) => {
    let parsedValue: any;

    if (field === 'sellerMode') {
      parsedValue = value as 'ALL' | 'FBS' | 'FBO';
    } else if (field === 'listingDateAfter') {
      parsedValue = value || undefined;
    } else {
      // 数字类型字段
      parsedValue = value === '' ? undefined : parseFloat(value);
      if (parsedValue !== undefined && isNaN(parsedValue)) {
        parsedValue = undefined;
      }
    }

    setFilterConfigState(prev => ({
      ...prev,
      [field]: parsedValue
    }));
  };

  // 采集过滤：保存配置
  const handleSaveFilter = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      await setFilterConfig(filterConfig);
      setSaveMessage('配置已保存');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 采集过滤：重置配置
  const handleResetFilter = async () => {
    await clearFilterConfig();
    setFilterConfigState({
      priceMin: undefined,
      priceMax: undefined,
      monthlySalesMin: undefined,
      weightMax: undefined,
      listingDateAfter: undefined,
      sellerMode: 'ALL',
      followSellerMax: undefined
    });
    setSaveMessage('已重置');
    setTimeout(() => setSaveMessage(''), 3000);
  };

  // 检查是否有任何过滤条件
  const hasAnyFilter = (config: FilterConfig): boolean => {
    return (
      config.priceMin !== undefined ||
      config.priceMax !== undefined ||
      config.monthlySalesMin !== undefined ||
      config.weightMax !== undefined ||
      config.listingDateAfter !== undefined ||
      (config.sellerMode !== undefined && config.sellerMode !== 'ALL') ||
      config.followSellerMax !== undefined
    );
  };

  // 自动采集：保存配置
  const handleSaveAutoCollect = async () => {
    setIsSaving(true);
    setSaveMessage('');

    try {
      await setAutoCollectConfig(autoCollectConfig);
      setSaveMessage('配置已保存');
      setTimeout(() => setSaveMessage(''), 3000);
    } catch (error) {
      setSaveMessage('保存失败');
    } finally {
      setIsSaving(false);
    }
  };

  // 自动采集：启动
  const handleStartAutoCollect = async () => {
    try {
      // 先保存配置
      await setAutoCollectConfig(autoCollectConfig);

      const response = await chrome.runtime.sendMessage({
        type: 'AUTO_COLLECTOR_START',
        data: autoCollectConfig
      });

      if (response.success) {
        setSaveMessage('自动采集已启动');
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage('启动失败: ' + (response.error || '未知错误'));
      }
    } catch (error: any) {
      setSaveMessage('启动失败: ' + error.message);
    }
  };

  // 自动采集：停止
  const handleStopAutoCollect = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'AUTO_COLLECTOR_STOP' });

      if (response.success) {
        setSaveMessage('自动采集已停止');
        setTimeout(() => setSaveMessage(''), 3000);
      } else {
        setSaveMessage('停止失败: ' + (response.error || '未知错误'));
      }
    } catch (error: any) {
      setSaveMessage('停止失败: ' + error.message);
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
          className={`tab-button ${activeTab === 'auth' ? 'active' : ''}`}
          onClick={() => setActiveTab('auth')}
        >
          {authInfo.authenticated ? '已登录' : '登录'}
        </button>
        <button
          className={`tab-button ${activeTab === 'autoCollect' ? 'active' : ''} ${autoCollectorState.isRunning ? 'running' : ''}`}
          onClick={() => setActiveTab('autoCollect')}
        >
          自动采集{autoCollectorState.isRunning ? ' ●' : ''}
        </button>
        <button
          className={`tab-button ${activeTab === 'filter' ? 'active' : ''}`}
          onClick={() => setActiveTab('filter')}
        >
          采集过滤
        </button>
        <button
          className={`tab-button ${activeTab === 'rateLimit' ? 'active' : ''}`}
          onClick={() => setActiveTab('rateLimit')}
        >
          频率限制
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
        {/* 登录/账户标签页 */}
        {activeTab === 'auth' && (
          <div className="tab-panel">
            {/* EuraFlow 登录 */}
            <h3 className="section-title">EuraFlow 账户</h3>

            {authInfo.authenticated ? (
              // 已登录状态
              <div className="auth-status">
                <div className="auth-info">
                  <p className="auth-user">
                    <span className="auth-icon">✓</span>
                    已登录: <strong>{authInfo.username}</strong>
                  </p>
                  <p className="auth-server">{authInfo.apiUrl}</p>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={handleLogout}
                >
                  退出登录
                </button>
              </div>
            ) : (
              // 登录表单
              <>
                <div className="form-group">
                  <label className="form-label">用户名:</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="输入用户名"
                    value={loginForm.username}
                    onChange={(e) => setLoginForm({ ...loginForm, username: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">密码:</label>
                  <input
                    type="password"
                    className="form-input"
                    placeholder="输入密码"
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                  />
                </div>

                <div className="button-group">
                  <button
                    className="btn btn-primary"
                    onClick={handleLogin}
                    disabled={isLoggingIn || !loginForm.username || !loginForm.password}
                  >
                    {isLoggingIn ? '登录中...' : '登录'}
                  </button>
                </div>

                {loginError && (
                  <p className="test-result error">✗ {loginError}</p>
                )}
              </>
            )}

            {/* 上品帮配置 */}
            <div className="section-divider"></div>
            <h3 className="section-title">上品帮账号</h3>

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
                className="btn btn-secondary"
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

            {saveMessage && (
              <p className={`save-message ${saveMessage.includes('失败') ? 'error' : 'success'}`}>
                {saveMessage}
              </p>
            )}
          </div>
        )}

        {/* 自动采集 */}
        {activeTab === 'autoCollect' && (
          <div className="tab-panel auto-collect-config">
            {/* 运行状态 */}
            {autoCollectorState.isRunning && (
              <div className="status-card running">
                <h4>● 采集中...</h4>
                <div className="status-info">
                  <p>当前地址: {autoCollectorState.currentSource?.display_name || autoCollectorState.currentSource?.source_path || '准备中...'}</p>
                  <p>已采集: {autoCollectorState.collectedCount} 个商品</p>
                  <p>已处理: {autoCollectorState.processedSources} 个地址</p>
                </div>
                {autoCollectorState.errors.length > 0 && (
                  <div className="status-errors">
                    <p className="error-title">最近错误:</p>
                    <ul>
                      {autoCollectorState.errors.slice(-3).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!autoCollectorState.isRunning && (
              <div className="status-card idle">
                <h4>○ 未运行</h4>
                <p className="hint">配置参数后点击"启动采集"开始自动采集</p>
              </div>
            )}

            {/* 配置项 */}
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoCollectConfig.enabled}
                  onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, enabled: e.target.checked })}
                  disabled={autoCollectorState.isRunning}
                />
                <span>启用自动采集</span>
              </label>
              <p className="hint">启用后，插件会按配置自动执行采集任务</p>
            </div>

            <div className="form-group">
              <label className="form-label">并发标签页数:</label>
              <select
                className="form-input"
                value={autoCollectConfig.maxConcurrentTabs}
                onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, maxConcurrentTabs: parseInt(e.target.value) || 1 })}
                disabled={autoCollectorState.isRunning}
              >
                <option value={1}>1 个标签页</option>
                <option value={2}>2 个标签页</option>
                <option value={3}>3 个标签页</option>
                <option value={4}>4 个标签页</option>
                <option value={5}>5 个标签页</option>
              </select>
              <p className="hint">同时打开的采集标签页数量，越多越快但风险越高</p>
            </div>

            <div className="form-group">
              <label className="form-label">采集间隔 (分钟):</label>
              <input
                type="number"
                className="form-input"
                min="5"
                max="1440"
                value={autoCollectConfig.intervalMinutes}
                onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, intervalMinutes: parseInt(e.target.value) || 30 })}
                disabled={autoCollectorState.isRunning}
              />
              <p className="hint">每个采集地址的采集间隔时间</p>
            </div>

            <div className="form-group">
              <label className="form-label">每地址目标数量:</label>
              <input
                type="number"
                className="form-input"
                min="10"
                max="1000"
                value={autoCollectConfig.productsPerSource}
                onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, productsPerSource: parseInt(e.target.value) || 100 })}
                disabled={autoCollectorState.isRunning}
              />
              <p className="hint">每个采集地址的目标商品数量</p>
            </div>

            <div className="form-group">
              <label className="form-label">采集超时 (分钟):</label>
              <input
                type="number"
                className="form-input"
                min="1"
                max="60"
                value={autoCollectConfig.collectionTimeoutMinutes}
                onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, collectionTimeoutMinutes: parseInt(e.target.value) || 10 })}
                disabled={autoCollectorState.isRunning}
              />
              <p className="hint">单个地址采集的超时时间，超时后跳过</p>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoCollectConfig.autoUpload}
                  onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, autoUpload: e.target.checked })}
                  disabled={autoCollectorState.isRunning}
                />
                <span>采集后自动上传</span>
              </label>
            </div>

            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={autoCollectConfig.closeTabAfterCollect}
                  onChange={(e) => setAutoCollectConfigState({ ...autoCollectConfig, closeTabAfterCollect: e.target.checked })}
                  disabled={autoCollectorState.isRunning}
                />
                <span>采集后关闭标签页</span>
              </label>
            </div>

            {/* 操作按钮 */}
            <div className="button-group">
              {!autoCollectorState.isRunning ? (
                <>
                  <button
                    className="btn btn-secondary"
                    onClick={handleSaveAutoCollect}
                    disabled={isSaving}
                  >
                    {isSaving ? '保存中...' : '保存配置'}
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleStartAutoCollect}
                    disabled={!authInfo.authenticated}
                  >
                    启动采集
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-danger"
                  onClick={handleStopAutoCollect}
                >
                  停止采集
                </button>
              )}
            </div>

            {!authInfo.authenticated ? (
              <p className="hint warning">请先在"登录"中登录 EuraFlow 账户</p>
            ) : null}

            {saveMessage && (
              <p className={`save-message ${saveMessage.includes('失败') ? 'error' : 'success'}`}>
                {saveMessage}
              </p>
            )}

            <p className="hint">
              采集地址需要在 EuraFlow 后台的"采集地址管理"中配置
            </p>
          </div>
        )}

        {/* 采集过滤配置 */}
        {activeTab === 'filter' && (
          <div className="tab-panel filter-config">
            <p className="hint">设置采集过滤条件，空值表示不过滤该条件</p>

            {/* 价格区间 */}
            <div className="form-group">
              <label className="form-label">价格区间 (¥):</label>
              <div className="input-range">
                <input
                  type="number"
                  className="form-input"
                  placeholder="最低价"
                  min="0"
                  value={filterConfig.priceMin ?? ''}
                  onChange={(e) => handleFilterChange('priceMin', e.target.value)}
                />
                <span className="range-separator">-</span>
                <input
                  type="number"
                  className="form-input"
                  placeholder="最高价"
                  min="0"
                  value={filterConfig.priceMax ?? ''}
                  onChange={(e) => handleFilterChange('priceMax', e.target.value)}
                />
              </div>
            </div>

            {/* 月销量 */}
            <div className="form-group">
              <label className="form-label">月销量 &gt;=</label>
              <input
                type="number"
                className="form-input"
                placeholder="如：100"
                min="0"
                value={filterConfig.monthlySalesMin ?? ''}
                onChange={(e) => handleFilterChange('monthlySalesMin', e.target.value)}
              />
            </div>

            {/* 跟卖数量 */}
            <div className="form-group">
              <label className="form-label">跟卖数量 &lt;=</label>
              <input
                type="number"
                className="form-input"
                placeholder="如：5"
                min="0"
                value={filterConfig.followSellerMax ?? ''}
                onChange={(e) => handleFilterChange('followSellerMax', e.target.value)}
              />
            </div>

            {/* 发货模式 */}
            <div className="form-group">
              <label className="form-label">发货模式:</label>
              <select
                className="form-input"
                value={filterConfig.sellerMode ?? 'ALL'}
                onChange={(e) => handleFilterChange('sellerMode', e.target.value)}
              >
                <option value="ALL">全部</option>
                <option value="FBS">仅 FBS</option>
                <option value="FBO">仅 FBO</option>
              </select>
            </div>

            {/* 重量 */}
            <div className="form-group">
              <label className="form-label">重量 &lt;= (克):</label>
              <input
                type="number"
                className="form-input"
                placeholder="如：500"
                min="0"
                value={filterConfig.weightMax ?? ''}
                onChange={(e) => handleFilterChange('weightMax', e.target.value)}
              />
            </div>

            {/* 上架时间 */}
            <div className="form-group">
              <label className="form-label">上架时间晚于:</label>
              <input
                type="date"
                className="form-input"
                value={filterConfig.listingDateAfter ?? ''}
                onChange={(e) => handleFilterChange('listingDateAfter', e.target.value)}
              />
            </div>

            {/* 操作按钮 */}
            <div className="button-group">
              <button className="btn btn-secondary" onClick={handleResetFilter}>
                重置
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSaveFilter}
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

            {/* 当前过滤条件摘要 */}
            <div className="filter-summary">
              <h4>当前生效条件:</h4>
              <ul>
                {filterConfig.priceMin !== undefined && (
                  <li>价格 &gt;= {filterConfig.priceMin}¥</li>
                )}
                {filterConfig.priceMax !== undefined && (
                  <li>价格 &lt;= {filterConfig.priceMax}¥</li>
                )}
                {filterConfig.monthlySalesMin !== undefined && (
                  <li>月销量 &gt;= {filterConfig.monthlySalesMin}</li>
                )}
                {filterConfig.followSellerMax !== undefined && (
                  <li>跟卖数 &lt;= {filterConfig.followSellerMax}</li>
                )}
                {filterConfig.sellerMode && filterConfig.sellerMode !== 'ALL' && (
                  <li>模式: {filterConfig.sellerMode}</li>
                )}
                {filterConfig.weightMax !== undefined && (
                  <li>重量 &lt;= {filterConfig.weightMax}g</li>
                )}
                {filterConfig.listingDateAfter && (
                  <li>上架 &gt; {filterConfig.listingDateAfter}</li>
                )}
                {!hasAnyFilter(filterConfig) && (
                  <li className="no-filter">无过滤条件（采集全部商品）</li>
                )}
              </ul>
            </div>
          </div>
        )}

        {/* 频率限制配置 */}
        {activeTab === 'rateLimit' && (
          <div className="tab-panel">
            <p className="hint">设置OZON API请求频率，避免触发限流（仅限制*.ozon.ru域名）</p>

            {/* 启用/禁用 */}
            <div className="form-group">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={rateLimitConfig.enabled}
                  onChange={(e) => setRateLimitConfigState({ ...rateLimitConfig, enabled: e.target.checked })}
                />
                <span>启用频率限制</span>
              </label>
            </div>

            {/* 频率模式 */}
            <div className="form-group">
              <label className="form-label">频率模式:</label>
              <select
                className="form-input"
                value={rateLimitConfig.mode}
                onChange={(e) => setRateLimitConfigState({ ...rateLimitConfig, mode: e.target.value as 'fixed' | 'random' })}
                disabled={!rateLimitConfig.enabled}
              >
                <option value="fixed">固定频率</option>
                <option value="random">随机频率</option>
              </select>
            </div>

            {/* 固定频率配置 */}
            {rateLimitConfig.mode === 'fixed' && (
              <div className="form-group">
                <label className="form-label">固定延迟时间 (毫秒):</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  step="100"
                  value={rateLimitConfig.fixedDelay}
                  onChange={(e) => setRateLimitConfigState({ ...rateLimitConfig, fixedDelay: parseInt(e.target.value) || 0 })}
                  disabled={!rateLimitConfig.enabled}
                />
                <p className="hint">每次请求间隔 {rateLimitConfig.fixedDelay}ms（{(rateLimitConfig.fixedDelay / 1000).toFixed(1)}秒）</p>
              </div>
            )}

            {/* 随机频率配置 */}
            {rateLimitConfig.mode === 'random' && (
              <>
                <div className="form-group">
                  <label className="form-label">最小延迟时间 (毫秒):</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    step="100"
                    value={rateLimitConfig.randomDelayMin}
                    onChange={(e) => setRateLimitConfigState({ ...rateLimitConfig, randomDelayMin: parseInt(e.target.value) || 0 })}
                    disabled={!rateLimitConfig.enabled}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">最大延迟时间 (毫秒):</label>
                  <input
                    type="number"
                    className="form-input"
                    min="0"
                    step="100"
                    value={rateLimitConfig.randomDelayMax}
                    onChange={(e) => setRateLimitConfigState({ ...rateLimitConfig, randomDelayMax: parseInt(e.target.value) || 0 })}
                    disabled={!rateLimitConfig.enabled}
                  />
                </div>

                <p className="hint">
                  随机延迟范围：{rateLimitConfig.randomDelayMin}ms - {rateLimitConfig.randomDelayMax}ms
                  （{(rateLimitConfig.randomDelayMin / 1000).toFixed(1)}秒 - {(rateLimitConfig.randomDelayMax / 1000).toFixed(1)}秒）
                </p>
              </>
            )}

            {/* 保存按钮 */}
            <div className="button-group">
              <button
                className="btn btn-primary"
                onClick={handleSaveRateLimit}
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

              // 佣金信息使用两列布局
              if (groupKey === 'commission') {
                const rfbsFields = fields.filter(f => f.key.startsWith('rfbs'));
                const fbpFields = fields.filter(f => f.key.startsWith('fbp'));

                return (
                  <div key={groupKey} className="field-group">
                    <h3 className="group-title">{groupTitles[groupKey]}</h3>
                    <div className="field-list-two-columns">
                      <div className="field-column">
                        <div className="column-title">rFBS 佣金</div>
                        {rfbsFields.map((field) => (
                          <label key={field.key} className="field-item">
                            <input
                              type="checkbox"
                              checked={dataPanelConfig.visibleFields.includes(field.key)}
                              onChange={() => handleToggleField(field.key)}
                            />
                            <span className="field-label">{field.label.replace('rFBS ', '')}</span>
                          </label>
                        ))}
                      </div>
                      <div className="field-column">
                        <div className="column-title">FBP 佣金</div>
                        {fbpFields.map((field) => (
                          <label key={field.key} className="field-item">
                            <input
                              type="checkbox"
                              checked={dataPanelConfig.visibleFields.includes(field.key)}
                              onChange={() => handleToggleField(field.key)}
                            />
                            <span className="field-label">{field.label.replace('FBP ', '')}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              }

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
