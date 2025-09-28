// ==UserScript==
// @name         Ozon页面诊断工具
// @namespace    http://euraflow.local/
// @version      1.0
// @description  诊断Ozon页面商品容器结构
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 创建诊断面板
    function createPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 500px;
            background: #000;
            color: #0f0;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            z-index: 2147483647;
            box-shadow: 0 4px 12px rgba(0,0,0,0.8);
            max-height: 70vh;
            overflow-y: auto;
        `;

        panel.innerHTML = `
            <h3 style="margin: 0 0 10px 0; color: #0f0;">🔬 页面诊断</h3>
            <button id="diagnose-btn" style="background: #0f0; color: #000; padding: 5px 10px; border: none; cursor: pointer; margin-bottom: 10px;">
                立即诊断
            </button>
            <button id="auto-scroll-btn" style="background: #00f; color: #fff; padding: 5px 10px; border: none; cursor: pointer; margin-bottom: 10px; margin-left: 5px;">
                自动滚动测试
            </button>
            <div id="diagnostic-result"></div>
        `;

        document.body.appendChild(panel);

        document.getElementById('diagnose-btn').onclick = runDiagnostic;
        document.getElementById('auto-scroll-btn').onclick = autoScrollTest;
    }

    // 运行诊断
    function runDiagnostic() {
        const result = document.getElementById('diagnostic-result');
        let html = '<h4>诊断结果：</h4>';

        // 1. 查找所有可能的商品容器
        const selectors = {
            'div[data-widget="searchResultsV2"] > div > div': document.querySelectorAll('div[data-widget="searchResultsV2"] > div > div'),
            'div[data-widget="searchResultsV2"] .tile-root': document.querySelectorAll('div[data-widget="searchResultsV2"] .tile-root'),
            '.tile-root': document.querySelectorAll('.tile-root'),
            '[data-index]': document.querySelectorAll('[data-index]'),
            'div[style*="grid-column"]': document.querySelectorAll('div[style*="grid-column"]'),
            'a[href*="/product/"]': document.querySelectorAll('a[href*="/product/"]'),
            '[data-widget="searchResultsV2"] [style*="display: contents"]': document.querySelectorAll('[data-widget="searchResultsV2"] [style*="display: contents"]'),
            'div[class*="widget-search-result"]': document.querySelectorAll('div[class*="widget-search-result"]')
        };

        html += '<div style="margin: 10px 0;"><b>选择器匹配统计：</b></div>';
        for (let selector in selectors) {
            const count = selectors[selector].length;
            const color = count > 0 ? '#0f0' : '#666';
            html += `<div style="color: ${color};">✓ ${selector}: <b>${count}</b></div>`;
        }

        // 2. 分析data-index的实际情况
        html += '<div style="margin: 10px 0;"><b>data-index分析：</b></div>';
        const indexElements = document.querySelectorAll('[data-index]');
        const indexValues = new Set();
        const indexTypes = new Map();

        indexElements.forEach(el => {
            const index = el.getAttribute('data-index');
            const tagName = el.tagName.toLowerCase();
            const className = el.className;

            indexValues.add(index);

            const key = `${tagName}.${className.split(' ')[0] || 'no-class'}`;
            indexTypes.set(key, (indexTypes.get(key) || 0) + 1);
        });

        html += `<div>不同索引值数量: <b>${indexValues.size}</b></div>`;
        html += `<div>索引范围: <b>${Math.min(...indexValues)} - ${Math.max(...indexValues)}</b></div>`;

        html += '<div style="margin-top: 5px;">元素类型分布:</div>';
        indexTypes.forEach((count, type) => {
            html += `<div style="margin-left: 10px;">- ${type}: ${count}</div>`;
        });

        // 3. 查找商品网格容器
        html += '<div style="margin: 10px 0;"><b>商品网格分析：</b></div>';
        const gridContainers = document.querySelectorAll('[style*="display: grid"], [style*="display:grid"]');
        let mainGrid = null;
        let maxChildren = 0;

        gridContainers.forEach(grid => {
            const children = grid.children.length;
            if (children > maxChildren) {
                maxChildren = children;
                mainGrid = grid;
            }
        });

        if (mainGrid) {
            html += `<div>找到主网格容器: ${mainGrid.className || mainGrid.tagName}</div>`;
            html += `<div>直接子元素数: <b>${mainGrid.children.length}</b></div>`;

            // 分析子元素
            const childTypes = new Map();
            Array.from(mainGrid.children).forEach(child => {
                const key = child.className ? child.className.split(' ')[0] : child.tagName;
                childTypes.set(key, (childTypes.get(key) || 0) + 1);
            });

            html += '<div>子元素类型:</div>';
            childTypes.forEach((count, type) => {
                html += `<div style="margin-left: 10px;">- ${type}: ${count}</div>`;
            });
        }

        // 4. 上品帮注入检测
        html += '<div style="margin: 10px 0;"><b>上品帮注入状态：</b></div>';
        const bangElements = document.querySelectorAll('[data-ozon-bang="true"]');
        html += `<div>已注入元素: <b>${bangElements.length}</b></div>`;

        const bangTypes = new Map();
        bangElements.forEach(el => {
            const key = el.className ? el.className.split(' ')[0] : el.tagName;
            bangTypes.set(key, (bangTypes.get(key) || 0) + 1);
        });

        bangTypes.forEach((count, type) => {
            html += `<div style="margin-left: 10px;">- ${type}: ${count}</div>`;
        });

        // 5. 分页或加载更多按钮
        html += '<div style="margin: 10px 0;"><b>加载控制：</b></div>';
        const loadMoreSelectors = [
            '[data-widget="paginator"]',
            'button[class*="show-more"]',
            'a[href*="?page="]',
            '[data-widget="webPaginator"]',
            '.pagination'
        ];

        loadMoreSelectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
                html += `<div style="color: #0f0;">✓ 找到: ${selector} (${elements.length}个)</div>`;
            }
        });

        // 6. 视口分析
        html += '<div style="margin: 10px 0;"><b>视口信息：</b></div>';
        html += `<div>页面高度: ${document.body.scrollHeight}px</div>`;
        html += `<div>视口高度: ${window.innerHeight}px</div>`;
        html += `<div>当前滚动: ${window.scrollY}px</div>`;
        html += `<div>剩余高度: ${document.body.scrollHeight - window.scrollY - window.innerHeight}px</div>`;

        result.innerHTML = html;
    }

    // 自动滚动测试
    async function autoScrollTest() {
        const result = document.getElementById('diagnostic-result');
        result.innerHTML = '<h4>自动滚动测试中...</h4>';

        let scrollCount = 0;
        let lastHeight = document.body.scrollHeight;
        let noChangeCount = 0;
        const maxScrolls = 100;  // 增加到100次滚动

        const interval = setInterval(() => {
            scrollCount++;

            // 滚动更多距离
            window.scrollBy(0, window.innerHeight * 1.5);

            setTimeout(() => {
                const newHeight = document.body.scrollHeight;
                const productCount = document.querySelectorAll('.tile-root').length;
                const injectedCount = document.querySelectorAll('[data-ozon-bang="true"]').length;

                const indexElements = document.querySelectorAll('[data-index]');
                const uniqueIndices = new Set();
                indexElements.forEach(el => {
                    const idx = el.getAttribute('data-index');
                    if (idx !== null) uniqueIndices.add(idx);
                });

                // 检查是否到达底部
                const isAtBottom = window.scrollY + window.innerHeight >= document.body.scrollHeight - 10;

                // 查找可能的加载更多按钮
                const loadMoreButton = document.querySelector(
                    'button[class*="show-more"], ' +
                    'button[class*="load"], ' +
                    'a[href*="?page="], ' +
                    'div[class*="pagination"] button, ' +
                    'div[class*="more"] button'
                );

                result.innerHTML = `
                    <h4>滚动测试 #${scrollCount}/${maxScrolls}</h4>
                    <div>页面高度: ${lastHeight} → ${newHeight} (Δ${newHeight - lastHeight})</div>
                    <div>tile-root商品数: ${productCount}</div>
                    <div>注入数: ${injectedCount}</div>
                    <div>data-index元素: ${indexElements.length}个</div>
                    <div>唯一索引值: ${uniqueIndices.size}个 [${Array.from(uniqueIndices).sort((a,b)=>parseInt(a)-parseInt(b)).join(', ')}]</div>
                    <div>滚动位置: ${Math.round(window.scrollY)} / ${document.body.scrollHeight}</div>
                    <div>是否到底: ${isAtBottom ? '✅ 是' : '❌ 否'}</div>
                    <div>加载更多按钮: ${loadMoreButton ? '✅ 找到' : '❌ 未找到'}</div>
                `;

                if (newHeight === lastHeight) {
                    noChangeCount++;

                    // 如果页面没有变化，尝试点击加载更多按钮
                    if (noChangeCount >= 2 && loadMoreButton) {
                        result.innerHTML += '<div style="color: #ff0;">尝试点击加载更多按钮...</div>';
                        loadMoreButton.click();
                        noChangeCount = 0; // 重置计数
                    }

                    if (noChangeCount >= 5) {
                        clearInterval(interval);
                        result.innerHTML += '<div style="color: #f00;"><b>测试完成：页面不再加载新内容</b></div>';

                        // 最终统计
                        const finalStats = `
                            <div style="margin-top: 10px; padding: 10px; background: rgba(255,255,0,0.2); border: 1px solid #ff0;">
                                <h4>最终统计：</h4>
                                <div>总滚动次数: ${scrollCount}</div>
                                <div>最终页面高度: ${document.body.scrollHeight}px</div>
                                <div>tile-root总数: ${document.querySelectorAll('.tile-root').length}</div>
                                <div>已注入总数: ${document.querySelectorAll('[data-ozon-bang="true"]').length}</div>
                                <div>唯一索引数: ${uniqueIndices.size}</div>
                            </div>
                        `;
                        result.innerHTML += finalStats;

                        runDiagnostic(); // 运行完整诊断
                    }
                } else {
                    noChangeCount = 0;
                }

                lastHeight = newHeight;

                if (scrollCount >= maxScrolls) {
                    clearInterval(interval);
                    result.innerHTML += '<div style="color: #0f0;"><b>测试完成：达到最大滚动次数</b></div>';
                    runDiagnostic();
                }
            }, 1500); // 等待1.5秒让页面加载
        }, 2500); // 每2.5秒滚动一次
    }

    // 初始化
    setTimeout(() => {
        createPanel();
        console.log('Ozon诊断工具已加载');
    }, 2000);
})();