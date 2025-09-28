// ==UserScript==
// @name         选品助手
// @namespace    http://euraflow.local/
// @version      2.0
// @description  Ozon商品选品助手，提取商品数据和跟卖信息
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // 添加样式
    const style = document.createElement('style');
    style.textContent = `
        .euraflow-export-btn {
            position: fixed;
            bottom: 250px;
            right: 20px;
            z-index: 99999;
            background: #52c41a;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            font-size: 14px;
            font-weight: bold;
            border: none;
            transition: all 0.3s;
            width: 140px;
            text-align: center;
        }
        .euraflow-export-btn:hover {
            background: #73d13d;
            transform: scale(1.05);
        }
        .euraflow-export-btn:disabled {
            background: #d9d9d9;
            cursor: not-allowed;
            transform: scale(1);
        }
        .euraflow-download-btn {
            position: fixed;
            bottom: 300px;
            right: 20px;
            z-index: 99999;
            background: #1890ff;
            color: white;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
            font-size: 14px;
            font-weight: bold;
            border: none;
            transition: all 0.3s;
            display: none;
            width: 140px;
            text-align: center;
        }
        .euraflow-download-btn:hover {
            background: #40a9ff;
        }
        .euraflow-modal {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 100000;
            min-width: 350px;
        }
        .euraflow-modal h3 {
            margin: 0 0 20px 0;
            color: #333;
        }
        .euraflow-modal input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #d9d9d9;
            border-radius: 4px;
            font-size: 14px;
            margin-bottom: 20px;
        }
        .euraflow-modal-buttons {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }
        .euraflow-modal button {
            padding: 8px 20px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: 14px;
        }
        .euraflow-modal-confirm {
            background: #52c41a;
            color: white;
        }
        .euraflow-modal-cancel {
            background: #f5f5f5;
            color: #666;
        }
        .euraflow-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 99999;
        }
    `;
    document.head.appendChild(style);

    // CSV数据字段
    const CSV_HEADERS = [
        '类目链接', '商品名称', '商品名称（中文）', '商品ID', '商品链接', '商品图片',
        '预计送达时间', '商品评分', '评价次数', '销售价格', '原价', '品牌', '商品类目',
        'FBP在 1501卢布~5000卢布佣金（%）', 'FBP <= 1500卢布佣金（%）', 'FBP > 5000卢布佣金（%）',
        'RFBS在 1501卢布~5000卢布佣金（%）', 'RFBS <= 1500卢布佣金（%）', 'RFBS > 5000卢布佣金（%）',
        '30天内的销售额(卢布)', '销售动态(%)', '30天内的销量(件)', '平均价格(卢布)',
        '已错过销售(卢布)', '成交率（%）', '商品可用性(%)', '平均日销售额(卢布)', '平均日销量(件)',
        '卖家类型', '配送时间（天）', '商品体积（升）', '包装长(mm)', '包装宽(mm)', '包装高(mm)', '包装重量(g)',
        '在搜索结果和目录中的浏览量', '商品卡片浏览量', '从搜索结果和目录中加入购物车(%)',
        '从商品卡片添加至购物车(%)', '广告费用份额（%）',
        '跟卖者数量', '最低跟卖价格',
        '商品创建日期'
    ];

    // 全局变量
    let extractedData = null;
    let targetCount = 100;

    // 创建输入框弹窗
    function showInputModal() {
        return new Promise((resolve) => {
            // 创建遮罩层
            const overlay = document.createElement('div');
            overlay.className = 'euraflow-overlay';

            // 创建弹窗
            const modal = document.createElement('div');
            modal.className = 'euraflow-modal';
            modal.innerHTML = `
                <h3>提取数量</h3>
                <input type="number" id="product-count" value="100" min="1" max="500" placeholder="1-500">
                <div class="euraflow-modal-buttons">
                    <button class="euraflow-modal-cancel">取消</button>
                    <button class="euraflow-modal-confirm">确定</button>
                </div>
            `;

            document.body.appendChild(overlay);
            document.body.appendChild(modal);

            const input = modal.querySelector('#product-count');
            const confirmBtn = modal.querySelector('.euraflow-modal-confirm');
            const cancelBtn = modal.querySelector('.euraflow-modal-cancel');

            // 确定按钮
            confirmBtn.onclick = () => {
                let count = parseInt(input.value);
                if (isNaN(count) || count < 1) count = 100;
                if (count > 500) count = 500;

                document.body.removeChild(overlay);
                document.body.removeChild(modal);
                resolve(count);
            };

            // 取消按钮
            cancelBtn.onclick = () => {
                document.body.removeChild(overlay);
                document.body.removeChild(modal);
                resolve(null);
            };

            // 按回车确定
            input.onkeypress = (e) => {
                if (e.key === 'Enter') {
                    confirmBtn.click();
                }
            };

            // 自动聚焦输入框
            input.focus();
            input.select();
        });
    }

    // 智能滚动加载商品（实时检测注入情况）
    async function scrollToLoadProducts(targetCount) {
        // 要求注入数量比指定值多20
        const requiredInjected = targetCount + 20;
        let scrollAttempts = 0;
        const maxAttempts = 100;

        console.log(`开始智能滚动加载，目标注入数量: ${requiredInjected} (指定${targetCount}+20)`);

        // 获取当前注入数量的函数
        const getInjectedCount = () => {
            return document.querySelectorAll('[data-index][data-ozon-bang="true"]').length;
        };

        // 获取当前商品数量的函数（尝试多种选择器）
        const getProductCount = () => {
            // 优先使用data-index
            let count = document.querySelectorAll('[data-index]').length;
            if (count > 0) return count;

            // 备选：tile-root
            count = document.querySelectorAll('.tile-root').length;
            if (count > 0) return count;

            // 备选：包含商品链接的元素
            count = document.querySelectorAll('a[href*="/product/"]').length;
            return Math.max(1, Math.floor(count / 2)); // 通常每个商品有2个链接
        };

        // 等待新商品注入完成
        const waitForNewItemsInjected = async (previousProducts, maxWaitTime = 5000) => {
            const startTime = Date.now();
            const checkInterval = 500; // 每500ms检查一次

            while (Date.now() - startTime < maxWaitTime) {
                const currentProducts = getProductCount();
                const currentInjected = getInjectedCount();

                // 计算新加载商品中有多少已注入
                const newProducts = currentProducts - previousProducts;
                const injectedRate = previousProducts > 0 ?
                    (currentInjected / currentProducts * 100).toFixed(1) : 0;

                console.log(`  等待注入: 商品${currentProducts}(+${newProducts}), 注入${currentInjected}, 注入率${injectedRate}%`);

                // 如果新商品都注入了，或者注入率很高（>90%），可以继续
                if (newProducts === 0 || injectedRate > 90) {
                    console.log(`  ✓ 注入充分，继续滚动`);
                    return true;
                }

                // 短暂等待后继续检查
                await new Promise(resolve => setTimeout(resolve, checkInterval));
            }

            console.log(`  ⚠️ 等待超时，继续滚动`);
            return false;
        };

        let previousProductCount = getProductCount();
        let previousInjectedCount = getInjectedCount();

        // 记录连续无变化次数
        let noChangeCount = 0;
        let lastProductCount = 0;

        while (scrollAttempts < maxAttempts) {
            const viewportHeight = window.innerHeight;
            let currentInjected = getInjectedCount();
            const currentProducts = getProductCount();

            // 更详细的调试信息
            const debugInfo = {
                'data-index总数': document.querySelectorAll('[data-index]').length,
                'tile-root总数': document.querySelectorAll('.tile-root').length,
                'widget-search总数': document.querySelectorAll('[data-widget="searchResultsV2"]').length,
                'bang标记总数': document.querySelectorAll('[data-ozon-bang="true"]').length,
                'data-index带bang': document.querySelectorAll('[data-index][data-ozon-bang="true"]').length,
                'tile-root带bang': document.querySelectorAll('.tile-root[data-ozon-bang="true"]').length,
                '当前滚动位置': Math.round(window.scrollY),
                '页面总高度': document.body.scrollHeight
            };

            console.log(`\n滚动 #${scrollAttempts}: 商品${currentProducts}个, 已注入${currentInjected}/${requiredInjected}`);
            console.table(debugInfo);

            // 检查是否达到目标
            if (currentInjected >= requiredInjected) {
                console.log(`✅ 注入数量已达标: ${currentInjected}`);
                break;
            }

            // 检查商品数量是否不再增加
            if (currentProducts === lastProductCount) {
                noChangeCount++;
                if (noChangeCount >= 5) {
                    console.log(`⚠️ 商品数量不再增加，页面可能已经到底`);

                    // 如果商品总数少于需求，调整目标
                    if (currentProducts < requiredInjected) {
                        console.log(`  商品总数(${currentProducts})少于需求(${requiredInjected})`);
                        console.log(`  调整目标为: ${currentProducts}`);

                        // 等待所有现有商品注入
                        const maxWaitForAll = 10;
                        let waitCount = 0;
                        while (waitCount < maxWaitForAll && currentInjected < currentProducts) {
                            await new Promise(resolve => setTimeout(resolve, 1000));
                            const newInjected = getInjectedCount();
                            console.log(`  等待全部注入: ${newInjected}/${currentProducts}`);
                            if (newInjected === currentInjected) {
                                waitCount++;
                            } else {
                                waitCount = 0;
                            }
                            currentInjected = newInjected;
                        }
                        break;
                    }
                }
            } else {
                noChangeCount = 0;
                lastProductCount = currentProducts;
            }

            // 滚动一屏
            const scrollDistance = viewportHeight * 0.8;
            window.scrollBy({
                top: scrollDistance,
                behavior: 'smooth'
            });

            // 先等待页面加载新商品（给一点基础时间）
            await new Promise(resolve => setTimeout(resolve, 800));

            // 然后等待新商品注入完成
            await waitForNewItemsInjected(previousProductCount);

            // 检查是否到页面底部
            if (window.scrollY + viewportHeight >= document.body.scrollHeight - 100) {
                // 尝试点击"加载更多"
                const loadMoreBtn = document.querySelector('[data-widget="paginator"] button, button[class*="show-more"]');
                if (loadMoreBtn) {
                    console.log(`  点击"加载更多"按钮`);
                    loadMoreBtn.click();
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                // 检查是否已经无法加载更多
                const noNewProducts = currentProducts === previousProductCount;
                if (noNewProducts) {
                    console.log(`  页面已到底，无新商品加载`);

                    // 如果商品数量足够但注入不够，需要向上滚动检查
                    if (currentProducts >= requiredInjected && currentInjected < requiredInjected) {
                        console.log(`  商品足够(${currentProducts})但注入不足(${currentInjected})，回滚重新注入`);

                        // 滚回顶部
                        window.scrollTo(0, 0);
                        await new Promise(resolve => setTimeout(resolve, 1000));

                        // 慢慢往下滚动，等待注入
                        for (let i = 0; i < 10; i++) {
                            window.scrollBy(0, viewportHeight * 0.5);
                            await new Promise(resolve => setTimeout(resolve, 1500));
                            const newInjected = getInjectedCount();
                            console.log(`  重新滚动 ${i+1}/10: 注入${newInjected}/${requiredInjected}`);
                            if (newInjected >= requiredInjected) break;
                        }
                    }
                    break;
                }
            }

            // 更新计数器
            previousProductCount = currentProducts;
            previousInjectedCount = currentInjected;
            scrollAttempts++;
        }

        // 滚动回顶部
        window.scrollTo(0, 0);

        const finalInjected = getInjectedCount();
        const finalProducts = getProductCount();

        // 判断是否达标
        if (finalProducts < targetCount) {
            // 商品总数不足
            console.warn(`⚠️ 商品总数不足: ${finalProducts} < ${targetCount}`);
            console.log(`  已注入: ${finalInjected}/${finalProducts}`);
            if (finalInjected < finalProducts * 0.9) {
                alert(`商品注入不完整：${finalInjected}/${finalProducts}，请重试`);
            }
        } else if (finalInjected < targetCount) {
            // 注入数量不足
            console.warn(`⚠️ 注入数量不足: ${finalInjected}/${targetCount}`);
            alert(`注入数量不足：${finalInjected}/${targetCount}，请重试`);
        } else {
            console.log(`✅ 滚动完成，最终注入: ${finalInjected}个`);
        }

        return finalInjected;
    }

    // 等待上品帮注入（确保达标）
    async function waitForSpbangInjection(targetCount) {
        const requiredCount = targetCount + 20; // 要求比指定值多20
        let attempts = 0;
        const maxAttempts = 60; // 增加等待次数
        let lastCount = 0;
        let stableCount = 0;

        console.log(`等待上品帮注入，目标: ${requiredCount} (指定${targetCount}+20)`);

        while (attempts < maxAttempts) {
            const currentCount = document.querySelectorAll('[data-index][data-ozon-bang="true"]').length;

            console.log(`上品帮注入进度: ${currentCount}/${requiredCount}`);

            // 如果达到目标数量
            if (currentCount >= requiredCount) {
                console.log(`✔️ 上品帮注入达标，共 ${currentCount} 个商品`);
                return currentCount;
            }

            // 如果数量稳定不变（10次），可能已经到极限
            if (currentCount === lastCount) {
                stableCount++;
                if (stableCount >= 10) {
                    console.log(`上品帮注入稳定在 ${currentCount} 个`);
                    if (currentCount < requiredCount) {
                        console.warn(`⚠️ 注入数量未达标: ${currentCount}/${requiredCount}`);
                    }
                    break;
                }
            } else {
                stableCount = 0;
            }

            lastCount = currentCount;
            await new Promise(resolve => setTimeout(resolve, 2000));
            attempts++;
        }

        const finalCount = document.querySelectorAll('[data-index][data-ozon-bang="true"]').length;
        console.log(`上品帮最终注入 ${finalCount} 个商品`);

        if (finalCount < requiredCount) {
            console.warn(`⚠️ 最终注入数量不足: ${finalCount}/${requiredCount}`);
        }

        return finalCount;
    }

    // 提取单个商品数据
    function extractProductData(container, index) {
        const data = {};

        try {
            // 查找商品卡片（父元素）
            let productCard = container.closest('.tile-root') ||
                             container.closest('[data-widget="searchResultsV2"]') ||
                             container.closest('.widget-search-result-container') ||
                             container.closest('[style*="grid-column"]') ||
                             container.closest('div').parentElement;

            // 提取商品基础信息
            if (productCard) {
                // 商品链接和ID
                const productLink = productCard.querySelector('a[href*="/product/"]');
                if (productLink) {
                    data['商品链接'] = productLink.href;
                    const idMatch = productLink.href.match(/product\/.*?-(\d+)\/?/);
                    if (idMatch) {
                        data['商品ID'] = idMatch[1];
                    }

                    // 商品名称提取策略（兼容多种格式，不依赖CSS类名）
                    let productName = '';

                    // 策略1: 优先从商品链接内查找 tsBody500Medium（商品名称总是在链接内）
                    const allProductLinks = container.querySelectorAll('a[href*="/product/"]');
                    console.log(`  找到 ${allProductLinks.length} 个商品链接`);

                    for (let link of allProductLinks) {
                        // 查找链接内的 tsBody500Medium span
                        const linkSpan = link.querySelector('span.tsBody500Medium');
                        if (linkSpan) {
                            const text = linkSpan.textContent.trim();
                            console.log(`    链接内找到文本: "${text}" (长度: ${text.length})`);
                            // 商品名称的基本判断
                            if (text.length >= 3 && // 商品名称至少3个字符
                                !text.includes('₽') &&
                                !text.includes('%') &&
                                !text.includes('шт') &&
                                !text.includes('осталось')) {
                                productName = text;
                                console.log(`    ✓ 选中为商品名称`);
                                break;
                            }
                        }
                    }

                    // 策略2: 如果没找到，尝试在整个container中查找（备选方案）
                    if (!productName) {
                        console.log(`  策略1未找到，尝试策略2`);
                        const nameSpans = container.querySelectorAll('span.tsBody500Medium');
                        for (let span of nameSpans) {
                            // 检查这个span是否在链接内
                            const parentLink = span.closest('a[href*="/product/"]');
                            if (parentLink) {
                                const text = span.textContent.trim();
                                if (text.length >= 3 &&
                                    !text.includes('₽') &&
                                    !text.includes('%')) {
                                    productName = text;
                                    console.log(`    策略2找到: "${text}"`);
                                    break;
                                }
                            }
                        }
                    }

                    // 策略3: 基于DOM结构位置（商品名称通常在价格附近）
                    if (!productName) {
                        // 找价格元素的兄弟元素
                        const priceParent = container.querySelector('.tsHeadline500Medium')?.parentElement?.parentElement;
                        if (priceParent) {
                            const siblings = priceParent.parentElement?.children || [];
                            for (let sibling of siblings) {
                                if (sibling !== priceParent) {
                                    const spans = sibling.querySelectorAll('span');
                                    for (let span of spans) {
                                        const text = span.textContent.trim();
                                        if (text.length >= 5 && text.length <= 500 &&
                                            !text.includes('₽') && !text.includes('%')) {
                                            productName = text;
                                            break;
                                        }
                                    }
                                    if (productName) break;
                                }
                            }
                        }
                    }

                    // 策略4: 备选方案 - 查找任何包含商品名称特征的文本
                    if (!productName && productCard) {
                        // 在productCard中查找所有span
                        const allSpans = productCard.querySelectorAll('span');
                        for (let span of allSpans) {
                            const text = span.textContent.trim();
                            // 判断是否可能是商品名称
                            if (text.length >= 5 && text.length <= 200 &&
                                !text.includes('₽') &&
                                !text.includes('%') &&
                                !text.includes('шт') &&
                                !text.includes('осталось') &&
                                !text.match(/^\d+$/) && // 不是纯数字
                                !span.closest('.tsHeadline500Medium') && // 不是价格元素
                                !span.closest('button')) { // 不是按钮文本
                                productName = text;
                                break;
                            }
                        }
                    }

                    if (productName) {
                        data['商品名称'] = productName;
                    }
                }

                // 商品图片
                const imgElement = productCard.querySelector('img[src*="ozon"], img[src*="ozonstatic"]');
                if (imgElement) {
                    data['商品图片'] = imgElement.src;
                }

                // 销售价格（当前价格）
                const priceElement = productCard.querySelector('span.tsHeadline500Medium');
                if (priceElement) {
                    const priceText = priceElement.textContent.match(/[\d\s]+/);
                    if (priceText) {
                        data['销售价格'] = priceText[0].replace(/\s/g, '');
                    }
                }

                // 原价
                const originalPriceElements = productCard.querySelectorAll('span.tsBodyControl400Small');
                originalPriceElements.forEach(elem => {
                    const text = elem.textContent;
                    if (text.includes('₽') && !text.includes('%')) {
                        const priceMatch = text.match(/[\d\s]+/);
                        if (priceMatch && !data['原价']) {
                            data['原价'] = priceMatch[0].replace(/\s/g, '');
                        }
                    }
                });

                // 评分和评价次数（优先从DOM中查找，不依赖class名）
                // 策略1: 查找包含星形SVG的元素（评分通常有星形图标）
                const starIcon = productCard.querySelector('svg path[d*="M8 2a1 1"], svg path[d*=".87.508"]');
                if (starIcon) {
                    const ratingContainer = starIcon.closest('span')?.parentElement;
                    if (ratingContainer) {
                        // 找到评分数值（通常在星形图标后面）
                        const spans = ratingContainer.querySelectorAll('span');
                        for (let span of spans) {
                            const text = span.textContent.trim();
                            // 评分格式: "5.0" 或 "4.8" 等
                            if (/^\d+\.\d+$/.test(text) || /^\d+$/.test(text)) {
                                data['商品评分'] = text;
                            }
                            // 评论数格式: 纯数字
                            else if (/^\d+$/.test(text) && parseInt(text) > 10) {
                                data['评价次数'] = text;
                            }
                        }
                    }
                }

                // 策略2: 查找textPremium或textSecondary样式的元素
                if (!data['商品评分']) {
                    const premiumText = productCard.querySelector('[style*="textPremium"]');
                    if (premiumText) {
                        const text = premiumText.textContent.trim();
                        if (/^\d+\.\d+$/.test(text)) {
                            data['商品评分'] = text;
                        }
                    }
                }
                if (!data['评价次数']) {
                    const secondaryText = productCard.querySelector('[style*="textSecondary"]');
                    if (secondaryText) {
                        const text = secondaryText.textContent.trim();
                        if (/^\d+$/.test(text) && parseInt(text) > 10) {
                            data['评价次数'] = text;
                        }
                    }
                }

                // 品牌
                const brandElement = productCard.querySelector('[class*="brand"], [title*="бренд"]');
                if (brandElement) {
                    data['品牌'] = brandElement.textContent.trim();
                }

                // 预计送达时间
                const deliveryButton = productCard.querySelector('button .b25_4_4-a9');
                if (deliveryButton) {
                    data['预计送达时间'] = deliveryButton.textContent.trim();
                }
            }

            // 2. 从上品帮div提取详细数据
            const spbangContainer = container.querySelector('.ozon-bang-item-layout-2');
            if (spbangContainer) {
                const liElements = spbangContainer.querySelectorAll('li');

                liElements.forEach(li => {
                    const textElement = li.querySelector('.text-class');
                    if (!textElement) return;

                    const spanText = textElement.querySelector('span')?.textContent || '';
                    const valueElement = textElement.querySelector('b');
                    const value = valueElement ? valueElement.textContent.trim() : '';

                    // 处理"无数据"和"非热销,无数据"的情况
                    const cleanValue = (val) => {
                        if (!val || val === '无数据' || val === '非热销,无数据' || val.includes('非热销')) {
                            return '-';
                        }
                        return val;
                    };

                    // 根据标签文本提取对应数据
                    if (spanText.includes('类目')) {
                        data['商品类目'] = cleanValue(value);
                    } else if (spanText.includes('品牌')) {
                        data['品牌'] = cleanValue(value);
                    } else if (spanText.includes('rFBS佣金(1501~5000')) {
                        data['RFBS在 1501卢布~5000卢布佣金（%）'] = value.replace('%', '').trim();
                    } else if (spanText.includes('rFBS佣金(<=1500')) {
                        data['RFBS <= 1500卢布佣金（%）'] = value.replace('%', '').trim();
                    } else if (spanText.includes('FBP佣金(1501~5000')) {
                        data['FBP在 1501卢布~5000卢布佣金（%）'] = value.replace('%', '').trim();
                    } else if (spanText.includes('FBP佣金(<=1500')) {
                        data['FBP <= 1500卢布佣金（%）'] = value.replace('%', '').trim();
                    } else if (spanText.includes('月销量')) {
                        data['30天内的销量(件)'] = cleanValue(value.replace('件', '').trim());
                    } else if (spanText.includes('月销售额')) {
                        // 处理万单位
                        if (value.includes('万')) {
                            const num = parseFloat(value.replace('万', '').replace('₽', '').trim());
                            data['30天内的销售额(卢布)'] = (num * 10000).toString();
                        } else {
                            data['30天内的销售额(卢布)'] = cleanValue(value.replace('₽', '').trim());
                        }
                    } else if (spanText.includes('日销量')) {
                        data['平均日销量(件)'] = cleanValue(value.replace('件', '').trim());
                    } else if (spanText.includes('日销售额')) {
                        data['平均日销售额(卢布)'] = cleanValue(value.replace('₽', '').trim());
                    } else if (spanText.includes('月销售动态') || spanText.includes('销售动态')) {
                        data['销售动态(%)'] = cleanValue(value.replace('%', '').trim());
                    } else if (spanText.includes('商品卡片浏览量')) {
                        data['商品卡片浏览量'] = cleanValue(value);
                    } else if (spanText.includes('商品卡片加购率')) {
                        data['从商品卡片添加至购物车(%)'] = cleanValue(value.replace('%', '').trim());
                    } else if (spanText.includes('搜索和目录浏览量')) {
                        data['在搜索结果和目录中的浏览量'] = cleanValue(value);
                    } else if (spanText.includes('搜索和目录加购率')) {
                        data['从搜索结果和目录中加入购物车(%)'] = cleanValue(value.replace('%', '').trim());
                    } else if (spanText.includes('广告份额') || spanText.includes('广告费用份额')) {
                        data['广告费用份额（%）'] = cleanValue(value.replace('%', '').trim());
                    } else if (spanText.includes('成交率')) {
                        data['成交率（%）'] = cleanValue(value.replace('%', '').trim());
                    } else if (spanText.includes('平均价格')) {
                        // 处理万单位转换
                        const priceValue = value.replace('₽', '').trim();
                        if (priceValue.includes('万')) {
                            const num = parseFloat(priceValue.replace('万', ''));
                            data['平均价格(卢布)'] = (num * 10000).toString();
                        } else {
                            data['平均价格(卢布)'] = cleanValue(priceValue);
                        }
                    } else if (spanText.includes('包装重量')) {
                        data['包装重量(g)'] = cleanValue(value.replace('g', '').trim());
                    } else if (spanText.includes('长宽高')) {
                        // 保持原格式，分别提取
                        const dimensions = value.match(/(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
                        if (dimensions) {
                            data['包装长(mm)'] = dimensions[1];
                            data['包装宽(mm)'] = dimensions[2];
                            data['包装高(mm)'] = dimensions[3];
                        }
                    } else if (spanText.includes('卖家类型')) {
                        data['卖家类型'] = cleanValue(value);
                    } else if (spanText.includes('配送时间')) {
                        data['配送时间（天）'] = cleanValue(value.replace('天', '').trim());
                    } else if (spanText.includes('商品上架时间')) {
                        data['商品创建日期'] = cleanValue(value);
                    } else if (spanText.includes('产品代码')) {
                        if (!data['商品ID']) {
                            data['商品ID'] = value;
                        }
                    } else if (spanText.includes('跟卖者')) {
                        // 提取跟卖者数量
                        const competitorMatch = li.textContent.match(/等(\d+)个卖家/);
                        if (competitorMatch) {
                            data['跟卖者数量'] = competitorMatch[1];
                        } else {
                            data['跟卖者数量'] = '-';
                        }
                    } else if (spanText.includes('跟卖最低价')) {
                        // 处理跟卖最低价，如果值是"无跟卖"则显示"-"
                        const priceValue = value.replace('₽', '').trim();
                        if (priceValue === '无跟卖' || priceValue === '') {
                            data['最低跟卖价格'] = '-';
                        } else {
                            data['最低跟卖价格'] = cleanValue(priceValue);
                        }
                    }
                });
            }

            // 3. 如果上品帮容器不存在，尝试从文本中提取跟卖信息
            if (!spbangContainer) {
                const spbangText = container.textContent || '';
                const competitorMatch = spbangText.match(/等(\d+)个卖家/);
                if (competitorMatch) {
                    data['跟卖者数量'] = competitorMatch[1];
                } else {
                    data['跟卖者数量'] = '-';
                }

                const minPriceMatch = spbangText.match(/跟卖最低价[：:]\s*([\d\s]+)\s*₽/);
                if (minPriceMatch) {
                    data['最低跟卖价格'] = minPriceMatch[1].replace(/\s/g, '');
                } else {
                    data['最低跟卖价格'] = '-';
                }
            }

            // 4. 填充默认值 - 所有空字段默认为"-"，处理"无数据"情况
            CSV_HEADERS.forEach(header => {
                if (!(header in data) ||
                    data[header] === '' ||
                    data[header] === null ||
                    data[header] === undefined ||
                    data[header] === '无数据' ||
                    data[header] === '非热销,无数据' ||
                    (typeof data[header] === 'string' && data[header].includes('非热销'))) {
                    data[header] = '-';
                }
            });

            // 设置类目链接（这个不能为-）
            data['类目链接'] = window.location.href;

            // 如果商品名称为空，保持为"-"
            if (!data['商品名称'] || data['商品名称'] === '') {
                data['商品名称'] = '-';
            }

            // 特别确保跟卖者数据有默认值
            if (!data['跟卖者数量'] || data['跟卖者数量'] === '' || data['跟卖者数量'] === '0') {
                data['跟卖者数量'] = '-';
            }
            // 如果没有跟卖者，最低价格也应该是"-"
            if (!data['最低跟卖价格'] || data['最低跟卖价格'] === '' || data['最低跟卖价格'] === '无跟卖' || data['跟卖者数量'] === '-') {
                data['最低跟卖价格'] = '-';
            }

        } catch (error) {
            // 错误时填充默认值为"-"
            CSV_HEADERS.forEach(header => {
                if (!(header in data)) {
                    data[header] = '-';
                }
            });
            data['跟卖者数量'] = '-';
            data['最低跟卖价格'] = '-';
        }

        return data;
    }

    // 提取所有商品数据（使用data-index属性直接定位商品）
    function extractAllData() {
        // 直接选择具有data-index属性且带有上品帮标记的外层商品容器
        const containers = document.querySelectorAll('[data-index][data-ozon-bang="true"]');

        if (containers.length === 0) {
            // 如果没找到，尝试查找所有上品帮标记
            const allBangContainers = document.querySelectorAll('[data-ozon-bang="true"]');
            if (allBangContainers.length > 0) {
                console.log(`找到 ${allBangContainers.length} 个上品帮标记，但可能不是商品容器`);
                alert('请等待页面完全加载后再试');
            } else {
                alert('未找到上品帮数据！请确保上品帮插件已加载');
            }
            return null;
        }

        console.log(`找到 ${containers.length} 个商品`);
        const allData = [];
        const seenProducts = new Map(); // 使用Map存储 商品名称+ID 的组合

        containers.forEach((container, idx) => {
            const dataIndex = container.getAttribute('data-index');
            console.log(`处理商品 #${dataIndex}`);

            const productData = extractProductData(container, idx + 1);

            // 基于商品名称+ID的组合去重
            const productName = productData['商品名称'];
            const productId = productData['商品ID'] || '-';

            // 创建唯一键：商品名称 + 商品ID
            const uniqueKey = `${productName}|${productId}`;

            if (productName && productName !== '-') {
                if (!seenProducts.has(uniqueKey)) {
                    seenProducts.set(uniqueKey, {
                        index: dataIndex,
                        productId: productId,
                        productName: productName
                    });
                    allData.push(productData);
                    console.log(`index ${dataIndex}: ${productName} (ID: ${productId})`);
                } else {
                    const firstOccurrence = seenProducts.get(uniqueKey);
                    console.log(`重复商品: index:${dataIndex} 跟index:${firstOccurrence.index}重复`);
                    console.log(`  商品: ${productName} (ID: ${productId})`);
                }
            } else {
                // 名称提取失败，直接添加
                allData.push(productData);
                console.log(`index ${dataIndex}: 名称提取失败`);
            }
        });

        const duplicateCount = containers.length - allData.length;
        console.log(`\n提取完成统计:`);
        console.log(`  原始商品数: ${containers.length}`);
        console.log(`  去重后商品数: ${allData.length}`);
        console.log(`  重复商品数: ${duplicateCount}`);
        return allData;
    }

    // 转换为CSV格式
    function convertToCSV(data) {
        if (!data || data.length === 0) return '';

        let csv = CSV_HEADERS.join(',') + '\n';

        data.forEach(row => {
            const values = CSV_HEADERS.map(header => {
                let value = row[header] || '';
                if (value.toString().includes(',') || value.toString().includes('"') || value.toString().includes('\n')) {
                    value = '"' + value.toString().replace(/"/g, '""') + '"';
                }
                return value;
            });
            csv += values.join(',') + '\n';
        });

        return csv;
    }

    // 下载CSV文件
    function downloadCSV(csvContent) {
        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        const now = new Date();
        const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

        link.href = url;
        link.download = `ozon_products_${timestamp}.csv`;
        link.click();

        URL.revokeObjectURL(url);
    }

    // 添加按钮
    function addButtons() {
        if (document.querySelector('.euraflow-export-btn')) return;

        // 主按钮
        const extractBtn = document.createElement('button');
        extractBtn.className = 'euraflow-export-btn';
        extractBtn.innerHTML = '📊 选品助手';

        // 下载按钮
        const downloadBtn = document.createElement('button');
        downloadBtn.className = 'euraflow-download-btn';
        downloadBtn.innerHTML = '💾 下载数据';

        extractBtn.onclick = async function() {
            // 显示输入框
            const count = await showInputModal();
            if (!count) return;

            targetCount = count;

            extractBtn.disabled = true;
            extractBtn.innerHTML = '⏳ 加载商品';
            downloadBtn.style.display = 'none';

            // 滚动加载
            await scrollToLoadProducts(targetCount);

            extractBtn.innerHTML = '⏳ 等待注入';

            // 等待上品帮注入
            const injectedCount = await waitForSpbangInjection(targetCount);

            extractBtn.innerHTML = '⏳ 提取数据中';

            // 提取数据
            setTimeout(() => {
                extractedData = extractAllData();

                if (extractedData && extractedData.length > 0) {
                    extractBtn.innerHTML = `✅ 提取 ${extractedData.length}`;
                    downloadBtn.style.display = 'block';
                } else {
                    extractBtn.innerHTML = '❌ 提取失败';
                    alert('数据提取失败，请重试');
                }

                setTimeout(() => {
                    extractBtn.disabled = false;
                    extractBtn.innerHTML = '📊 选品助手';
                }, 3000);
            }, 500);
        };

        downloadBtn.onclick = function() {
            if (extractedData) {
                const csv = convertToCSV(extractedData);
                downloadCSV(csv);
            }
        };

        document.body.appendChild(extractBtn);
        document.body.appendChild(downloadBtn);
    }

    // 初始化
    function init() {
        setTimeout(() => {
            addButtons();
        }, 2000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();