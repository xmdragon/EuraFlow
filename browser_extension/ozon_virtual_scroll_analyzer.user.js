// ==UserScript==
// @name         Ozon虚拟滚动深度分析器
// @namespace    http://euraflow.local/
// @version      1.0
// @description  深入分析Ozon虚拟滚动机制
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 数据收集
    const scrollData = {
        visibleRanges: [], // 可见索引范围记录
        allSeenIndices: new Set(), // 所有见过的索引
        scrollPositions: new Map(), // 滚动位置对应的索引范围
        recycledElements: new Map(), // 被重用的元素
        maxSimultaneous: 0 // 同时存在的最大元素数
    };

    // 创建分析面板
    function createAnalysisPanel() {
        const panel = document.createElement('div');
        panel.id = 'virtual-scroll-analyzer';
        panel.style.cssText = `
            position: fixed;
            top: 10px;
            left: 10px;
            width: 500px;
            max-height: 80vh;
            background: rgba(0, 0, 0, 0.95);
            color: #0f0;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            z-index: 2147483647;
            overflow-y: auto;
            box-shadow: 0 4px 12px rgba(0,0,0,0.8);
        `;

        panel.innerHTML = `
            <h3 style="margin: 0 0 10px 0; color: #0f0;">🔬 虚拟滚动分析器</h3>
            <div style="margin-bottom: 10px;">
                <button id="start-analysis" style="background: #0f0; color: #000; padding: 5px 10px; border: none; cursor: pointer; margin-right: 5px;">
                    开始分析
                </button>
                <button id="smooth-scroll" style="background: #00f; color: #fff; padding: 5px 10px; border: none; cursor: pointer; margin-right: 5px;">
                    平滑滚动到底
                </button>
                <button id="export-analysis" style="background: #ff0; color: #000; padding: 5px 10px; border: none; cursor: pointer;">
                    导出数据
                </button>
            </div>
            <div id="analysis-stats" style="padding: 10px; background: rgba(0,255,0,0.1); border: 1px solid #0f0; margin-bottom: 10px;">
                <div>当前滚动位置: <span id="current-scroll">0</span></div>
                <div>页面总高度: <span id="total-height">0</span></div>
                <div>当前可见索引: <span id="visible-indices">-</span></div>
                <div>DOM中tile-root数: <span id="dom-count">0</span></div>
                <div>历史最大tile-root数: <span id="max-count">0</span></div>
                <div>总共见过的索引: <span id="total-indices">0</span></div>
                <div>索引范围: <span id="index-range">-</span></div>
                <div>虚拟滚动窗口大小: <span id="window-size">-</span></div>
            </div>
            <div id="analysis-log" style="max-height: 300px; overflow-y: auto; border: 1px solid #0f0; padding: 10px; background: rgba(0,0,0,0.5);">
            </div>
        `;

        document.body.appendChild(panel);

        // 绑定按钮
        document.getElementById('start-analysis').onclick = startAnalysis;
        document.getElementById('smooth-scroll').onclick = smoothScrollToBottom;
        document.getElementById('export-analysis').onclick = exportAnalysisData;
    }

    // 获取当前可见的索引
    function getCurrentIndices() {
        const indices = new Set();
        const elements = document.querySelectorAll('[data-index]');

        elements.forEach(el => {
            const index = parseInt(el.getAttribute('data-index'));
            if (!isNaN(index)) {
                indices.add(index);
            }
        });

        return Array.from(indices).sort((a, b) => a - b);
    }

    // 分析当前状态
    function analyzeCurrentState() {
        const scrollY = window.scrollY;
        const pageHeight = document.body.scrollHeight;
        const tileRoots = document.querySelectorAll('.tile-root');
        const currentIndices = getCurrentIndices();

        // 记录可见范围
        if (currentIndices.length > 0) {
            const range = {
                scroll: scrollY,
                min: Math.min(...currentIndices),
                max: Math.max(...currentIndices),
                count: currentIndices.length,
                timestamp: Date.now()
            };
            scrollData.visibleRanges.push(range);
            scrollData.scrollPositions.set(Math.round(scrollY / 1000), range);
        }

        // 记录所有见过的索引
        currentIndices.forEach(idx => scrollData.allSeenIndices.add(idx));

        // 更新最大同时存在数
        if (tileRoots.length > scrollData.maxSimultaneous) {
            scrollData.maxSimultaneous = tileRoots.length;
        }

        // 检测元素重用
        tileRoots.forEach(el => {
            const index = el.getAttribute('data-index');
            if (index !== null) {
                const elementId = el.dataset.elementId || Math.random().toString(36);
                el.dataset.elementId = elementId;

                if (!scrollData.recycledElements.has(elementId)) {
                    scrollData.recycledElements.set(elementId, []);
                }
                scrollData.recycledElements.get(elementId).push({
                    index: parseInt(index),
                    scroll: scrollY
                });
            }
        });

        // 更新显示
        updateDisplay(scrollY, pageHeight, tileRoots.length, currentIndices);

        return {
            scrollY,
            pageHeight,
            tileRootCount: tileRoots.length,
            indices: currentIndices
        };
    }

    // 更新显示
    function updateDisplay(scrollY, pageHeight, tileRootCount, indices) {
        document.getElementById('current-scroll').textContent = Math.round(scrollY);
        document.getElementById('total-height').textContent = pageHeight;
        document.getElementById('dom-count').textContent = tileRootCount;
        document.getElementById('max-count').textContent = scrollData.maxSimultaneous;
        document.getElementById('total-indices').textContent = scrollData.allSeenIndices.size;

        if (indices.length > 0) {
            document.getElementById('visible-indices').textContent =
                `[${indices[0]}-${indices[indices.length - 1]}] (${indices.length}个)`;

            const allIndices = Array.from(scrollData.allSeenIndices).sort((a, b) => a - b);
            document.getElementById('index-range').textContent =
                `${Math.min(...allIndices)} - ${Math.max(...allIndices)}`;

            // 计算虚拟滚动窗口大小
            if (scrollData.visibleRanges.length > 10) {
                const recentRanges = scrollData.visibleRanges.slice(-10);
                const avgCount = recentRanges.reduce((sum, r) => sum + r.count, 0) / recentRanges.length;
                document.getElementById('window-size').textContent = `约${Math.round(avgCount)}个元素`;
            }
        } else {
            document.getElementById('visible-indices').textContent = '无';
        }

        // 添加日志
        const log = document.getElementById('analysis-log');
        const logEntry = document.createElement('div');
        logEntry.style.cssText = 'border-bottom: 1px solid #333; padding: 5px 0;';

        const scrollPercent = (scrollY / pageHeight * 100).toFixed(1);
        const recycleInfo = checkRecycling();

        logEntry.innerHTML = `
            <div style="color: #ff0;">[${new Date().toLocaleTimeString()}]</div>
            <div>📍 滚动: ${scrollPercent}% | 索引: ${indices.length > 0 ? `[${indices[0]}-${indices[indices.length - 1]}]` : '无'}</div>
            <div>📦 DOM元素: ${tileRootCount} | 历史最大: ${scrollData.maxSimultaneous}</div>
            ${recycleInfo ? `<div style="color: #0ff;">♻️ ${recycleInfo}</div>` : ''}
        `;

        log.insertBefore(logEntry, log.firstChild);

        // 限制日志数量
        while (log.children.length > 30) {
            log.removeChild(log.lastChild);
        }
    }

    // 检测元素重用情况
    function checkRecycling() {
        let recycledCount = 0;
        scrollData.recycledElements.forEach((uses, elementId) => {
            if (uses.length > 1) {
                recycledCount++;
            }
        });

        if (recycledCount > 0) {
            return `检测到${recycledCount}个元素被重用`;
        }
        return null;
    }

    // 开始分析
    let analysisInterval = null;
    function startAnalysis() {
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
            document.getElementById('start-analysis').textContent = '开始分析';
            return;
        }

        document.getElementById('start-analysis').textContent = '停止分析';

        // 初始分析
        analyzeCurrentState();

        // 定期分析
        analysisInterval = setInterval(() => {
            analyzeCurrentState();
        }, 500);

        // 监听滚动
        window.addEventListener('scroll', handleScroll);
    }

    let scrollTimeout = null;
    function handleScroll() {
        clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            analyzeCurrentState();
        }, 100);
    }

    // 平滑滚动到底部
    async function smoothScrollToBottom() {
        console.log('开始平滑滚动分析...');

        // 先回到顶部
        window.scrollTo(0, 0);
        await sleep(1000);

        // 开始分析
        if (!analysisInterval) {
            startAnalysis();
        }

        const maxScrolls = 500;
        let scrollCount = 0;
        let lastHeight = document.body.scrollHeight;
        let noChangeCount = 0;
        let stuckAtBottom = 0;

        const scrollInterval = setInterval(async () => {
            scrollCount++;
            const currentScroll = window.scrollY;
            const currentHeight = document.body.scrollHeight;
            const viewportHeight = window.innerHeight;

            // 计算目标滚动位置
            let targetScroll;

            // 如果还没到底，继续滚动
            if (currentScroll + viewportHeight < currentHeight - 10) {
                // 每次滚动1.5个视口高度
                targetScroll = Math.min(currentScroll + viewportHeight * 1.5, currentHeight - viewportHeight);
            } else {
                // 已经到底了，尝试滚动到绝对底部触发加载
                targetScroll = currentHeight;
                stuckAtBottom++;
            }

            // 执行滚动
            window.scrollTo(0, targetScroll);

            // 等待页面响应
            await sleep(1500);

            const newHeight = document.body.scrollHeight;
            const state = analyzeCurrentState();

            // 记录关键时刻
            if (scrollCount % 5 === 0 || newHeight !== lastHeight) {
                console.log(`滚动 #${scrollCount}: 位置=${Math.round(state.scrollY)}/${newHeight}, 索引=[${state.indices[0]}-${state.indices[state.indices.length-1]}], 元素=${state.tileRootCount}`);
                }

            // 更新日志显示进度
            const progressPercent = ((currentScroll / currentHeight) * 100).toFixed(1);
            const logEntry = document.getElementById('analysis-log').firstChild;
            if (logEntry) {
                const progressHtml = `<div style="color: #0ff;">📊 进度: ${progressPercent}% | 高度: ${currentHeight}px | 到底: ${stuckAtBottom > 0 ? `是(${stuckAtBottom}次)` : '否'}</div>`;
                if (!logEntry.querySelector('.progress-info')) {
                    const progressDiv = document.createElement('div');
                    progressDiv.className = 'progress-info';
                    progressDiv.innerHTML = progressHtml;
                    logEntry.appendChild(progressDiv);
                } else {
                    logEntry.querySelector('.progress-info').innerHTML = progressHtml;
                }
            }

            // 检查停止条件
            if (newHeight === lastHeight) {
                noChangeCount++;

                // 如果在底部且页面不再增长
                if (stuckAtBottom >= 3 && noChangeCount >= 3) {
                    clearInterval(scrollInterval);
                    console.log(`分析完成: 到达真正底部 (滚动${scrollCount}次, 最终高度${newHeight}px)`);
                    showFinalAnalysis();
                    return;
                }

                // 如果长时间没变化
                if (noChangeCount >= 10) {
                    clearInterval(scrollInterval);
                    console.log(`分析完成: 页面停止响应 (滚动${scrollCount}次)`);
                    showFinalAnalysis();
                    return;
                }
            } else {
                // 页面有新内容
                noChangeCount = 0;
                lastHeight = newHeight;

                // 如果之前卡在底部但现在有新内容，重置计数
                if (stuckAtBottom > 0 && newHeight > lastHeight) {
                    stuckAtBottom = 0;
                    console.log('检测到新内容加载，继续滚动...');
                }
            }

            if (scrollCount >= maxScrolls) {
                clearInterval(scrollInterval);
                console.log(`达到最大滚动次数 ${maxScrolls}`);
                showFinalAnalysis();
            }
        }, 2000); // 每2秒滚动一次
    }

    // 显示最终分析
    function showFinalAnalysis() {
        const allIndices = Array.from(scrollData.allSeenIndices).sort((a, b) => a - b);
        const gaps = [];

        // 查找索引中的间隙
        for (let i = 1; i < allIndices.length; i++) {
            if (allIndices[i] - allIndices[i-1] > 1) {
                gaps.push({
                    start: allIndices[i-1],
                    end: allIndices[i],
                    size: allIndices[i] - allIndices[i-1] - 1
                });
            }
        }

        const analysis = {
            totalIndicesSeen: scrollData.allSeenIndices.size,
            indexRange: {
                min: Math.min(...allIndices),
                max: Math.max(...allIndices)
            },
            maxSimultaneousElements: scrollData.maxSimultaneous,
            virtualWindowSize: scrollData.maxSimultaneous,
            gaps: gaps,
            recycledElements: scrollData.recycledElements.size,
            scrollRanges: scrollData.visibleRanges
        };

        console.log('最终分析结果:', analysis);

        const log = document.getElementById('analysis-log');
        const summary = document.createElement('div');
        summary.style.cssText = 'background: rgba(255,255,0,0.2); padding: 10px; margin-top: 10px; border: 2px solid #ff0;';
        summary.innerHTML = `
            <h4 style="color: #ff0; margin: 0 0 10px 0;">📊 最终分析结果</h4>
            <div>✅ 总共发现 ${analysis.totalIndicesSeen} 个不同索引</div>
            <div>📏 索引范围: ${analysis.indexRange.min} - ${analysis.indexRange.max}</div>
            <div>🪟 虚拟滚动窗口: 约${analysis.virtualWindowSize}个元素</div>
            <div>♻️ 元素重用: ${analysis.recycledElements}个DOM元素被重用</div>
            ${gaps.length > 0 ? `<div>⚠️ 发现${gaps.length}个索引间隙</div>` : '<div>✅ 索引连续无间隙</div>'}
            <div style="margin-top: 10px; color: #0f0;">
                <b>结论:</b> ${analysis.virtualWindowSize < 50 ? '使用虚拟滚动' : '可能未使用虚拟滚动'}
            </div>
        `;
        log.insertBefore(summary, log.firstChild);
    }

    // 导出分析数据
    function exportAnalysisData() {
        const data = {
            ...scrollData,
            allSeenIndices: Array.from(scrollData.allSeenIndices),
            scrollPositions: Array.from(scrollData.scrollPositions.entries()),
            recycledElements: Array.from(scrollData.recycledElements.entries()),
            timestamp: new Date().toISOString(),
            url: window.location.href
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ozon_virtual_scroll_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        console.log('分析数据已导出', data);
    }

    // 辅助函数
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // 添加手动滚动到绝对底部功能
    window.scrollToAbsoluteBottom = function() {
        const interval = setInterval(() => {
            const currentHeight = document.body.scrollHeight;
            window.scrollTo(0, currentHeight);
            console.log(`滚动到 ${window.scrollY}/${currentHeight}`);

            // 检查是否真的到底
            if (window.scrollY + window.innerHeight >= currentHeight - 1) {
                console.log('已到达绝对底部');
                setTimeout(() => {
                    const newHeight = document.body.scrollHeight;
                    if (newHeight === currentHeight) {
                        clearInterval(interval);
                        console.log('确认到达底部，无新内容');
                    } else {
                        console.log(`检测到新内容: ${newHeight - currentHeight}px`);
                    }
                }, 1000);
            }
        }, 1000);

        return interval;
    };

    // 初始化
    setTimeout(() => {
        createAnalysisPanel();
        console.log('Ozon虚拟滚动分析器已加载');
    }, 2000);
})();