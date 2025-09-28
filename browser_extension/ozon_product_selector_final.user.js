// ==UserScript==
// @name         Ozon选品助手
// @namespace    http://euraflow.local/
// @version      4.0
// @description  智能采集Ozon商品数据，完全适配虚拟滚动机制
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // ===== 全局配置 =====
    const CONFIG = {
        virtualScrollIndexes: 12,        // 索引0-11循环使用
        visibleWindowMin: 8,             // 最小可见窗口
        visibleWindowMax: 12,            // 最大可见窗口
        scrollStepSize: 1.2,             // 每次滚动视口倍数
        scrollWaitTime: 2500,            // 滚动后等待时间
        bangInjectionWait: 2000,         // 等待上品帮注入时间
        maxScrollAttempts: 200,          // 最大滚动次数
        noChangeThreshold: 5,            // 无变化阈值
        forceScrollThreshold: 3,         // 强制滚动阈值
        targetProductCount: 100,         // 默认目标商品数
        contentChangeDetection: true,    // 启用内容变化检测
        dataValidation: true,            // 启用数据验证
        debugMode: false                 // 调试模式
    };

    // ===== CSV数据字段（42个字段）=====
    const CSV_HEADERS = [
        '类目链接', '商品名称', '商品ID', '商品链接', '商品图片',
        '预计送达时间', '商品评分', '评价次数', '销售价格', '原价',
        '品牌', '商品类目',
        'FBP在 1501卢布~5000卢布佣金（%）', 'FBP <= 1500卢布佣金（%）', 'FBP > 5000卢布佣金（%）',
        'RFBS在 1501卢布~5000卢布佣金（%）', 'RFBS <= 1500卢布佣金（%）', 'RFBS > 5000卢布佣金（%）',
        '30天内的销售额(卢布)', '销售动态(%)', '30天内的销量(件)', '平均价格(卢布)',
        '已错过销售(卢布)', '成交率（%）', '商品可用性(%)',
        '平均日销售额(卢布)', '平均日销量(件)',
        '卖家类型', '配送时间（天）',
        '商品体积（升）', '包装长(mm)', '包装宽(mm)', '包装高(mm)', '包装重量(g)',
        '在搜索结果和目录中的浏览量', '商品卡片浏览量',
        '从搜索结果和目录中加入购物车(%)', '从商品卡片添加至购物车(%)',
        '广告费用份额（%）',
        '跟卖者数量', '最低跟卖价',
        '商品创建日期'
    ];

    // ===== 数据收集器类 =====
    class SmartProductCollector {
        constructor() {
            this.validatedProducts = new Map();     // 已验证的完整商品数据
            this.pendingProducts = new Map();       // 待验证的商品
            this.elementContentMap = new Map();     // DOM元素内容哈希映射
            this.elementProductMap = new Map();     // DOM元素到商品的映射
            this.observer = null;                   // MutationObserver实例
            this.isRunning = false;
            this.scrollCount = 0;
            this.noChangeCount = 0;
            this.stats = {
                collected: 0,
                validated: 0,
                invalidated: 0,
                bangMatched: 0,
                contentChanges: 0
            };
        }

        // 生成商品唯一指纹（不依赖data-index）
        generateProductFingerprint(element) {
            // 优先使用商品链接
            const link = element.querySelector('a[href*="/product/"]');
            if (link && link.href) {
                const match = link.href.match(/product\/([^\/\?]+)/);
                if (match && match[1]) {
                    return `product_${match[1]}`;
                }
            }

            // 备用方案：组合多个特征
            const title = this.extractProductTitle(element);
            const price = this.extractPrice(element);
            const image = element.querySelector('img:not(.ozon-bang-img)')?.src || '';
            const imageId = image ? image.split('/').pop().split('.')[0] : '';

            // 生成组合指纹
            const fingerprint = `${title.substring(0, 30)}_${price}_${imageId}`;
            return fingerprint.replace(/[^\w\u4e00-\u9fa5]/g, '_');
        }

        // 获取元素内容哈希（用于检测内容变化）
        getElementContentHash(element) {
            const link = element.querySelector('a[href*="/product/"]')?.href || '';
            const image = element.querySelector('img:not(.ozon-bang-img)')?.src || '';
            const title = element.querySelector('span.tsBody500Medium, span[class*="tsBody"]')?.textContent || '';
            const price = element.querySelector('[class*="price"] span')?.textContent || '';

            return `${link}|${image}|${title}|${price}`;
        }

        // 检测元素内容是否变化
        detectContentChange(element) {
            const currentHash = this.getElementContentHash(element);
            const previousHash = this.elementContentMap.get(element);

            if (previousHash && previousHash !== currentHash) {
                this.stats.contentChanges++;
                return true;
            }

            this.elementContentMap.set(element, currentHash);
            return false;
        }

        // 提取商品基础信息（适配42个字段）
        extractCompleteProductData(element) {
            const data = {};

            try {
                // 1. 基础信息
                data['类目链接'] = window.location.href;

                // 商品链接和ID - 修复：确保从URL末尾提取正确的商品ID
                const link = element.querySelector('a[href*="/product/"]');
                if (link) {
                    data['商品链接'] = link.href;
                    // 从URL末尾提取商品ID（格式：/product/name-ID/或/product/name-ID?params）
                    const urlParts = link.href.split('/product/');
                    if (urlParts.length > 1) {
                        // 提取路径部分，去除查询参数
                        const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');
                        // 提取最后的数字ID（通常在最后一个连字符后）
                        const lastDashIndex = pathPart.lastIndexOf('-');
                        if (lastDashIndex !== -1) {
                            const potentialId = pathPart.substring(lastDashIndex + 1);
                            // 验证是否为纯数字且长度合理（通常6位以上）
                            if (/^\d{6,}$/.test(potentialId)) {
                                data['商品ID'] = potentialId;
                            } else {
                                data['商品ID'] = '-';
                            }
                        } else {
                            data['商品ID'] = '-';
                        }
                    } else {
                        data['商品ID'] = '-';
                    }
                } else {
                    data['商品链接'] = '-';
                    data['商品ID'] = '-';
                }

                // 商品名称
                data['商品名称'] = this.extractProductTitle(element);

                // 商品图片
                const img = element.querySelector('img:not(.ozon-bang-img)');
                data['商品图片'] = img ? img.src : '-';

                // 价格信息
                data['销售价格'] = this.extractPrice(element) || '-';
                data['原价'] = this.extractOriginalPrice(element) || '-';

                // 评分和评价
                const rating = element.querySelector('[class*="rating"], [class*="star"]')?.textContent || '';
                data['商品评分'] = rating ? rating.replace(/[^\d.]/g, '') : '-';
                const reviews = element.querySelector('[class*="review"]')?.textContent || '';
                data['评价次数'] = reviews ? reviews.replace(/[^\d]/g, '') : '-';

                // 送达时间
                const delivery = element.querySelector('[class*="delivery"], [class*="shipping"]')?.textContent || '';
                data['预计送达时间'] = delivery || '-';

                // 2. 从上品帮注入数据中提取
                const bangData = this.extractBangData(element);

                // 品牌和类目
                data['品牌'] = bangData['品牌'] || '-';
                data['商品类目'] = bangData['商品类目'] || '-';

                // 佣金信息
                data['FBP在 1501卢布~5000卢布佣金（%）'] = bangData['FBP在 1501卢布~5000卢布佣金（%）'] || '-';
                data['FBP <= 1500卢布佣金（%）'] = bangData['FBP <= 1500卢布佣金（%）'] || '-';
                data['FBP > 5000卢布佣金（%）'] = bangData['FBP > 5000卢布佣金（%）'] || '-';
                data['RFBS在 1501卢布~5000卢布佣金（%）'] = bangData['RFBS在 1501卢布~5000卢布佣金（%）'] || '-';
                data['RFBS <= 1500卢布佣金（%）'] = bangData['RFBS <= 1500卢布佣金（%）'] || '-';
                data['RFBS > 5000卢布佣金（%）'] = bangData['RFBS > 5000卢布佣金（%）'] || '-';

                // 销售数据
                data['30天内的销售额(卢布)'] = bangData['30天内的销售额(卢布)'] || '-';
                data['销售动态(%)'] = bangData['销售动态(%)'] || '-';
                data['30天内的销量(件)'] = bangData['30天内的销量(件)'] || '-';
                data['平均价格(卢布)'] = bangData['平均价格(卢布)'] || '-';
                data['已错过销售(卢布)'] = bangData['已错过销售(卢布)'] || '-';
                data['成交率（%）'] = bangData['成交率（%）'] || '-';
                data['商品可用性(%)'] = bangData['商品可用性(%)'] || '-';
                data['平均日销售额(卢布)'] = bangData['平均日销售额(卢布)'] || '-';
                data['平均日销量(件)'] = bangData['平均日销量(件)'] || '-';

                // 卖家信息
                data['卖家类型'] = bangData['卖家类型'] || '-';
                data['配送时间（天）'] = bangData['配送时间（天）'] || '-';

                // 商品规格
                data['商品体积（升）'] = bangData['商品体积（升）'] || '-';
                data['包装长(mm)'] = bangData['包装长(mm)'] || '-';
                data['包装宽(mm)'] = bangData['包装宽(mm)'] || '-';
                data['包装高(mm)'] = bangData['包装高(mm)'] || '-';
                data['包装重量(g)'] = bangData['包装重量(g)'] || '-';

                // 流量数据
                data['在搜索结果和目录中的浏览量'] = bangData['在搜索结果和目录中的浏览量'] || '-';
                data['商品卡片浏览量'] = bangData['商品卡片浏览量'] || '-';
                data['从搜索结果和目录中加入购物车(%)'] = bangData['从搜索结果和目录中加入购物车(%)'] || '-';
                data['从商品卡片添加至购物车(%)'] = bangData['从商品卡片添加至购物车(%)'] || '-';
                data['广告费用份额（%）'] = bangData['广告费用份额（%）'] || '-';

                // 跟卖者信息
                data['跟卖者数量'] = bangData['跟卖者数量'] || '-';
                data['最低跟卖价'] = bangData['最低跟卖价'] || '-';

                // 商品创建日期
                data['商品创建日期'] = bangData['商品创建日期'] || '-';

            } catch (error) {
                console.error('提取数据失败:', error);
            }

            // 3. 处理所有空值和特殊值
            CSV_HEADERS.forEach(header => {
                if (!data[header] ||
                    data[header] === '' ||
                    data[header] === '无数据' ||
                    data[header] === '非热销,无数据' ||
                    (typeof data[header] === 'string' && data[header].includes('非热销'))) {
                    data[header] = '-';
                }
            });

            // 确保类目链接不为空
            if (!data['类目链接'] || data['类目链接'] === '-') {
                data['类目链接'] = window.location.href;
            }

            return data;
        }

        // 提取上品帮注入的数据
        extractBangData(element) {
            const bangData = {};

            try {
                const bangElement = element.querySelector('.ozon-bang-item, [class*="ozon-bang"]');
                if (!bangElement) return bangData;

                // 从上品帮注入的文本中解析数据
                const bangText = bangElement.textContent || '';

                // 调试：显示原始数据的前100个字符
                if (bangText.length > 0) {
                    console.log('上品帮原始数据预览:', bangText.substring(0, 100) + '...');
                }

                // 首先提取品牌（通常在第一行或在"品牌："后面）
                // 品牌可能在开头直接显示，或在"品牌："后面
                const firstLine = bangText.split(/[rF]/)[0].trim();
                if (firstLine && !firstLine.includes('：') && !firstLine.includes('%') && firstLine.length < 50) {
                    bangData['品牌'] = firstLine;
                } else {
                    const brandMatch = bangText.match(/品牌[：:]\s*([^r\n]+?)(?:rFBS|FBP|$)/);
                    if (brandMatch) bangData['品牌'] = brandMatch[1].trim();
                }

                // 解析类目（在"小百货和配饰 > 腕表"这样的格式中）
                const categoryMatch = bangText.match(/([^\n>]+>\s*[^\n]+?)(?:品牌|rFBS|FBP|$)/);
                if (categoryMatch && categoryMatch[1].includes('>')) {
                    bangData['商品类目'] = categoryMatch[1].trim();
                }

                // 解析佣金率 - 更精确的匹配
                const rfbs1Match = bangText.match(/rFBS佣金\(1501~5000₽\)[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (rfbs1Match) bangData['RFBS在 1501卢布~5000卢布佣金（%）'] = rfbs1Match[1];

                const rfbs2Match = bangText.match(/rFBS佣金\(<=1500₽\)[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (rfbs2Match) bangData['RFBS <= 1500卢布佣金（%）'] = rfbs2Match[1];

                const rfbs3Match = bangText.match(/rFBS佣金\(>5000₽\)[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (rfbs3Match) bangData['RFBS > 5000卢布佣金（%）'] = rfbs3Match[1];

                const fbp1Match = bangText.match(/FBP佣金\(1501~5000₽\)[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (fbp1Match) bangData['FBP在 1501卢布~5000卢布佣金（%）'] = fbp1Match[1];

                const fbp2Match = bangText.match(/FBP佣金\(<=1500₽\)[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (fbp2Match) bangData['FBP <= 1500卢布佣金（%）'] = fbp2Match[1];

                const fbp3Match = bangText.match(/FBP佣金\(>5000₽\)[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (fbp3Match) bangData['FBP > 5000卢布佣金（%）'] = fbp3Match[1];

                // 解析销售数据
                const monthSalesMatch = bangText.match(/月销量[：:]\s*(\d+(?:\.\d+)?)\s*件/);
                if (monthSalesMatch) bangData['30天内的销量(件)'] = monthSalesMatch[1];

                const monthRevenueMatch = bangText.match(/月销售额[：:]\s*([\d.]+)\s*万?\s*₽/);
                if (monthRevenueMatch) {
                    const value = monthRevenueMatch[1];
                    // 如果包含"万"，需要转换
                    if (bangText.includes('万 ₽') || bangText.includes('万₽')) {
                        bangData['30天内的销售额(卢布)'] = (parseFloat(value) * 10000).toString();
                    } else {
                        bangData['30天内的销售额(卢布)'] = value;
                    }
                }

                const daySalesMatch = bangText.match(/日销量[：:]\s*(\d+(?:\.\d+)?)\s*件/);
                if (daySalesMatch) bangData['平均日销量(件)'] = daySalesMatch[1];

                const dayRevenueMatch = bangText.match(/日销售额[：:]\s*([\d.]+)\s*₽/);
                if (dayRevenueMatch) bangData['平均日销售额(卢布)'] = dayRevenueMatch[1];

                const salesDynamicMatch = bangText.match(/月销售动态[：:]\s*([-\d.]+)\s*%/);
                if (salesDynamicMatch) bangData['销售动态(%)'] = salesDynamicMatch[1];

                // 解析流量数据
                const cardViewsMatch = bangText.match(/商品卡片浏览量[：:]\s*(\d+)/);
                if (cardViewsMatch) bangData['商品卡片浏览量'] = cardViewsMatch[1];

                const cardCartRateMatch = bangText.match(/商品卡片加购率[：:]\s*([\d.]+)\s*%/);
                if (cardCartRateMatch) bangData['从商品卡片添加至购物车(%)'] = cardCartRateMatch[1];

                const searchViewsMatch = bangText.match(/搜索和目录浏览量[：:]\s*(\d+)/);
                if (searchViewsMatch) bangData['在搜索结果和目录中的浏览量'] = searchViewsMatch[1];

                const searchCartRateMatch = bangText.match(/搜索和目录加购率[：:]\s*([\d.]+)\s*%/);
                if (searchCartRateMatch) bangData['从搜索结果和目录中加入购物车(%)'] = searchCartRateMatch[1];

                // 解析促销和广告数据
                const adShareMatch = bangText.match(/广告份额[：:]\s*([\d.]+)\s*%/);
                if (adShareMatch) bangData['广告费用份额（%）'] = adShareMatch[1];

                const conversionRateMatch = bangText.match(/成交率[：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (conversionRateMatch) bangData['成交率（%）'] = conversionRateMatch[1];

                const avgPriceMatch = bangText.match(/平均价格[：:]\s*([\d.]+)\s*₽/);
                if (avgPriceMatch) bangData['平均价格(卢布)'] = avgPriceMatch[1];

                // 解析包装信息
                const weightMatch = bangText.match(/包装重量[：:]\s*(\d+(?:\.\d+)?)\s*g/);
                if (weightMatch) bangData['包装重量(g)'] = weightMatch[1];

                const dimensionsMatch = bangText.match(/长宽高\(mm\)[：:]\s*(\d+)\s*\*\s*(\d+)\s*\*\s*(\d+)/);
                if (dimensionsMatch) {
                    bangData['包装长(mm)'] = dimensionsMatch[1];
                    bangData['包装宽(mm)'] = dimensionsMatch[2];
                    bangData['包装高(mm)'] = dimensionsMatch[3];
                }

                // 解析卖家类型
                const sellerTypeMatch = bangText.match(/卖家类型[：:]\s*([A-Z]+)/);
                if (sellerTypeMatch) bangData['卖家类型'] = sellerTypeMatch[1];

                // 解析跟卖者信息
                const followSellersMatch = bangText.match(/跟卖者[：:]\s*([^>]+)>\s*跟卖最低价[：:]\s*([\d\s,]+)\s*₽/);
                if (followSellersMatch) {
                    // 提取跟卖者数量
                    const sellersText = followSellersMatch[1];
                    const numMatch = sellersText.match(/(\d+)个卖家/);
                    if (numMatch) {
                        bangData['跟卖者数量'] = numMatch[1];
                    }
                    // 提取最低价
                    bangData['最低跟卖价'] = followSellersMatch[2].replace(/\s/g, '');
                }

                // 解析商品创建日期
                const createDateMatch = bangText.match(/商品上架时间[：:]\s*(\d{4}-\d{2}-\d{2})/);
                if (createDateMatch) bangData['商品创建日期'] = createDateMatch[1];

                // 解析配送时间
                const deliveryTimeMatch = bangText.match(/配送时间[：:]\s*(\d+)\s*天/);
                if (deliveryTimeMatch) bangData['配送时间（天）'] = deliveryTimeMatch[1];

                // 解析可用性
                const availabilityMatch = bangText.match(/商品可用性[：:]\s*([\d.]+)\s*%/);
                if (availabilityMatch) bangData['商品可用性(%)'] = availabilityMatch[1];

                // 解析已错过销售
                const missedSalesMatch = bangText.match(/已错过销售[：:]\s*([\d.]+)\s*₽/);
                if (missedSalesMatch) bangData['已错过销售(卢布)'] = missedSalesMatch[1];

                // 解析商品体积
                const volumeMatch = bangText.match(/商品体积[：:]\s*([\d.]+)\s*升/);
                if (volumeMatch) bangData['商品体积（升）'] = volumeMatch[1];

                // 移除按钮文本
                const buttonsToRemove = ['一键上架', '编辑上架', '手动上架', '采集', '复制图片', '关键词反查'];
                buttonsToRemove.forEach(button => {
                    Object.keys(bangData).forEach(key => {
                        if (bangData[key] && typeof bangData[key] === 'string') {
                            bangData[key] = bangData[key].replace(button, '').trim();
                        }
                    });
                });

                // 调试：显示解析后的数据字段数量
                const fieldCount = Object.keys(bangData).length;
                if (fieldCount > 0) {
                    console.log(`成功解析 ${fieldCount} 个字段:`, Object.keys(bangData).join(', '));
                }

            } catch (error) {
                console.error('解析上品帮数据失败:', error);
            }

            return bangData;
        }

        // 提取商品标题
        extractProductTitle(element) {
            const selectors = [
                // Ozon最新的标题选择器
                'span.tsBody500Medium',
                'span.tsBodyM',
                'span[class*="tsBody"]:not(.ozon-bang-text):not([class*="Control"])',
                // 在商品链接内的span
                'a[href*="/product/"] span.tsBody500Medium',
                'a[href*="/product/"] span[class*="tsBody"]',
                // 其他可能的选择器
                '.tile-hover-target span',
                'div[class*="title"] span'
            ];

            for (const selector of selectors) {
                const titleElements = element.querySelectorAll(selector);
                for (const titleElement of titleElements) {
                    const text = titleElement.textContent.trim();
                    // 验证是否为商品标题（长度合理，不包含价格符号和百分比）
                    if (text && text.length > 5 && text.length < 500 &&
                        !text.includes('₽') && !text.includes('%') &&
                        !text.match(/^\d+$/) && // 排除纯数字
                        !text.match(/^\d+\s*(шт|г|мл|см|мм)$/)) { // 排除数量单位
                        return text;
                    }
                }
            }

            // 从链接的title属性提取
            const link = element.querySelector('a[href*="/product/"]');
            if (link && link.title) {
                return link.title.trim();
            }

            // 从img的alt属性提取
            const img = element.querySelector('img:not(.ozon-bang-img)');
            if (img && img.alt && img.alt.length > 5) {
                return img.alt.trim();
            }

            return '-';
        }

        // 提取价格
        extractPrice(element) {
            const priceSelectors = [
                // Ozon最新的价格选择器
                'span.tsHeadline500Medium',
                'span[class*="tsHeadline"][class*="500"]',
                // 价格容器内的span
                '.c35_3_8-a0 span.c35_3_8-a1:first-child',
                // 备用选择器
                'span[class*="price-main"] span',
                'span[class*="Price"] span',
                'div[class*="price"] span:first-child'
            ];

            for (const selector of priceSelectors) {
                const priceElement = element.querySelector(selector);
                if (priceElement) {
                    const priceText = priceElement.textContent;
                    // 过滤掉包含%的折扣文本
                    if (priceText.includes('%')) continue;
                    // 提取数字和空格
                    const cleanPrice = priceText.replace(/[^\d\s]/g, '').trim();
                    if (cleanPrice) {
                        // 格式化价格（添加空格分隔千位）
                        return cleanPrice + ' ₽';
                    }
                }
            }

            return '-';
        }

        // 提取原价
        extractOriginalPrice(element) {
            const originalPriceSelectors = [
                // Ozon新的原价选择器 - 通常是第二个价格span
                '.c35_3_8-a0 span.c35_3_8-a1.tsBodyControl400Small',
                'span.tsBodyControl400Small.c35_3_8-b',
                // 删除线价格
                'span[style*="text-decoration"][style*="line-through"]',
                'del span',
                // 备用选择器
                'span[class*="price"] span:nth-child(2)'
            ];

            for (const selector of originalPriceSelectors) {
                const priceElement = element.querySelector(selector);
                if (priceElement) {
                    const priceText = priceElement.textContent;
                    // 过滤掉包含%的折扣文本
                    if (priceText.includes('%')) continue;
                    // 提取数字和空格
                    const cleanPrice = priceText.replace(/[^\d\s]/g, '').trim();
                    if (cleanPrice) {
                        return cleanPrice + ' ₽';
                    }
                }
            }

            return '-';
        }

        // 等待上品帮注入
        async waitForBangInjection(element, maxWait = CONFIG.bangInjectionWait) {
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
                const hasBang = element.querySelector('.ozon-bang-item, [class*="ozon-bang"]');
                if (hasBang) {
                    return true;
                }
                await this.sleep(100);
            }

            return false;
        }

        // 收集单个商品的完整数据
        async collectSingleProduct(element) {
            const contentChanged = this.detectContentChange(element);
            const fingerprint = this.generateProductFingerprint(element);

            // 如果已经收集过且内容未变化，跳过
            if (!contentChanged && this.validatedProducts.has(fingerprint)) {
                return null;
            }

            // 等待上品帮数据
            await this.waitForBangInjection(element);

            // 提取完整数据
            const completeProduct = this.extractCompleteProductData(element);
            completeProduct.fingerprint = fingerprint;
            completeProduct.collectedAt = new Date().toISOString();

            // 保存数据
            this.validatedProducts.set(fingerprint, completeProduct);
            this.elementProductMap.set(element, fingerprint);
            this.stats.collected = this.validatedProducts.size;

            return completeProduct;
        }

        // 批量收集可见商品
        async collectVisibleProducts() {
            // 同时检查两种情况：带上品帮标记的和所有商品
            const withBangMark = document.querySelectorAll('.tile-root[data-ozon-bang="true"]');
            const allTileRoots = document.querySelectorAll('.tile-root');

            const newProducts = [];
            const processedFingerprints = new Set();

            // 先处理已注入的
            for (const element of withBangMark) {
                try {
                    const fingerprint = this.generateProductFingerprint(element);
                    if (!processedFingerprints.has(fingerprint)) {
                        processedFingerprints.add(fingerprint);
                        const product = await this.collectSingleProduct(element);
                        if (product) {
                            newProducts.push(product);
                        }
                    }
                } catch (error) {
                    console.error('收集商品失败:', error);
                }
            }

            // 如果注入不完整，也尝试收集未注入的
            if (withBangMark.length < allTileRoots.length) {
                for (const element of allTileRoots) {
                    try {
                        const fingerprint = this.generateProductFingerprint(element);
                        if (processedFingerprints.has(fingerprint)) continue;
                        if (this.validatedProducts.has(fingerprint)) continue;

                        // 收集基础信息
                        const completeProduct = this.extractCompleteProductData(element);
                        completeProduct.fingerprint = fingerprint;
                        completeProduct.collectedAt = new Date().toISOString();

                        this.validatedProducts.set(fingerprint, completeProduct);
                        this.elementProductMap.set(element, fingerprint);
                        this.stats.collected = this.validatedProducts.size;
                        newProducts.push(completeProduct);
                    } catch (error) {
                        console.error('收集商品失败:', error);
                    }
                }
            }

            return newProducts;
        }

        // 工具函数：休眠
        sleep(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        // 获取统计信息
        getStats() {
            return {
                ...this.stats,
                products: Array.from(this.validatedProducts.values())
            };
        }

        // 清空数据
        clear() {
            this.validatedProducts.clear();
            this.pendingProducts.clear();
            this.elementContentMap.clear();
            this.elementProductMap.clear();
            this.scrollCount = 0;
            this.noChangeCount = 0;
            this.stats = {
                collected: 0,
                validated: 0,
                invalidated: 0,
                bangMatched: 0,
                contentChanges: 0
            };
        }
    }

    // ===== UI控制面板 =====
    class ControlPanel {
        constructor(collector) {
            this.collector = collector;
            this.panel = null;
            this.createPanel();
        }

        createPanel() {
            this.panel = document.createElement('div');
            this.panel.id = 'ozon-selector-panel';
            this.panel.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 20px;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                min-width: 360px;
                max-width: 400px;
            `;

            this.panel.innerHTML = `
                <h3 style="margin: 0 0 15px 0; font-size: 18px;">
                    🎯 Ozon选品助手
                </h3>

                <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="margin-bottom: 12px;">
                        <label style="display: block; margin-bottom: 5px; font-size: 12px; opacity: 0.9;">
                            目标商品数量:
                        </label>
                        <input type="number" id="target-count" value="${CONFIG.targetProductCount}"
                               min="10" max="500"
                               style="width: 100%; padding: 8px; border: none; border-radius: 4px;
                                      background: rgba(255,255,255,0.9); color: #333; font-size: 14px;">
                    </div>
                    <div style="display: flex; gap: 10px;">
                        <button id="start-btn" style="flex: 1; padding: 10px; border: none;
                                border-radius: 6px; background: #48bb78; color: white;
                                font-weight: bold; cursor: pointer; transition: all 0.3s;">
                            🚀 开始收集
                        </button>
                        <button id="stop-btn" style="flex: 1; padding: 10px; border: none;
                                border-radius: 6px; background: #f56565; color: white;
                                font-weight: bold; cursor: pointer; transition: all 0.3s;"
                                disabled>
                            ⏸️ 停止
                        </button>
                    </div>
                </div>

                <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
                    <h4 style="margin: 0 0 10px 0; font-size: 14px; opacity: 0.9;">📊 实时统计</h4>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 12px;">
                        <div>✅ 已收集: <span id="collected" style="font-weight: bold;">0</span></div>
                        <div>📦 页面商品: <span id="page-count" style="font-weight: bold;">0</span></div>
                        <div>💉 已注入: <span id="injected" style="font-weight: bold;">0</span></div>
                        <div>🔄 滚动次数: <span id="scroll-count" style="font-weight: bold;">0</span></div>
                    </div>
                    <div style="margin-top: 12px;">
                        <div style="background: rgba(255,255,255,0.2); height: 22px; border-radius: 11px; overflow: hidden;">
                            <div id="progress-bar" style="background: linear-gradient(90deg, #48bb78, #68d391);
                                    height: 100%; width: 0%; transition: width 0.3s; display: flex;
                                    align-items: center; justify-content: center; font-size: 11px;">
                                <span id="progress-text" style="color: white; font-weight: bold;">0%</span>
                            </div>
                        </div>
                    </div>
                    <div id="status" style="margin-top: 10px; font-size: 12px; opacity: 0.9;
                             min-height: 20px; text-align: center;">
                        ⏳ 等待开始...
                    </div>
                </div>

                <div style="display: flex; gap: 10px;">
                    <button id="export-btn" style="flex: 1; padding: 8px; border: none;
                            border-radius: 6px; background: rgba(255,255,255,0.2);
                            color: white; font-size: 12px; cursor: pointer; transition: all 0.3s;">
                        📥 导出CSV
                    </button>
                    <button id="clear-btn" style="flex: 1; padding: 8px; border: none;
                            border-radius: 6px; background: rgba(255,255,255,0.2);
                            color: white; font-size: 12px; cursor: pointer; transition: all 0.3s;">
                        🗑️ 清空
                    </button>
                </div>
            `;

            document.body.appendChild(this.panel);
            this.bindEvents();
            this.addHoverEffects();
        }

        bindEvents() {
            document.getElementById('start-btn').onclick = () => this.startCollection();
            document.getElementById('stop-btn').onclick = () => this.stopCollection();
            document.getElementById('export-btn').onclick = () => this.exportData();
            document.getElementById('clear-btn').onclick = () => this.clearData();
        }

        addHoverEffects() {
            this.panel.querySelectorAll('button').forEach(btn => {
                btn.onmouseenter = () => {
                    btn.style.transform = 'scale(1.05)';
                    btn.style.boxShadow = '0 4px 12px rgba(0,0,0,0.2)';
                };
                btn.onmouseleave = () => {
                    btn.style.transform = 'scale(1)';
                    btn.style.boxShadow = 'none';
                };
            });
        }

        async startCollection() {
            if (this.collector.isRunning) return;

            this.collector.isRunning = true;
            this.collector.clear();

            const targetCount = parseInt(document.getElementById('target-count').value) || CONFIG.targetProductCount;

            // 更新UI
            document.getElementById('start-btn').disabled = true;
            document.getElementById('stop-btn').disabled = false;
            this.updateStatus(`🚀 开始收集，目标: ${targetCount} 个商品`);

            // 开始收集流程
            await this.runCollection(targetCount);
        }

        async runCollection(targetCount) {
            // 首次收集
            await this.collector.collectVisibleProducts();
            this.updateStats();

            let lastCollectedCount = this.collector.validatedProducts.size;
            let sameCountTimes = 0;
            let forceScrollCount = 0;

            // 自动滚动收集
            while (this.collector.isRunning && this.collector.scrollCount < CONFIG.maxScrollAttempts) {
                this.collector.scrollCount++;

                // 检查是否达到目标
                if (this.collector.validatedProducts.size >= targetCount) {
                    this.updateStatus(`✅ 成功收集 ${this.collector.validatedProducts.size} 个商品！`);
                    this.stopCollection();
                    return;
                }

                // 获取当前页面状态
                const currentScroll = window.scrollY;
                const pageHeight = document.body.scrollHeight;
                const viewportHeight = window.innerHeight;
                const isNearBottom = currentScroll + viewportHeight >= pageHeight - 100;

                // 智能滚动策略
                let scrollDistance;
                if (isNearBottom) {
                    scrollDistance = pageHeight - currentScroll;
                    this.updateStatus(`📍 滚动到底部触发加载...`);
                } else {
                    scrollDistance = viewportHeight * CONFIG.scrollStepSize;
                    this.updateStatus(`🔄 滚动 #${this.collector.scrollCount}，等待加载...`);
                }

                // 执行滚动
                window.scrollTo({
                    top: currentScroll + scrollDistance,
                    behavior: 'smooth'
                });

                // 等待DOM更新和上品帮注入
                await this.collector.sleep(CONFIG.scrollWaitTime);

                if (isNearBottom) {
                    await this.collector.sleep(1000);
                }

                // 收集新商品
                const beforeCount = this.collector.validatedProducts.size;
                const newProducts = await this.collector.collectVisibleProducts();
                const afterCount = this.collector.validatedProducts.size;
                const actualNewCount = afterCount - beforeCount;

                if (actualNewCount === 0) {
                    this.collector.noChangeCount++;

                    if (afterCount === lastCollectedCount) {
                        sameCountTimes++;

                        if (sameCountTimes >= 3 && afterCount < targetCount) {
                            forceScrollCount++;

                            if (forceScrollCount <= 3) {
                                this.updateStatus(`⚡ 强制滚动以加载更多内容 (${forceScrollCount}/3)`);
                                window.scrollTo(0, document.body.scrollHeight);
                                await this.collector.sleep(3000);

                                const newPageHeight = document.body.scrollHeight;
                                if (newPageHeight > pageHeight) {
                                    this.updateStatus(`✨ 检测到新内容，页面高度增加`);
                                    sameCountTimes = 0;
                                    this.collector.noChangeCount = 0;
                                    continue;
                                }
                            } else {
                                this.updateStatus(`⚠️ 已尝试多次，可能已无更多商品（当前: ${afterCount}/${targetCount}）`);

                                if (afterCount > 0) {
                                    const shouldContinue = confirm(`当前已收集 ${afterCount} 个商品，未达到目标 ${targetCount}。\n是否继续尝试？`);
                                    if (!shouldContinue) {
                                        this.stopCollection();
                                        return;
                                    } else {
                                        forceScrollCount = 0;
                                        sameCountTimes = 0;
                                    }
                                }
                            }
                        }
                    } else {
                        sameCountTimes = 0;
                    }

                    if (this.collector.noChangeCount >= CONFIG.noChangeThreshold * 2) {
                        this.updateStatus(`⚠️ 长时间无新商品，停止收集（当前: ${afterCount}/${targetCount}）`);
                        this.stopCollection();
                        return;
                    }
                } else {
                    this.collector.noChangeCount = 0;
                    sameCountTimes = 0;
                    forceScrollCount = 0;
                    lastCollectedCount = afterCount;
                    this.updateStatus(`📦 新增 ${actualNewCount} 个商品，总计: ${afterCount}/${targetCount}`);
                }

                this.updateStats();

                // 动态调整滚动速度
                if (actualNewCount > 5) {
                    CONFIG.scrollStepSize = Math.min(CONFIG.scrollStepSize * 1.1, 2);
                } else if (actualNewCount === 0) {
                    CONFIG.scrollStepSize = Math.max(CONFIG.scrollStepSize * 0.9, 0.8);
                }
            }

            this.updateStatus(`⚠️ 达到最大滚动次数`);
            this.stopCollection();
        }

        stopCollection() {
            this.collector.isRunning = false;
            document.getElementById('start-btn').disabled = false;
            document.getElementById('stop-btn').disabled = true;
            this.updateStats();
        }

        updateStats() {
            const stats = this.collector.getStats();
            const targetCount = parseInt(document.getElementById('target-count').value) || CONFIG.targetProductCount;
            const progress = Math.min((stats.collected / targetCount) * 100, 100);

            document.getElementById('collected').textContent = stats.collected;
            document.getElementById('page-count').textContent = document.querySelectorAll('.tile-root').length;
            document.getElementById('injected').textContent = document.querySelectorAll('[data-ozon-bang="true"]').length;
            document.getElementById('scroll-count').textContent = this.collector.scrollCount;

            // 进度条
            const progressBar = document.getElementById('progress-bar');
            progressBar.style.width = `${progress}%`;
            document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
        }

        updateStatus(message) {
            document.getElementById('status').textContent = message;
            console.log(`[选品助手] ${message}`);
        }

        exportData() {
            const stats = this.collector.getStats();
            if (stats.products.length === 0) {
                alert('没有数据可导出');
                return;
            }

            // 转换为CSV
            let csv = '\ufeff' + CSV_HEADERS.join(',') + '\n';

            stats.products.forEach(product => {
                const row = CSV_HEADERS.map(header => {
                    let value = product[header] || '-';
                    // 处理包含逗号、引号或换行的值
                    if (value.toString().includes(',') || value.toString().includes('"') || value.toString().includes('\n')) {
                        value = '"' + value.toString().replace(/"/g, '""') + '"';
                    }
                    return value;
                });
                csv += row.join(',') + '\n';
            });

            // 下载
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;

            // 生成文件名
            const now = new Date();
            const timestamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
            a.download = `ozon_products_${timestamp}.csv`;

            a.click();
            URL.revokeObjectURL(url);

            this.updateStatus(`✅ 已导出 ${stats.products.length} 个商品`);
        }

        clearData() {
            if (confirm('确定要清空所有数据吗？')) {
                this.collector.clear();
                this.updateStats();
                this.updateStatus('📭 数据已清空');
            }
        }

        destroy() {
            this.collector.destroy();
            this.panel?.remove();
        }
    }

    // ===== 初始化 =====
    let collector = null;
    let panel = null;

    function init() {
        console.log('🎯 Ozon选品助手正在启动...');

        setTimeout(() => {
            collector = new SmartProductCollector();
            panel = new ControlPanel(collector);

            console.log('✅ Ozon选品助手已就绪！');
        }, 2000);
    }

    // 启动
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // 清理
    window.addEventListener('beforeunload', () => {
        collector?.destroy();
        panel?.destroy();
    });

})();