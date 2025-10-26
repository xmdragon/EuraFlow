/**
 * 控制面板组件（原生样式版本）
 *
 * 完全对齐原 Tampermonkey 脚本的 UI 设计
 */

import type { DataFusionEngine } from '../fusion/engine';
import type { ProductCollector } from '../collector';
import type { CollectorConfig } from '../../shared/types';
import { getApiConfig, setApiConfig } from '../../shared/storage';
import { ApiClient } from '../../shared/api-client';

interface ControlPanelProps {
  fusionEngine: DataFusionEngine;
  collector: ProductCollector;
  config: CollectorConfig;
}

export function ControlPanel(props: ControlPanelProps) {
  const { collector, config } = props;

  // 创建最小化图标
  const minimizedIcon = document.createElement('div');
  minimizedIcon.id = 'ef-minimized-icon';
  minimizedIcon.style.cssText = `
    position: fixed;
    bottom: 260px;
    right: 45px;
    width: 50px;
    height: 50px;
    background: #5b9bd5;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 2147483647;
    font-size: 24px;
    transition: transform 0.3s;
  `;
  minimizedIcon.innerHTML = '🎯';
  minimizedIcon.onmouseover = () => {
    minimizedIcon.style.transform = 'scale(1.1)';
  };
  minimizedIcon.onmouseout = () => {
    minimizedIcon.style.transform = 'scale(1)';
  };

  // 创建控制面板
  const panel = document.createElement('div');
  panel.id = 'ef-control-panel';
  panel.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #5b9bd5;
    color: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.3);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    font-size: 14px;
    width: 350px;
    display: none;
  `;

  // 获取版本号
  const manifest = chrome.runtime.getManifest();
  const version = manifest.version;

  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div style="font-weight: bold; font-size: 16px;">🎯 Ozon选品助手 v${version}</div>
      <div style="display: flex; gap: 8px;">
        <button id="ef-settings-btn" style="background: rgba(255,255,255,0.3); border: none; color: white; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.2s;">⚙️</button>
        <button id="ef-minimize-btn" style="background: rgba(255,255,255,0.3); border: none; color: white; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.2s;">➖</button>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">
      <label style="font-size: 13px; white-space: nowrap;">数量:</label>
      <input
        id="ef-target-count"
        type="number"
        value="${config.targetCount}"
        min="1"
        max="1000"
        style="width: 4.5em; padding: 6px 8px; border: none; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
      />
      <button id="ef-toggle-btn" style="flex: 1; padding: 10px; background: #48bb78; border: none; color: white; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.2s;">
        🚀 开始
      </button>
    </div>

    <div style="position: relative; background: rgba(255,255,255,0.2); border-radius: 6px; overflow: hidden;">
      <div id="ef-progress-bg" style="position: absolute; top: 0; left: 0; width: 0%; height: 100%; background: linear-gradient(90deg, #48bb78 0%, #38a169 100%); transition: width 0.3s;"></div>
      <div style="position: relative; display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; font-size: 13px;">
        <span id="ef-status-text">✨ 就绪，点击开始采集</span>
        <span id="ef-progress-numbers" style="font-weight: 600;">0 [0%]</span>
      </div>
    </div>
  `;

  // 创建 API 设置模态框
  const apiModal = document.createElement('div');
  apiModal.id = 'ef-api-modal';
  apiModal.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0,0,0,0.5);
    z-index: 2147483647;
    display: none;
    align-items: center;
    justify-content: center;
  `;

  apiModal.innerHTML = `
    <div style="background: white; padding: 24px; border-radius: 8px; width: 400px; max-width: 90%;">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <h3 style="margin: 0; color: #333; font-size: 18px;">⚙️ API 配置</h3>
        <button id="ef-close-modal-btn" style="background: rgba(0,0,0,0.1); border: none; color: #666; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.2s;">✖️</button>
      </div>

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 6px; color: #333; font-size: 14px; font-weight: 600;">API URL：</label>
        <input
          id="ef-api-url"
          type="text"
          placeholder="https://your-api.com/api/ef/v1"
          style="width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
        />
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 6px; color: #333; font-size: 14px; font-weight: 600;">API Key：</label>
        <input
          id="ef-api-key"
          type="password"
          placeholder="your-api-key"
          style="width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
        />
      </div>

      <div style="display: flex; gap: 12px;">
        <button id="ef-test-connection-btn" style="flex: 1; padding: 12px; background: #17a2b8; border: none; color: white; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; transition: all 0.2s;">
          🔍 测试连接
        </button>
        <button id="ef-save-config-btn" disabled style="flex: 1; padding: 12px; background: #ccc; border: none; color: #666; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: not-allowed; transition: all 0.2s;">
          💾 保存配置
        </button>
      </div>
    </div>
  `;

  // 状态变量
  let isCollecting = false;
  let collectedCount = 0;

  // 加载 API 配置
  async function loadAPIConfig() {
    const apiConfig = await getApiConfig();
    const apiUrlInput = document.getElementById('ef-api-url') as HTMLInputElement;
    const apiKeyInput = document.getElementById('ef-api-key') as HTMLInputElement;
    const saveConfigBtn = document.getElementById('ef-save-config-btn') as HTMLButtonElement;

    if (apiUrlInput) apiUrlInput.value = apiConfig.apiUrl;
    if (apiKeyInput) apiKeyInput.value = apiConfig.apiKey;

    // 如果已经有配置，启用保存按钮
    if (saveConfigBtn && apiConfig.apiUrl && apiConfig.apiKey) {
      saveConfigBtn.disabled = false;
      saveConfigBtn.style.background = '#5b9bd5';
      saveConfigBtn.style.color = 'white';
      saveConfigBtn.style.cursor = 'pointer';
    }
  }

  // 绑定事件
  function bindEvents() {
    // 最小化图标点击
    minimizedIcon.onclick = () => {
      panel.style.display = 'block';
      minimizedIcon.style.display = 'none';
    };

    // 最小化按钮
    const minimizeBtn = document.getElementById('ef-minimize-btn');
    if (minimizeBtn) {
      minimizeBtn.onclick = () => {
        panel.style.display = 'none';
        minimizedIcon.style.display = 'flex';
      };
      minimizeBtn.onmouseover = () => {
        minimizeBtn.style.background = 'rgba(255,255,255,0.5)';
        minimizeBtn.style.transform = 'scale(1.1)';
      };
      minimizeBtn.onmouseout = () => {
        minimizeBtn.style.background = 'rgba(255,255,255,0.3)';
        minimizeBtn.style.transform = 'scale(1)';
      };
    }

    // 设置按钮
    const settingsBtn = document.getElementById('ef-settings-btn');
    if (settingsBtn) {
      settingsBtn.onclick = () => {
        apiModal.style.display = 'flex';
        loadAPIConfig();
      };
      settingsBtn.onmouseover = () => {
        settingsBtn.style.background = 'rgba(255,255,255,0.5)';
        settingsBtn.style.transform = 'scale(1.1)';
      };
      settingsBtn.onmouseout = () => {
        settingsBtn.style.background = 'rgba(255,255,255,0.3)';
        settingsBtn.style.transform = 'scale(1)';
      };
    }

    // 开始/停止按钮
    const toggleBtn = document.getElementById('ef-toggle-btn');
    if (toggleBtn) {
      toggleBtn.onclick = () => {
        if (isCollecting) {
          stopCollection();
        } else {
          startCollection();
        }
      };
      toggleBtn.onmouseover = () => {
        toggleBtn.style.transform = 'scale(1.05)';
        toggleBtn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
      };
      toggleBtn.onmouseout = () => {
        toggleBtn.style.transform = 'scale(1)';
        toggleBtn.style.boxShadow = 'none';
      };
    }

    // 关闭模态框
    const closeModalBtn = document.getElementById('ef-close-modal-btn');
    if (closeModalBtn) {
      closeModalBtn.onclick = () => {
        apiModal.style.display = 'none';
      };
      closeModalBtn.onmouseover = () => {
        closeModalBtn.style.background = 'rgba(0,0,0,0.2)';
        closeModalBtn.style.transform = 'scale(1.1)';
      };
      closeModalBtn.onmouseout = () => {
        closeModalBtn.style.background = 'rgba(0,0,0,0.1)';
        closeModalBtn.style.transform = 'scale(1)';
      };
    }

    // 点击模态框外部关闭
    apiModal.onclick = (e) => {
      if (e.target === apiModal) {
        apiModal.style.display = 'none';
      }
    };

    // 测试连接
    const testConnectionBtn = document.getElementById('ef-test-connection-btn');
    if (testConnectionBtn) {
      testConnectionBtn.onclick = async () => {
        const apiUrlInput = document.getElementById('ef-api-url') as HTMLInputElement;
        const apiKeyInput = document.getElementById('ef-api-key') as HTMLInputElement;
        const saveConfigBtn = document.getElementById('ef-save-config-btn') as HTMLButtonElement;

        const apiUrl = apiUrlInput.value.trim();
        const apiKey = apiKeyInput.value.trim();

        if (!apiUrl || !apiKey) {
          updateStatus('⚠️ 请填写 API 地址和 Key');
          return;
        }

        updateStatus('🔍 测试连接中...');
        testConnectionBtn.textContent = '测试中...';
        (testConnectionBtn as HTMLButtonElement).disabled = true;

        try {
          console.log('[ControlPanel] Testing connection...', { apiUrl });
          const response = await chrome.runtime.sendMessage({
            type: 'TEST_CONNECTION',
            data: { apiUrl, apiKey }
          });
          console.log('[ControlPanel] Test response:', response);

          if (response.success) {
            const username = response.data?.username || '未知用户';
            updateStatus(`✅ 连接成功！用户: ${username}`);
            testConnectionBtn.textContent = '✅ 连接成功';
            testConnectionBtn.style.background = '#28a745';

            // 启用保存按钮
            saveConfigBtn.disabled = false;
            saveConfigBtn.style.background = '#5b9bd5';
            saveConfigBtn.style.color = 'white';
            saveConfigBtn.style.cursor = 'pointer';
          } else {
            const errorMsg = response.error || '未知错误';
            console.error('[ControlPanel] Test connection failed:', errorMsg);
            updateStatus(`❌ 连接失败: ${errorMsg}`);
            testConnectionBtn.textContent = '❌ 连接失败';
            testConnectionBtn.style.background = '#dc3545';
            setTimeout(() => {
              testConnectionBtn.textContent = '🔍 测试连接';
              testConnectionBtn.style.background = '#17a2b8';
              (testConnectionBtn as HTMLButtonElement).disabled = false;
            }, 2000);
          }
        } catch (error: any) {
          console.error('[ControlPanel] Test connection exception:', error);
          updateStatus(`❌ 测试失败: ${error.message}`);
          testConnectionBtn.textContent = '❌ 测试失败';
          testConnectionBtn.style.background = '#dc3545';
          setTimeout(() => {
            testConnectionBtn.textContent = '🔍 测试连接';
            testConnectionBtn.style.background = '#17a2b8';
            (testConnectionBtn as HTMLButtonElement).disabled = false;
          }, 2000);
        }
      };
    }

    // 保存配置
    const saveConfigBtn = document.getElementById('ef-save-config-btn');
    if (saveConfigBtn) {
      saveConfigBtn.onclick = async () => {
        const apiUrlInput = document.getElementById('ef-api-url') as HTMLInputElement;
        const apiKeyInput = document.getElementById('ef-api-key') as HTMLInputElement;

        await setApiConfig({
          apiUrl: apiUrlInput.value.trim(),
          apiKey: apiKeyInput.value.trim()
        });

        updateStatus('✅ 配置已保存');
        apiModal.style.display = 'none';
      };
      saveConfigBtn.onmouseover = () => {
        if (!(saveConfigBtn as HTMLButtonElement).disabled) {
          saveConfigBtn.style.transform = 'scale(1.05)';
          saveConfigBtn.style.boxShadow = '0 4px 12px rgba(91,155,213,0.4)';
        }
      };
      saveConfigBtn.onmouseout = () => {
        saveConfigBtn.style.transform = 'scale(1)';
        saveConfigBtn.style.boxShadow = 'none';
      };
    }
  }

  // 开始采集
  async function startCollection() {
    // 【检查API配置】必须先配置API才能采集
    const apiConfig = await getApiConfig();
    if (!apiConfig.apiUrl || !apiConfig.apiKey) {
      updateStatus('⚠️ 请先进行API配置');
      return;
    }

    isCollecting = true;
    const toggleBtn = document.getElementById('ef-toggle-btn');
    if (toggleBtn) {
      toggleBtn.style.background = '#f56565';
      toggleBtn.innerHTML = '⏸️ 停止';
    }

    const targetCountInput = document.getElementById('ef-target-count') as HTMLInputElement;
    const targetCount = parseInt(targetCountInput?.value || '100');

    updateStatus(`🚀 开始采集，目标: ${targetCount} 个商品`);

    try {
      await collector.startCollection(targetCount, async (progress) => {
        updateProgress(progress.collected, progress.target);
        if (!progress.isRunning) {
          stopCollection();
          updateStatus(`✅ 采集完成！共采集 ${progress.collected} 个商品`);

          // 自动上传（如果有 API 配置）
          if (progress.collected > 0) {
            const apiConfig = await getApiConfig();
            if (apiConfig.apiUrl && apiConfig.apiKey) {
              setTimeout(async () => {
                await uploadToAPI();
              }, 1000);
            }
          }
        }
      });
    } catch (error: any) {
      updateStatus(`❌ 采集失败: ${error.message}`);
      stopCollection();
    }
  }

  // 停止采集
  function stopCollection() {
    isCollecting = false;
    collector.stopCollection();

    const toggleBtn = document.getElementById('ef-toggle-btn');
    if (toggleBtn) {
      toggleBtn.style.background = '#48bb78';
      toggleBtn.innerHTML = '🚀 开始';
    }

    if (!collectedCount) {
      updateStatus('⏸️ 采集已停止');
    }
  }

  // 上传到 API
  async function uploadToAPI() {
    try {
      const products = collector.getCollectedProducts();
      if (products.length === 0) {
        updateStatus('⚠️ 没有可上传的商品');
        return;
      }

      const apiConfig = await getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        updateStatus('⚠️ 未配置 API');
        return;
      }

      updateStatus(`📤 正在上传 ${products.length} 个商品...`);

      const apiClient = new ApiClient(apiConfig.apiUrl, apiConfig.apiKey);
      const result = await apiClient.uploadProducts(products);

      updateStatus(`✅ 上传成功！共 ${result.total} 个商品`);
    } catch (error: any) {
      updateStatus(`❌ 上传失败: ${error.message}`);
    }
  }

  // 更新状态
  function updateStatus(message: string) {
    const statusText = document.getElementById('ef-status-text');
    if (statusText) {
      statusText.textContent = message;
    }
  }

  // 更新进度
  function updateProgress(current: number, target: number) {
    const progress = Math.min((current / target) * 100, 100);
    const progressBg = document.getElementById('ef-progress-bg');
    const progressNumbers = document.getElementById('ef-progress-numbers');

    if (progressBg) {
      progressBg.style.width = `${progress}%`;
    }
    if (progressNumbers) {
      progressNumbers.textContent = `${current} [${Math.round(progress)}%]`;
    }

    collectedCount = current;
  }

  // 挂载到 DOM
  document.body.appendChild(minimizedIcon);
  document.body.appendChild(panel);
  document.body.appendChild(apiModal);

  // 绑定事件
  bindEvents();

  // 初始加载配置
  loadAPIConfig();

  console.log('[EuraFlow] Control panel initialized');

  // 返回一个空的 div（React 兼容）
  return document.createElement('div');
}
