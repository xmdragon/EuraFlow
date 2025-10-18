/**
 * 控制面板组件（原生样式版本）
 *
 * 完全对齐原 Tampermonkey 脚本的 UI 设计
 */

import type { DataFusionEngine } from '../fusion/engine';
import type { ProductCollector } from '../collector';
import type { CollectorConfig } from '../../shared/types';
import { getApiConfig, setApiConfig } from '../../shared/storage';

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

  panel.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
      <div style="font-weight: bold; font-size: 16px;">🎯 Ozon选品助手 v1.0</div>
      <div style="display: flex; gap: 8px;">
        <button id="ef-settings-btn" style="background: rgba(255,255,255,0.3); border: none; color: white; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.2s;">⚙️</button>
        <button id="ef-minimize-btn" style="background: rgba(255,255,255,0.3); border: none; color: white; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.2s;">➖</button>
      </div>
    </div>

    <div style="margin-bottom: 12px;">
      <label style="display: block; margin-bottom: 6px; font-size: 13px;">目标采集数量：</label>
      <input
        id="ef-target-count"
        type="number"
        value="${config.targetCount}"
        min="1"
        max="1000"
        style="width: 100%; padding: 8px 12px; border: none; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
      />
    </div>

    <button id="ef-toggle-btn" style="width: 100%; padding: 12px; background: #48bb78; border: none; color: white; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; margin-bottom: 15px; transition: all 0.2s;">
      🚀 开始采集
    </button>

    <div style="margin-bottom: 15px;">
      <div style="background: rgba(255,255,255,0.2); height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 8px;">
        <div id="ef-progress-bar" style="width: 0%; height: 100%; background: linear-gradient(90deg, #48bb78 0%, #38a169 100%); transition: width 0.3s;"></div>
      </div>
      <div id="ef-progress-text" style="text-align: center; font-size: 13px; font-weight: 600;">0%</div>
    </div>

    <div id="ef-status" style="background: rgba(255,255,255,0.2); padding: 10px 12px; border-radius: 6px; font-size: 13px; margin-bottom: 12px; text-align: center;">
      ✨ 就绪，点击开始采集
    </div>

    <div style="background: rgba(255,255,255,0.2); padding: 12px; border-radius: 6px; font-size: 13px;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 6px;">
        <span>已采集：</span>
        <span id="ef-collected" style="font-weight: bold; font-size: 16px;">0</span>
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

      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 6px; color: #333; font-size: 14px; font-weight: 600;">API Key：</label>
        <input
          id="ef-api-key"
          type="password"
          placeholder="your-api-key"
          style="width: 100%; padding: 10px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;"
        />
      </div>

      <div style="margin-bottom: 20px;">
        <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; color: #333;">
          <input id="ef-auto-upload" type="checkbox" style="cursor: pointer; width: 18px; height: 18px;" />
          <span style="font-size: 14px;">自动上传采集结果</span>
        </label>
      </div>

      <button id="ef-save-config-btn" style="width: 100%; padding: 12px; background: #5b9bd5; border: none; color: white; border-radius: 6px; font-size: 15px; font-weight: bold; cursor: pointer; transition: all 0.2s;">
        💾 保存配置
      </button>
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
    const autoUploadInput = document.getElementById('ef-auto-upload') as HTMLInputElement;

    if (apiUrlInput) apiUrlInput.value = apiConfig.apiUrl;
    if (apiKeyInput) apiKeyInput.value = apiConfig.apiKey;
    if (autoUploadInput) autoUploadInput.checked = apiConfig.autoUpload;
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

    // 保存配置
    const saveConfigBtn = document.getElementById('ef-save-config-btn');
    if (saveConfigBtn) {
      saveConfigBtn.onclick = async () => {
        const apiUrlInput = document.getElementById('ef-api-url') as HTMLInputElement;
        const apiKeyInput = document.getElementById('ef-api-key') as HTMLInputElement;
        const autoUploadInput = document.getElementById('ef-auto-upload') as HTMLInputElement;

        await setApiConfig({
          apiUrl: apiUrlInput.value,
          apiKey: apiKeyInput.value,
          autoUpload: autoUploadInput.checked
        });

        updateStatus('✅ 配置已保存');
        apiModal.style.display = 'none';
      };
      saveConfigBtn.onmouseover = () => {
        saveConfigBtn.style.transform = 'scale(1.05)';
        saveConfigBtn.style.boxShadow = '0 4px 12px rgba(91,155,213,0.4)';
      };
      saveConfigBtn.onmouseout = () => {
        saveConfigBtn.style.transform = 'scale(1)';
        saveConfigBtn.style.boxShadow = 'none';
      };
    }
  }

  // 开始采集
  async function startCollection() {
    isCollecting = true;
    const toggleBtn = document.getElementById('ef-toggle-btn');
    if (toggleBtn) {
      toggleBtn.style.background = '#f56565';
      toggleBtn.innerHTML = '⏸️ 停止采集';
    }

    const targetCountInput = document.getElementById('ef-target-count') as HTMLInputElement;
    const targetCount = parseInt(targetCountInput?.value || '100');

    updateStatus(`🚀 开始采集，目标: ${targetCount} 个商品`);

    try {
      await collector.startCollection(targetCount, (progress) => {
        updateProgress(progress.collected, progress.target);
        if (!progress.isRunning) {
          stopCollection();
          updateStatus(`✅ 采集完成！共采集 ${progress.collected} 个商品`);
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
      toggleBtn.innerHTML = '🚀 开始采集';
    }

    if (!collectedCount) {
      updateStatus('⏸️ 采集已停止');
    }
  }

  // 更新状态
  function updateStatus(message: string) {
    const statusDiv = document.getElementById('ef-status');
    if (statusDiv) {
      statusDiv.textContent = message;
    }
  }

  // 更新进度
  function updateProgress(current: number, target: number) {
    const progress = Math.min((current / target) * 100, 100);
    const progressBar = document.getElementById('ef-progress-bar');
    const progressText = document.getElementById('ef-progress-text');
    const collectedSpan = document.getElementById('ef-collected');

    if (progressBar) {
      progressBar.style.width = `${progress}%`;
    }
    if (progressText) {
      progressText.textContent = `${Math.round(progress)}%`;
    }
    if (collectedSpan) {
      collectedSpan.textContent = current.toString();
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
