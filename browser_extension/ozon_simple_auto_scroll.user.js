// ==UserScript==
// @name         Ozon简单自动滚动器
// @namespace    http://euraflow.local/
// @version      1.0
// @description  简单可靠的自动滚动到页面最底部
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 创建控制面板
    function createPanel() {
        const panel = document.createElement('div');
        panel.style.cssText = `
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: rgba(0,0,0,0.9);
            color: #0f0;
            padding: 15px;
            border-radius: 8px;
            font-family: monospace;
            font-size: 12px;
            z-index: 2147483647;
            min-width: 300px;
        `;

        panel.innerHTML = `
            <h4 style="margin: 0 0 10px 0;">🚀 自动滚动器</h4>
            <button id="auto-scroll-btn" style="background: #0f0; color: #000; padding: 8px 15px; border: none; cursor: pointer; margin-right: 10px;">
                开始滚动到底
            </button>
            <button id="stop-scroll-btn" style="background: #f00; color: #fff; padding: 8px 15px; border: none; cursor: pointer;">
                停止
            </button>
            <div id="scroll-info" style="margin-top: 10px; padding: 10px; background: rgba(0,255,0,0.1); border: 1px solid #0f0;">
                <div>状态: <span id="scroll-status">待命</span></div>
                <div>滚动次数: <span id="scroll-count">0</span></div>
                <div>当前位置: <span id="current-pos">0</span></div>
                <div>页面高度: <span id="page-height">0</span></div>
                <div>进度: <span id="scroll-progress">0%</span></div>
                <div>商品数量: <span id="product-count">0</span></div>
            </div>
        `;

        document.body.appendChild(panel);

        // 绑定按钮
        document.getElementById('auto-scroll-btn').onclick = startAutoScroll;
        document.getElementById('stop-scroll-btn').onclick = stopAutoScroll;

        // 初始更新
        updateInfo();
    }

    // 更新信息显示
    function updateInfo() {
        const currentPos = Math.round(window.scrollY);
        const pageHeight = document.body.scrollHeight;
        const viewHeight = window.innerHeight;
        const progress = ((currentPos / (pageHeight - viewHeight)) * 100).toFixed(1);
        const productCount = document.querySelectorAll('.tile-root').length;

        document.getElementById('current-pos').textContent = currentPos;
        document.getElementById('page-height').textContent = pageHeight;
        document.getElementById('scroll-progress').textContent = progress + '%';
        document.getElementById('product-count').textContent = productCount;
    }

    // 滚动控制变量
    let isScrolling = false;
    let scrollCount = 0;
    let lastHeight = 0;
    let noChangeCount = 0;

    // 开始自动滚动
    function startAutoScroll() {
        if (isScrolling) {
            console.log('已经在滚动中');
            return;
        }

        isScrolling = true;
        scrollCount = 0;
        noChangeCount = 0;
        lastHeight = document.body.scrollHeight;

        document.getElementById('scroll-status').textContent = '滚动中...';
        document.getElementById('scroll-status').style.color = '#0f0';
        document.getElementById('auto-scroll-btn').disabled = true;

        console.log('开始自动滚动到页面底部...');
        performScroll();
    }

    // 执行滚动
    function performScroll() {
        if (!isScrolling) {
            console.log('滚动已停止');
            return;
        }

        scrollCount++;
        document.getElementById('scroll-count').textContent = scrollCount;

        // 获取当前状态
        const currentScroll = window.scrollY;
        const currentHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;

        console.log(`\n滚动 #${scrollCount}:`);
        console.log(`  当前位置: ${Math.round(currentScroll)}`);
        console.log(`  页面高度: ${currentHeight}`);

        // 检查是否已到达底部
        const isAtBottom = (currentScroll + viewportHeight) >= (currentHeight - 10);

        if (isAtBottom) {
            console.log('  状态: 已到达底部');

            // 检查页面高度是否还在变化
            if (currentHeight === lastHeight) {
                noChangeCount++;
                console.log(`  页面高度未变化 (${noChangeCount}次)`);

                if (noChangeCount >= 5) {
                    // 确认到达最终底部
                    console.log('\n✅ 已到达页面最终底部！');
                    finishScrolling('完成 - 已到达底部');
                    return;
                }
            } else {
                // 页面还在加载新内容
                console.log(`  检测到新内容: +${currentHeight - lastHeight}px`);
                noChangeCount = 0;
                lastHeight = currentHeight;
            }

            // 在底部多等一会儿，让新内容加载
            console.log('  等待新内容加载...');
            setTimeout(() => {
                // 再次尝试滚动到绝对底部
                window.scrollTo(0, document.body.scrollHeight);
                updateInfo();
                setTimeout(() => performScroll(), 1000);
            }, 2000);

        } else {
            // 还没到底，继续滚动
            noChangeCount = 0;
            lastHeight = currentHeight;

            // 计算滚动距离（每次滚动2个视口高度）
            const scrollDistance = viewportHeight * 2;
            const targetScroll = Math.min(currentScroll + scrollDistance, currentHeight);

            console.log(`  目标位置: ${Math.round(targetScroll)}`);
            console.log(`  滚动距离: ${Math.round(scrollDistance)}`);

            // 执行滚动
            window.scrollTo({
                top: targetScroll,
                behavior: 'smooth'
            });

            // 更新显示
            updateInfo();

            // 等待一段时间后继续
            setTimeout(() => performScroll(), 1500);
        }

        // 安全检查：最大滚动次数
        if (scrollCount >= 500) {
            console.log('\n⚠️ 达到最大滚动次数限制');
            finishScrolling('停止 - 达到次数限制');
        }
    }

    // 停止滚动
    function stopAutoScroll() {
        if (!isScrolling) return;

        isScrolling = false;
        console.log('用户停止滚动');
        finishScrolling('已停止');
    }

    // 完成滚动
    function finishScrolling(status) {
        isScrolling = false;
        document.getElementById('scroll-status').textContent = status;
        document.getElementById('scroll-status').style.color = '#ff0';
        document.getElementById('auto-scroll-btn').disabled = false;

        // 最终统计
        const finalStats = {
            scrollCount: scrollCount,
            finalPosition: Math.round(window.scrollY),
            pageHeight: document.body.scrollHeight,
            productCount: document.querySelectorAll('.tile-root').length,
            injectedCount: document.querySelectorAll('[data-ozon-bang="true"]').length
        };

        console.log('\n=== 最终统计 ===');
        console.log(`滚动次数: ${finalStats.scrollCount}`);
        console.log(`最终位置: ${finalStats.finalPosition}`);
        console.log(`页面高度: ${finalStats.pageHeight}`);
        console.log(`商品总数: ${finalStats.productCount}`);
        console.log(`已注入数: ${finalStats.injectedCount}`);

        updateInfo();
    }

    // 初始化
    setTimeout(() => {
        createPanel();
        console.log('Ozon自动滚动器已加载');

        // 监听手动滚动以更新信息
        let updateTimeout;
        window.addEventListener('scroll', () => {
            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(updateInfo, 100);
        });
    }, 2000);
})();