// ==UserScript==
// @name         Ozon滚动监控器
// @namespace    http://euraflow.local/
// @version      1.0
// @description  监控Ozon页面滚动时HTML结构的变化
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 监控数据
    const monitorData = {
        scrollCount: 0,
        snapshots: [],
        lastSnapshot: null
    };

    // 创建监控面板
    function createMonitorPanel() {
        const panel = document.createElement('div');
        panel.id = 'scroll-monitor-panel';
        panel.innerHTML = `
            <div style="position: fixed; top: 10px; right: 10px; width: 400px; max-height: 80vh;
                        background: rgba(0,0,0,0.9); color: #0f0; padding: 15px;
                        border-radius: 8px; font-family: monospace; font-size: 12px;
                        overflow-y: auto; z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.5);">
                <h3 style="margin: 0 0 10px 0; color: #0f0; border-bottom: 1px solid #0f0; padding-bottom: 5px;">
                    🔍 滚动监控器
                </h3>
                <button id="start-monitor" style="background: #0f0; color: #000; border: none;
                        padding: 5px 10px; cursor: pointer; margin-right: 5px;">开始监控</button>
                <button id="stop-monitor" style="background: #f00; color: #fff; border: none;
                        padding: 5px 10px; cursor: pointer; margin-right: 5px;">停止监控</button>
                <button id="clear-monitor" style="background: #666; color: #fff; border: none;
                        padding: 5px 10px; cursor: pointer; margin-right: 5px;">清空</button>
                <button id="export-monitor" style="background: #00f; color: #fff; border: none;
                        padding: 5px 10px; cursor: pointer;">导出数据</button>
                <div id="monitor-stats" style="margin: 10px 0; padding: 10px; background: rgba(0,255,0,0.1); border: 1px solid #0f0;">
                    <div>滚动次数: <span id="scroll-count">0</span></div>
                    <div>当前位置: <span id="scroll-position">0</span></div>
                    <div>页面高度: <span id="page-height">0</span></div>
                    <div>商品总数: <span id="product-count">0</span></div>
                    <div>注入商品: <span id="injected-count">0</span></div>
                    <div>DOM节点数: <span id="dom-nodes">0</span></div>
                    <div>第一个商品索引: <span id="first-index">-</span></div>
                    <div>最后商品索引: <span id="last-index">-</span></div>
                    <div>可见商品数: <span id="visible-count">0</span></div>
                </div>
                <div id="monitor-log" style="max-height: 400px; overflow-y: auto; border: 1px solid #0f0;
                            padding: 10px; margin-top: 10px; background: rgba(0,0,0,0.5);">
                </div>
            </div>
        `;
        document.body.appendChild(panel);

        // 绑定按钮事件
        document.getElementById('start-monitor').onclick = startMonitoring;
        document.getElementById('stop-monitor').onclick = stopMonitoring;
        document.getElementById('clear-monitor').onclick = clearMonitor;
        document.getElementById('export-monitor').onclick = exportData;
    }

    // 获取页面快照
    function getSnapshot() {
        const snapshot = {
            timestamp: new Date().toISOString(),
            scrollY: window.scrollY,
            scrollHeight: document.body.scrollHeight,
            viewportHeight: window.innerHeight,
            products: {
                tileRoot: document.querySelectorAll('.tile-root').length,
                dataIndex: document.querySelectorAll('[data-index]').length,
                withBang: document.querySelectorAll('[data-ozon-bang="true"]').length,
                tileRootWithBang: document.querySelectorAll('.tile-root[data-ozon-bang="true"]').length,
                dataIndexWithBang: document.querySelectorAll('[data-index][data-ozon-bang="true"]').length
            },
            domNodes: document.querySelectorAll('*').length,
            indices: {
                first: null,
                last: null,
                list: []
            },
            visible: {
                count: 0,
                indices: []
            }
        };

        // 获取所有商品的data-index
        const allProducts = document.querySelectorAll('[data-index], .tile-root');
        const indexSet = new Set();

        allProducts.forEach(el => {
            const index = el.getAttribute('data-index');
            if (index !== null) {
                indexSet.add(parseInt(index));
            }
        });

        const indices = Array.from(indexSet).sort((a, b) => a - b);
        if (indices.length > 0) {
            snapshot.indices.first = indices[0];
            snapshot.indices.last = indices[indices.length - 1];
            snapshot.indices.list = indices;
        }

        // 检查可见商品
        const visibleProducts = [];
        allProducts.forEach(el => {
            const rect = el.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const index = el.getAttribute('data-index');
                if (index !== null) {
                    visibleProducts.push(parseInt(index));
                }
            }
        });

        snapshot.visible.count = visibleProducts.length;
        snapshot.visible.indices = visibleProducts.sort((a, b) => a - b);

        return snapshot;
    }

    // 分析变化
    function analyzeChanges(oldSnapshot, newSnapshot) {
        if (!oldSnapshot) return null;

        const changes = {
            scrollDelta: newSnapshot.scrollY - oldSnapshot.scrollY,
            heightDelta: newSnapshot.scrollHeight - oldSnapshot.scrollHeight,
            productChanges: {},
            domNodesDelta: newSnapshot.domNodes - oldSnapshot.domNodes,
            indicesAdded: [],
            indicesRemoved: []
        };

        // 分析商品数量变化
        for (let key in newSnapshot.products) {
            changes.productChanges[key] = {
                old: oldSnapshot.products[key],
                new: newSnapshot.products[key],
                delta: newSnapshot.products[key] - oldSnapshot.products[key]
            };
        }

        // 分析索引变化
        const oldSet = new Set(oldSnapshot.indices.list);
        const newSet = new Set(newSnapshot.indices.list);

        newSet.forEach(idx => {
            if (!oldSet.has(idx)) {
                changes.indicesAdded.push(idx);
            }
        });

        oldSet.forEach(idx => {
            if (!newSet.has(idx)) {
                changes.indicesRemoved.push(idx);
            }
        });

        return changes;
    }

    // 更新显示
    function updateDisplay(snapshot, changes) {
        document.getElementById('scroll-count').textContent = monitorData.scrollCount;
        document.getElementById('scroll-position').textContent = Math.round(snapshot.scrollY);
        document.getElementById('page-height').textContent = snapshot.scrollHeight;
        document.getElementById('product-count').textContent =
            `tile: ${snapshot.products.tileRoot}, index: ${snapshot.products.dataIndex}`;
        document.getElementById('injected-count').textContent =
            `tile: ${snapshot.products.tileRootWithBang}, index: ${snapshot.products.dataIndexWithBang}`;
        document.getElementById('dom-nodes').textContent = snapshot.domNodes;
        document.getElementById('first-index').textContent = snapshot.indices.first ?? '-';
        document.getElementById('last-index').textContent = snapshot.indices.last ?? '-';
        document.getElementById('visible-count').textContent = snapshot.visible.count;

        // 添加日志
        if (changes) {
            const log = document.getElementById('monitor-log');
            const entry = document.createElement('div');
            entry.style.cssText = 'border-bottom: 1px solid #333; padding: 5px 0; margin-bottom: 5px;';

            let html = `<div style="color: #ff0;">[${new Date().toLocaleTimeString()}] 滚动 #${monitorData.scrollCount}</div>`;
            html += `<div>📍 位置: ${Math.round(snapshot.scrollY)} (Δ${changes.scrollDelta > 0 ? '+' : ''}${Math.round(changes.scrollDelta)})</div>`;
            html += `<div>📏 页面高度: ${snapshot.scrollHeight} (Δ${changes.heightDelta > 0 ? '+' : ''}${changes.heightDelta})</div>`;

            // 商品变化
            let hasProductChanges = false;
            for (let key in changes.productChanges) {
                const change = changes.productChanges[key];
                if (change.delta !== 0) {
                    hasProductChanges = true;
                    const color = change.delta > 0 ? '#0f0' : '#f00';
                    html += `<div style="color: ${color};">📦 ${key}: ${change.old} → ${change.new} (${change.delta > 0 ? '+' : ''}${change.delta})</div>`;
                }
            }

            if (!hasProductChanges) {
                html += `<div style="color: #ff0;">⚠️ 商品数量无变化</div>`;
            }

            // 索引变化
            if (changes.indicesAdded.length > 0) {
                html += `<div style="color: #0f0;">➕ 新增索引: [${changes.indicesAdded.join(', ')}]</div>`;
            }
            if (changes.indicesRemoved.length > 0) {
                html += `<div style="color: #f00;">➖ 移除索引: [${changes.indicesRemoved.join(', ')}]</div>`;
            }

            // DOM节点变化
            if (changes.domNodesDelta !== 0) {
                const color = changes.domNodesDelta > 0 ? '#0f0' : '#f00';
                html += `<div style="color: ${color};">🔢 DOM节点: ${changes.domNodesDelta > 0 ? '+' : ''}${changes.domNodesDelta}</div>`;
            }

            // 检测是否到底
            const isBottom = snapshot.scrollY + window.innerHeight >= snapshot.scrollHeight - 100;
            if (isBottom) {
                html += `<div style="color: #ff0; font-weight: bold;">⬇️ 到达页面底部</div>`;
            }

            // 检测是否卡住
            if (changes.scrollDelta > 0 && changes.heightDelta === 0 && !hasProductChanges) {
                html += `<div style="color: #f00; font-weight: bold;">❌ 可能卡住了：滚动但无新内容</div>`;
            }

            entry.innerHTML = html;
            log.insertBefore(entry, log.firstChild);

            // 限制日志数量
            while (log.children.length > 50) {
                log.removeChild(log.lastChild);
            }
        }
    }

    // 监控滚动
    let monitorInterval = null;
    let isMonitoring = false;

    function startMonitoring() {
        if (isMonitoring) return;

        isMonitoring = true;
        console.log('开始监控滚动...');

        // 初始快照
        monitorData.lastSnapshot = getSnapshot();
        monitorData.snapshots = [monitorData.lastSnapshot];
        updateDisplay(monitorData.lastSnapshot, null);

        // 监听滚动
        window.addEventListener('scroll', handleScroll);

        // 定时检查DOM变化（即使没有滚动）
        monitorInterval = setInterval(() => {
            const snapshot = getSnapshot();
            const changes = analyzeChanges(monitorData.lastSnapshot, snapshot);

            if (changes && (changes.domNodesDelta !== 0 ||
                changes.productChanges.tileRoot?.delta !== 0 ||
                changes.productChanges.dataIndex?.delta !== 0)) {
                console.log('检测到DOM变化（非滚动）', changes);
                monitorData.snapshots.push(snapshot);
                updateDisplay(snapshot, changes);
                monitorData.lastSnapshot = snapshot;
            }
        }, 1000);
    }

    function handleScroll() {
        monitorData.scrollCount++;

        setTimeout(() => {
            const snapshot = getSnapshot();
            const changes = analyzeChanges(monitorData.lastSnapshot, snapshot);

            console.log('滚动快照', snapshot);
            console.log('变化分析', changes);

            monitorData.snapshots.push(snapshot);
            updateDisplay(snapshot, changes);
            monitorData.lastSnapshot = snapshot;
        }, 500); // 等待DOM更新
    }

    function stopMonitoring() {
        isMonitoring = false;
        window.removeEventListener('scroll', handleScroll);

        if (monitorInterval) {
            clearInterval(monitorInterval);
            monitorInterval = null;
        }

        console.log('停止监控');
    }

    function clearMonitor() {
        monitorData.scrollCount = 0;
        monitorData.snapshots = [];
        monitorData.lastSnapshot = null;
        document.getElementById('monitor-log').innerHTML = '';
        console.log('清空监控数据');
    }

    function exportData() {
        const data = {
            ...monitorData,
            exportTime: new Date().toISOString(),
            pageUrl: window.location.href
        };

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ozon_scroll_monitor_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);

        console.log('数据已导出', data);
    }

    // 初始化
    function init() {
        createMonitorPanel();
        console.log('Ozon滚动监控器已加载');
    }

    // 启动
    setTimeout(init, 2000);
})();