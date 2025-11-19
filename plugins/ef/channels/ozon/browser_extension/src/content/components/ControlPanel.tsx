/**
 * 控制面板组件（原生样式版本）
 *
 */

import type { DataFusionEngine } from '../fusion/engine';
import type { ProductCollector } from '../collector';
import type { CollectorConfig } from '../../shared/types';
import { getApiConfig } from '../../shared/storage';
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
        <button id="ef-minimize-btn" style="background: rgba(255,255,255,0.3); border: none; color: white; width: 30px; height: 30px; border-radius: 4px; cursor: pointer; font-size: 16px; transition: all 0.2s;">➖</button>
      </div>
    </div>

    <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px; justify-content: space-between;">
      <div style="display: flex; align-items: center; gap: 8px;">
        <label style="font-size: 13px; white-space: nowrap;">数量:</label>
        <input
          id="ef-target-count"
          type="number"
          value="${config.targetCount || 100}"
          min="1"
          max="1000"
          step="1"
          style="width: 4.5em; padding: 6px 8px; border: none; border-radius: 6px; font-size: 14px; box-sizing: border-box; color: #333 !important; -webkit-text-fill-color: #333 !important; background: white !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;"
        />
      </div>
      <button id="ef-toggle-btn" style="width: 120px; padding: 10px; background: #48bb78; border: none; color: white; border-radius: 6px; font-size: 14px; font-weight: bold; cursor: pointer; transition: all 0.2s;">
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

  // 状态变量
  let isCollecting = false;
  let collectedCount = 0;

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

    // 数量输入框事件处理
    const targetCountInput = document.getElementById('ef-target-count') as HTMLInputElement;
    if (targetCountInput) {
      // 输入时验证和格式化
      targetCountInput.addEventListener('input', () => {
        // 确保是数字类型
        let value = parseInt(targetCountInput.value, 10);

        // 如果不是有效数字，使用默认值
        if (isNaN(value) || value < 1) {
          value = 100;
        }

        // 限制最大值
        if (value > 1000) {
          value = 1000;
        }

        // 更新输入框和存储
        targetCountInput.value = value.toString();
      });

      // 失焦时保存到存储
      targetCountInput.addEventListener('blur', async () => {
        const value = parseInt(targetCountInput.value, 10) || 100;
        await chrome.storage.sync.set({ targetCount: value });
      });
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
    const targetCount = parseInt(targetCountInput?.value || '100', 10) || 100;

    // 获取累计统计
    const stats = collector.getCumulativeStats();
    if (stats.totalUploaded > 0) {
      updateStatus(`🚀 已有 ${stats.totalUploaded} 个，目标: ${targetCount} 个`);
    } else {
      updateStatus(`🚀 开始采集，目标: ${targetCount} 个`);
    }

    try {
      await collector.startCollection(targetCount, async (progress) => {
        updateProgress(progress.collected, progress.target);

        // 实时更新状态文本（显示各阶段进度）
        if (progress.status) {
          updateStatus(progress.status);
        }

        if (!progress.isRunning) {
          stopCollection();
          updateStatus(`✅ 采集完成！共采集 ${progress.collected}`);

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

      // 根据累计统计更新按钮文字
      const stats = collector.getCumulativeStats();
      if (stats.totalUploaded > 0) {
        toggleBtn.innerHTML = `🚀 继续`;
      } else {
        toggleBtn.innerHTML = '🚀 开始';
      }
    }

    if (!collectedCount) {
      updateStatus('⏸️ 采集已停止');
    }
  }

  // 上传到 API
  async function uploadToAPI() {
    try {
      const allProducts = collector.getCollectedProducts();
      if (allProducts.length === 0) {
        updateStatus('⚠️ 没有可上传的商品');
        return;
      }

      const apiConfig = await getApiConfig();
      if (!apiConfig.apiUrl || !apiConfig.apiKey) {
        updateStatus('⚠️ 未配置 API');
        return;
      }

      // 获取目标数量（来自输入框）
      const targetCountInput = document.querySelector('#ef-target-count') as HTMLInputElement;
      const targetCount = targetCountInput ? (parseInt(targetCountInput.value, 10) || 100) : allProducts.length;

      // 精确切片：只上传目标数量的商品
      let toUpload = allProducts.slice(0, targetCount);
      const notUploaded = allProducts.slice(targetCount);

      // 数据验证：过滤掉没有product_id的商品
      const invalidProducts = toUpload.filter(p => !p.product_id);
      if (invalidProducts.length > 0) {
        console.warn(`[ControlPanel] 发现 ${invalidProducts.length} 个商品缺少product_id，已过滤`);
        toUpload = toUpload.filter(p => p.product_id);
      }

      if (toUpload.length === 0) {
        updateStatus('⚠️ 没有有效的商品数据');
        return;
      }

      // 检查数据量限制
      if (toUpload.length > 1000) {
        updateStatus('⚠️ 单次最多上传1000个商品，请分批上传');
        return;
      }

      updateStatus(`📤 正在上传 ${toUpload.length} 个...`);

      const apiClient = new ApiClient(apiConfig.apiUrl, apiConfig.apiKey);
      const result = await apiClient.uploadProducts(toUpload);

      // 更新指纹集：已上传的加入，未上传的移除
      collector.updateFingerprints(
        toUpload.map(p => p.product_id),
        notUploaded.map(p => p.product_id)
      );

      updateStatus(`✅ 本次上传 ${result.total} 个`);

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
      // 获取累计统计
      // const stats = collector.getCumulativeStats();
      // const totalCollected = stats.totalUploaded + current;
      progressNumbers.textContent = `本次: ${current} [${Math.round(progress)}%]`;
    }

    collectedCount = current;
  }

  // 挂载到 DOM
  document.body.appendChild(minimizedIcon);
  document.body.appendChild(panel);

  // 绑定事件
  bindEvents();

  // 初始化时更新累计统计显示
  const stats = collector.getCumulativeStats();
  if (stats.totalUploaded > 0) {
    const toggleBtn = document.getElementById('ef-toggle-btn');
    if (toggleBtn) {
      toggleBtn.innerHTML = `继续`;
    }
    const progressNumbers = document.getElementById('ef-progress-numbers');
    if (progressNumbers) {
      progressNumbers.textContent = `本次: 0 [0%]`;
    }
    updateStatus(`✨ 就绪，可继续采集`);
  }

  // 返回一个空的 div（React 兼容）
  return document.createElement('div');
}
