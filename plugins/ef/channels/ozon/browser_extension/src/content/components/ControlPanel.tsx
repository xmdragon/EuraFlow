import React, { useState, useEffect } from 'react';
import { DataFusionEngine } from '../fusion/engine';
import { ProductCollector } from '../collector';
import type { CollectionProgress, CollectorConfig } from '../../shared/types';
import './ControlPanel.scss';

interface ControlPanelProps {
  fusionEngine: DataFusionEngine;
  collector: ProductCollector;
  config: CollectorConfig;
}

/**
 * 浮动控制面板
 *
 * 显示在 OZON 商品页面上，用于：
 * 1. 显示数据源状态（上品帮/毛子ERP）
 * 2. 显示融合统计
 * 3. 配置采集参数
 * 4. 控制采集流程
 * 5. 显示进度和错误
 */
export const ControlPanel: React.FC<ControlPanelProps> = ({
  fusionEngine,
  collector,
  config
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [targetCount, setTargetCount] = useState(config.targetCount);
  const [progress, setProgress] = useState<CollectionProgress>({
    collected: 0,
    target: 0,
    isRunning: false,
    errors: []
  });

  // 数据源状态
  const [sourceStatus, setSourceStatus] = useState({
    shangpinbang: false,
    maoziErp: false
  });

  // 融合统计
  const [fusionStats, setFusionStats] = useState({
    spbFields: 0,
    mzFields: 0,
    totalFields: 0,
    fusedFields: [] as string[]
  });

  // 检测数据源状态
  useEffect(() => {
    const checkSources = () => {
      setSourceStatus(fusionEngine.getSourceStatus());
    };

    checkSources();
    const interval = setInterval(checkSources, 2000);
    return () => clearInterval(interval);
  }, [fusionEngine]);

  // 更新融合统计（采样第一个商品卡片）
  useEffect(() => {
    const updateStats = async () => {
      const cards = document.querySelectorAll<HTMLElement>(
        '[data-widget="searchResultsV2"] > div, div[class*="tile"]'
      );
      if (cards.length > 0) {
        const firstCard = cards[0];
        if (firstCard.querySelector('a[href*="/product/"]')) {
          try {
            const stats = await fusionEngine.getFusionStats(firstCard);
            setFusionStats(stats);
          } catch (error) {
            console.warn('[ControlPanel] Failed to get fusion stats:', error);
          }
        }
      }
    };

    updateStats();
  }, [fusionEngine, sourceStatus]);

  // 开始采集
  const handleStart = async () => {
    try {
      await collector.startCollection(targetCount, (prog) => {
        setProgress({ ...prog });
      });
    } catch (error: any) {
      console.error('[ControlPanel] Collection failed:', error);
      alert(`采集失败: ${error.message}`);
    }
  };

  // 停止采集
  const handleStop = () => {
    collector.stopCollection();
    setProgress({ ...progress, isRunning: false });
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className={`ef-control-panel ${isMinimized ? 'minimized' : ''}`}>
      {/* 标题栏 */}
      <div className="panel-header">
        <div className="panel-title">
          <span className="title-icon">🛒</span>
          <span className="title-text">EuraFlow 选品助手</span>
        </div>
        <div className="panel-controls">
          <button
            className="btn-minimize"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? '展开' : '最小化'}
          >
            {isMinimized ? '▼' : '▲'}
          </button>
          <button
            className="btn-close"
            onClick={() => setIsVisible(false)}
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 主体内容 */}
      {!isMinimized && (
        <div className="panel-body">
          {/* 数据源状态 */}
          <div className="section source-status">
            <h3 className="section-title">数据源状态</h3>
            <div className="source-list">
              <div className={`source-item ${sourceStatus.shangpinbang ? 'active' : 'inactive'}`}>
                <span className="status-dot"></span>
                <span className="source-name">上品帮</span>
                {sourceStatus.shangpinbang && (
                  <span className="field-count">{fusionStats.spbFields} 字段</span>
                )}
              </div>
              <div className={`source-item ${sourceStatus.maoziErp ? 'active' : 'inactive'}`}>
                <span className="status-dot"></span>
                <span className="source-name">毛子ERP</span>
                {sourceStatus.maoziErp && (
                  <span className="field-count">{fusionStats.mzFields} 字段</span>
                )}
              </div>
            </div>

            {/* 融合统计 */}
            {(sourceStatus.shangpinbang || sourceStatus.maoziErp) && (
              <div className="fusion-stats">
                <div className="stat-item">
                  <span className="stat-label">总字段数:</span>
                  <span className="stat-value">{fusionStats.totalFields}</span>
                </div>
                {fusionStats.fusedFields.length > 0 && (
                  <div className="stat-item">
                    <span className="stat-label">融合字段:</span>
                    <span className="stat-value highlight">
                      {fusionStats.fusedFields.length}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* 警告：无数据源 */}
            {!sourceStatus.shangpinbang && !sourceStatus.maoziErp && (
              <div className="warning-box">
                <span className="warning-icon">⚠️</span>
                <span className="warning-text">
                  未检测到数据源，请先安装上品帮或毛子ERP插件
                </span>
              </div>
            )}
          </div>

          {/* 采集配置 */}
          <div className="section collection-config">
            <h3 className="section-title">采集配置</h3>
            <div className="config-row">
              <label className="config-label">目标数量:</label>
              <input
                type="number"
                className="config-input"
                value={targetCount}
                onChange={(e) => setTargetCount(parseInt(e.target.value) || 100)}
                min={1}
                max={1000}
                disabled={progress.isRunning}
              />
            </div>
          </div>

          {/* 采集控制 */}
          <div className="section collection-control">
            {!progress.isRunning ? (
              <button
                className="btn-primary btn-start"
                onClick={handleStart}
                disabled={!sourceStatus.shangpinbang && !sourceStatus.maoziErp}
              >
                开始采集
              </button>
            ) : (
              <button className="btn-danger btn-stop" onClick={handleStop}>
                停止采集
              </button>
            )}
          </div>

          {/* 进度显示 */}
          {progress.target > 0 && (
            <div className="section progress-section">
              <h3 className="section-title">采集进度</h3>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${(progress.collected / progress.target) * 100}%` }}
                ></div>
              </div>
              <div className="progress-text">
                {progress.collected} / {progress.target}
                {progress.isRunning && <span className="spinner">⏳</span>}
              </div>
            </div>
          )}

          {/* 错误列表 */}
          {progress.errors.length > 0 && (
            <div className="section errors-section">
              <h3 className="section-title">
                错误 ({progress.errors.length})
              </h3>
              <div className="error-list">
                {progress.errors.slice(-5).map((error, index) => (
                  <div key={index} className="error-item">
                    {error}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
