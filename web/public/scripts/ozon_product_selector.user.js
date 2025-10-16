// ==UserScript==
// @name         Ozon选品助手
// @namespace    http://euraflow.local/
// @version      4.7
// @description  智能采集Ozon商品数据，完全适配虚拟滚动机制，支持多语言页面，确保佣金数据完整，可配置滚动延迟防反爬虫，使用纯数字SKU作为唯一标识
// @author       EuraFlow Team
// @match        https://www.ozon.ru/*
// @grant        GM_xmlhttpRequest
// @connect      localhost
// @connect      local.euraflow.com
// @connect      ozon.gxfc.life
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // ===== 全局配置 =====
    const CONFIG = {
        virtualScrollIndexes: 12,        // 索引0-11循环使用
        visibleWindowMin: 8,             // 最小可见窗口
        visibleWindowMax: 12,            // 最大可见窗口
        scrollStepSize: 0.5,             // 每次滚动视口倍数（0.5 = 半个屏幕高度）
        scrollWaitTime: 1000,            // 滚动后等待时间（优化：1秒）
        scrollDelay: 5000,               // 每两次滚动之间的延迟（默认5秒，防反爬虫）
        bangInjectionWait: 2000,         // 等待上品帮注入时间（优化：2秒，200ms×10次）
        bangCheckInterval: 200,          // 数据注入检查间隔（200ms）
        maxScrollAttempts: 200,          // 最大滚动次数
        noChangeThreshold: 5,            // 无变化阈值
        forceScrollThreshold: 3,         // 强制滚动阈值
        targetProductCount: 100,         // 默认目标商品数
        contentChangeDetection: true,    // 启用内容变化检测
        dataValidation: true,            // 启用数据验证
        debugMode: false,                // 调试模式

        // API上传配置（从localStorage读取）
        apiEnabled: true,                // 是否启用API上传（默认开启）
        apiUrl: '',                      // API地址
        apiKey: '',                      // API Key
        autoUpload: true                 // 自动上传（采集完成后，默认开启）
    };

    // GM_xmlhttpRequest 的 Promise 包装器（绕过 CSP 限制）
    function gmFetch(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                data: options.body || null,
                onload: function(response) {
                    // 模拟 fetch Response 对象
                    const mockResponse = {
                        ok: response.status >= 200 && response.status < 300,
                        status: response.status,
                        statusText: response.statusText,
                        headers: response.responseHeaders,
                        async json() {
                            try {
                                return JSON.parse(response.responseText);
                            } catch (e) {
                                throw new Error('Invalid JSON response');
                            }
                        },
                        async text() {
                            return response.responseText;
                        }
                    };
                    resolve(mockResponse);
                },
                onerror: function(error) {
                    reject(new Error(`Network request failed: ${error.statusText || 'Unknown error'}`));
                },
                ontimeout: function() {
                    reject(new Error('Request timeout'));
                }
            });
        });
    }

    // 从localStorage加载API配置
    function loadAPIConfig() {
        try {
            const savedConfig = localStorage.getItem('ozon_selector_api_config');
            if (savedConfig) {
                const parsed = JSON.parse(savedConfig);
                CONFIG.apiEnabled = parsed.apiEnabled || false;
                CONFIG.apiUrl = parsed.apiUrl || '';
                CONFIG.apiKey = parsed.apiKey || '';
                CONFIG.autoUpload = parsed.autoUpload || false;
            }
        } catch (e) {
            console.error('加载API配置失败:', e);
        }
    }

    // 保存API配置到localStorage
    function saveAPIConfig() {
        try {
            const config = {
                apiEnabled: CONFIG.apiEnabled,
                apiUrl: CONFIG.apiUrl,
                apiKey: CONFIG.apiKey,
                autoUpload: CONFIG.autoUpload
            };
            localStorage.setItem('ozon_selector_api_config', JSON.stringify(config));
        } catch (e) {
            console.error('保存API配置失败:', e);
        }
    }

    // 初始化时加载配置
    loadAPIConfig();

    // ===== CSV数据字段（42个字段）=====
    const CSV_HEADERS = [
        '类目链接', '商品名称', '商品ID', '商品链接', '商品图片',
        '预计送达时间', '商品评分', '评价次数', '销售价格', '原价',
        '品牌', '商品类目',
        'FBP在 1501~5000佣金（%）', 'FBP <= 1500佣金（%）', 'FBP > 5000佣金（%）',
        'RFBS在 1501~5000佣金（%）', 'RFBS <= 1500佣金（%）', 'RFBS > 5000佣金（%）',
        '30天内的销售额', '销售动态(%)', '30天内的销量(件)', '平均价格',
        '已错过销售', '成交率（%）', '商品可用性(%)',
        '平均日销售额', '平均日销量(件)',
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
            this.uploadedFingerprints = new Set();  // 已上传商品指纹（跨会话保持，刷新页面清空）
            this.pendingProducts = new Map();       // 待验证的商品
            this.elementContentMap = new Map();     // DOM元素内容哈希映射
            this.elementProductMap = new Map();     // DOM元素到商品的映射
            this.observer = null;                   // MutationObserver实例
            this.isRunning = false;
            this.scrollCount = 0;
            this.noChangeCount = 0;
            this.detectedCurrency = null;           // 检测到的货币单位（全局复用）
            this.stats = {
                collected: 0,
                validated: 0,
                invalidated: 0,
                bangMatched: 0,
                contentChanges: 0
            };
        }

        // 提取商品SKU（纯数字，OZON全站唯一标识）
        extractProductSKU(element) {
            const link = element.querySelector('a[href*="/product/"]');
            if (!link || !link.href) {
                return null;
            }

            // 从URL末尾提取SKU（格式：/product/name-SKU/或/product/name-SKU?params）
            const urlParts = link.href.split('/product/');
            if (urlParts.length <= 1) {
                return null;
            }

            // 提取路径部分，去除查询参数
            const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');

            // 提取最后的数字SKU（通常在最后一个连字符后）
            const lastDashIndex = pathPart.lastIndexOf('-');
            if (lastDashIndex === -1) {
                return null;
            }

            const potentialSKU = pathPart.substring(lastDashIndex + 1);

            // 验证是否为纯数字且长度合理（通常6位以上）
            if (/^\d{6,}$/.test(potentialSKU)) {
                return potentialSKU;
            }

            return null;
        }

        // 生成商品唯一指纹（使用SKU）
        generateProductFingerprint(element) {
            const sku = this.extractProductSKU(element);
            if (sku) {
                return `sku_${sku}`;  // 使用纯数字SKU作为指纹
            }
            return null;  // 无法提取SKU，返回null（该商品将被跳过）
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

                // 商品链接和SKU（使用统一的 SKU 提取方法）
                const link = element.querySelector('a[href*="/product/"]');
                if (link) {
                    data['商品链接'] = link.href;
                    // 使用统一的 SKU 提取方法
                    const sku = this.extractProductSKU(element);
                    data['商品ID'] = sku || '-';
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

                // 评分 - 查找包含 color: var(--textPremium) 样式的span
                const ratingSpans = element.querySelectorAll('span[style*="--textPremium"]');
                let foundRating = false;
                for (const span of ratingSpans) {
                    const text = span.textContent.trim();
                    // 匹配评分格式 (如: 4.3, 5.0)
                    if (/^\d+(\.\d+)?$/.test(text)) {
                        data['商品评分'] = text;
                        foundRating = true;
                        break;
                    }
                }
                if (!foundRating) {
                    data['商品评分'] = '-';
                }

                // 评价次数 - 查找包含 color: var(--textSecondary) 样式的span（语言无关）
                const reviewSpans = element.querySelectorAll('span[style*="--textSecondary"]');
                let foundReview = false;
                for (const span of reviewSpans) {
                    const text = span.textContent.trim();
                    // 提取纯数字（支持空格/逗号分隔，如 "9 860" 或 "9,860"）
                    const numbersOnly = text.replace(/[^\d]/g, '');
                    if (numbersOnly && numbersOnly.length > 0) {
                        const reviewCount = parseInt(numbersOnly);
                        // 验证：合理范围（1 到 10,000,000）且不包含小数点（排除评分）
                        if (reviewCount >= 1 && reviewCount <= 10000000 && !text.includes('.')) {
                            data['评价次数'] = numbersOnly;
                            foundReview = true;
                            break;
                        }
                    }
                }
                if (!foundReview) {
                    data['评价次数'] = '-';
                }

                // 送达时间
                const delivery = element.querySelector('[class*="delivery"], [class*="shipping"]')?.textContent || '';
                data['预计送达时间'] = delivery || '-';

                // 2. 从上品帮注入数据中提取
                const bangData = this.extractBangData(element);

                // 品牌和类目
                data['品牌'] = bangData['品牌'] || '-';
                data['商品类目'] = bangData['商品类目'] || '-';

                // 佣金信息
                data['FBP在 1501~5000佣金（%）'] = bangData['FBP在 1501~5000佣金（%）'] || '-';
                data['FBP <= 1500佣金（%）'] = bangData['FBP <= 1500佣金（%）'] || '-';
                data['FBP > 5000佣金（%）'] = bangData['FBP > 5000佣金（%）'] || '-';
                data['RFBS在 1501~5000佣金（%）'] = bangData['RFBS在 1501~5000佣金（%）'] || '-';
                data['RFBS <= 1500佣金（%）'] = bangData['RFBS <= 1500佣金（%）'] || '-';
                data['RFBS > 5000佣金（%）'] = bangData['RFBS > 5000佣金（%）'] || '-';

                // 销售数据
                data['30天内的销售额'] = bangData['30天内的销售额'] || '-';
                data['销售动态(%)'] = bangData['销售动态(%)'] || '-';
                data['30天内的销量(件)'] = bangData['30天内的销量(件)'] || '-';
                data['平均价格'] = bangData['平均价格'] || '-';
                data['已错过销售'] = bangData['已错过销售'] || '-';
                data['成交率（%）'] = bangData['成交率（%）'] || '-';
                data['商品可用性(%)'] = bangData['商品可用性(%)'] || '-';
                data['平均日销售额'] = bangData['平均日销售额'] || '-';
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
                // 错误处理：数据提取失败
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

                // 检查是否有实际内容（不只是空元素）
                if (!bangText.trim() || bangText.length < 10) {
                    return bangData; // 返回空对象，表示没有有效数据
                }

                // 调试：显示原始数据的前100个字符
                if (bangText.length > 0) {
                    // 已移除调试日志
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
                // 先尝试匹配"类目："后面的内容
                const categoryWithPrefixMatch = bangText.match(/类目[：:]\s*([^\n]+?)(?:品牌|rFBS|FBP|$)/);
                if (categoryWithPrefixMatch) {
                    bangData['商品类目'] = categoryWithPrefixMatch[1].trim();
                } else {
                    // 如果没有"类目："前缀，尝试直接匹配包含">"的格式
                    const categoryMatch = bangText.match(/([^\n>]+>\s*[^\n]+?)(?:品牌|rFBS|FBP|$)/);
                    if (categoryMatch && categoryMatch[1].includes('>')) {
                        // 移除可能的前缀文本如"设置 找货源"
                        let category = categoryMatch[1].trim();
                        category = category.replace(/^.*?类目[：:]\s*/, ''); // 移除"设置 找货源 类目："等前缀
                        category = category.replace(/^设置\s+找货源\s+/, ''); // 移除"设置 找货源"前缀
                        bangData['商品类目'] = category;
                    }
                }

                // 解析佣金率 - 支持₽和￥，支持中文全角括号（）和半角括号()
                const rfbs1Match = bangText.match(/rFBS佣金[（(]1501~5000[₽￥][）)][：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (rfbs1Match) bangData['RFBS在 1501~5000佣金（%）'] = rfbs1Match[1];

                const rfbs2Match = bangText.match(/rFBS佣金[（(]<=1500[₽￥][）)][：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (rfbs2Match) bangData['RFBS <= 1500佣金（%）'] = rfbs2Match[1];

                const rfbs3Match = bangText.match(/rFBS佣金[（(]>5000[₽￥][）)][：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (rfbs3Match) bangData['RFBS > 5000佣金（%）'] = rfbs3Match[1];

                const fbp1Match = bangText.match(/FBP佣金[（(]1501~5000[₽￥][）)][：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (fbp1Match) bangData['FBP在 1501~5000佣金（%）'] = fbp1Match[1];

                const fbp2Match = bangText.match(/FBP佣金[（(]<=1500[₽￥][）)][：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (fbp2Match) bangData['FBP <= 1500佣金（%）'] = fbp2Match[1];

                const fbp3Match = bangText.match(/FBP佣金[（(]>5000[₽￥][）)][：:]\s*(\d+(?:\.\d+)?)\s*%/);
                if (fbp3Match) bangData['FBP > 5000佣金（%）'] = fbp3Match[1];

                // 解析销售数据
                const monthSalesMatch = bangText.match(/月销量[：:]\s*(\d+(?:\.\d+)?)\s*件/);
                if (monthSalesMatch) bangData['30天内的销量(件)'] = monthSalesMatch[1];

                const monthRevenueMatch = bangText.match(/月销售额[：:]\s*([\d.]+)\s*万?\s*[₽￥]/);
                if (monthRevenueMatch) {
                    const value = monthRevenueMatch[1];
                    // 如果包含"万"，需要转换
                    if (bangText.match(/万\s*[₽￥]/)) {
                        bangData['30天内的销售额'] = (parseFloat(value) * 10000).toString();
                    } else {
                        bangData['30天内的销售额'] = value;
                    }
                }

                const daySalesMatch = bangText.match(/日销量[：:]\s*(\d+(?:\.\d+)?)\s*件/);
                if (daySalesMatch) bangData['平均日销量(件)'] = daySalesMatch[1];

                const dayRevenueMatch = bangText.match(/日销售额[：:]\s*([\d.]+)\s*[₽￥]/);
                if (dayRevenueMatch) bangData['平均日销售额'] = dayRevenueMatch[1];

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

                const avgPriceMatch = bangText.match(/平均价格[：:]\s*([\d.]+)\s*[₽￥]/);
                if (avgPriceMatch) bangData['平均价格'] = avgPriceMatch[1];

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

                // 解析跟卖者信息 - 适配新的HTML结构
                // 匹配格式: "等1个卖家" 或 "<span style='color:red'>1</span>个卖家"
                const sellerCountMatch = bangText.match(/等(\d+)个卖家/) ||
                                        bangText.match(/>(\d+)<\/span>\s*个卖家/);
                if (sellerCountMatch) {
                    bangData['跟卖者数量'] = sellerCountMatch[1];
                }

                // 解析跟卖最低价
                // 先检查是否为"无跟卖"
                const noCompetitorMatch = bangText.match(/跟卖最低价[：:]\s*无跟卖/);
                if (noCompetitorMatch) {
                    bangData['最低跟卖价'] = '无跟卖';
                } else {
                    // 提取价格（支持逗号和空格分隔，不限制货币）
                    // 匹配格式: "跟卖最低价：50,87" 或 "跟卖最低价：5 087"
                    const minPriceMatch = bangText.match(/跟卖最低价[：:]\s*([\d\s,]+)/);
                    if (minPriceMatch) {
                        // 移除所有空格和逗号，只保留数字
                        bangData['最低跟卖价'] = minPriceMatch[1].replace(/[\s,]/g, '');
                    }
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
                const missedSalesMatch = bangText.match(/已错过销售[：:]\s*([\d.]+)\s*[₽￥]/);
                if (missedSalesMatch) bangData['已错过销售'] = missedSalesMatch[1];

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

                // 数据解析完成

            } catch (error) {
                // 错误处理：上品帮数据解析失败
            }

            return bangData;
        }

        // 检测页面货币（只检测一次，全局复用）
        detectCurrency(priceText) {
            if (this.detectedCurrency) {
                return this.detectedCurrency; // 已检测过，直接返回
            }

            // 只依赖货币符号，完全忽略翻译后的文字
            // 如果明确有₽符号 → 卢布
            if (priceText.includes('₽')) {
                this.detectedCurrency = '₽';
            } else {
                // 默认：人民币（翻译后可能显示"日元"、"¥"或无符号）
                this.detectedCurrency = '￥';
            }

            return this.detectedCurrency;
        }

        // 提取商品标题
        extractProductTitle(element) {
            const selectors = [
                // 优先：在商品链接内的span（最精确）
                'a[href*="/product/"] span.tsBody500Medium',
                'a[href*="/product/"] span[class*="tsBody"]:not([class*="Control"])',
                // 次优：全局精确选择器
                'span.tsBody500Medium',
                'span.tsBodyM',
                // 备用：更宽泛的选择器
                'span[class*="tsBody"]:not(.ozon-bang-text):not([class*="Control"])',
                '.tile-hover-target span',
                'div[class*="title"] span'
            ];

            for (const selector of selectors) {
                const titleElements = element.querySelectorAll(selector);
                for (const titleElement of titleElements) {
                    const text = titleElement.textContent.trim();
                    // 验证是否为商品标题（语言无关：长度合理，不包含价格符号和百分比）
                    if (text && text.length >= 3 && text.length < 500 &&
                        !text.includes('₽') && !text.includes('￥') && !text.includes('元') &&
                        !text.includes('%') && !text.includes('CNY') && !text.includes('RUB') &&
                        !text.match(/^\d+$/)) { // 排除纯数字
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

        // 提取价格（语言无关，保留货币单位）
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
                    // 跳过折扣百分比
                    if (priceText.includes('%')) continue;

                    // 提取纯数字（支持空格分隔，如 "5 087"）
                    const cleanPrice = priceText.replace(/[^\d\s]/g, '').trim();
                    if (cleanPrice) {
                        // 检测货币（首次检测后全局复用）
                        const currency = this.detectCurrency(priceText);
                        return cleanPrice + ' ' + currency;
                    }
                }
            }

            return '-';
        }

        // 提取原价（语言无关，保留货币单位）
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
                    // 跳过折扣百分比
                    if (priceText.includes('%')) continue;

                    // 提取纯数字（支持空格分隔，如 "5 087"）
                    const cleanPrice = priceText.replace(/[^\d\s]/g, '').trim();
                    if (cleanPrice) {
                        // 使用全局货币（首次提取价格时已检测）
                        const currency = this.detectedCurrency || '₽';
                        return cleanPrice + ' ' + currency;
                    }
                }
            }

            return '-';
        }

        // 等待上品帮注入完整数据（简化版：固定200ms间隔检查）
        async waitForBangInjection(element, maxWait = CONFIG.bangInjectionWait) {
            const startTime = Date.now();

            while (Date.now() - startTime < maxWait) {
                const bangElement = element.querySelector('.ozon-bang-item, [class*="ozon-bang"]');

                // 只要有上品帮元素且有实际内容，就认为数据已注入
                if (bangElement) {
                    const bangText = bangElement.textContent || '';
                    if (bangText.trim().length > 50) {
                        return true;
                    }
                }

                await this.sleep(CONFIG.bangCheckInterval);
            }

            return false;
        }

        // 收集单个商品的完整数据
        async collectSingleProduct(element, skipWait = false) {
            const contentChanged = this.detectContentChange(element);
            const fingerprint = this.generateProductFingerprint(element);

            // 【SKU 校验】无法提取 SKU，跳过（非有效商品）
            if (!fingerprint) {
                return null;
            }

            // 【全局去重】优先检查是否已上传过
            if (this.uploadedFingerprints.has(fingerprint)) {
                return null;
            }

            // 如果已经收集过且内容未变化，跳过
            if (!contentChanged && this.validatedProducts.has(fingerprint)) {
                return null;
            }

            // 等待上品帮数据（可跳过）
            if (!skipWait) {
                const hasBangData = await this.waitForBangInjection(element);

                // 如果没有上品帮数据，跳过该商品（可能是推广商品）
                if (!hasBangData) {
                    return null;
                }
            }

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

        // 批量收集可见商品（并行轮询优化）
        // skipWait: true = 跳过等待（用于首次扫描已有数据），false = 并行轮询（用于滚动后新商品）
        async collectVisibleProducts(skipWait = false) {
            // 只处理有上品帮标记的商品
            const withBangMark = document.querySelectorAll('.tile-root[data-ozon-bang="true"]');
            const elements = Array.from(withBangMark);

            const newProducts = [];
            const processedFingerprints = new Set();

            // 按行分组（上品帮按行注入数据，通常1行=4个商品）
            const rowSize = 4;
            const rows = [];
            for (let i = 0; i < elements.length; i += rowSize) {
                rows.push(elements.slice(i, i + rowSize));
            }

            // 辅助函数：采集一行商品
            const collectRow = async (row) => {
                for (const element of row) {
                    try {
                        const fingerprint = this.generateProductFingerprint(element);
                        // 跳过无效商品（无法提取SKU）
                        if (!fingerprint) continue;

                        if (!processedFingerprints.has(fingerprint)) {
                            processedFingerprints.add(fingerprint);
                            // 直接采集，不等待
                            const product = await this.collectSingleProduct(element, true);
                            if (product) {
                                newProducts.push(product);
                            }
                        }
                    } catch (error) {
                        // 错误处理：单个商品收集失败
                    }
                }
            };

            if (skipWait) {
                // 首次扫描：直接采集所有行
                for (const row of rows) {
                    if (row.length === 0) continue;
                    await collectRow(row);
                }
            } else {
                // 滚动后：并行轮询，每200ms检查所有行
                const processedRows = new Set();
                const maxWait = CONFIG.bangInjectionWait;
                const startTime = Date.now();
                let checkCount = 0;

                while (processedRows.size < rows.length && Date.now() - startTime < maxWait) {
                    checkCount++;
                    const beforeCollect = newProducts.length;

                    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
                        // 已处理的行跳过
                        if (processedRows.has(rowIndex)) continue;

                        const row = rows[rowIndex];
                        if (row.length === 0) {
                            processedRows.add(rowIndex);
                            continue;
                        }

                        // ⭐ 快速检查：这一行是否全部已采集（避免等待已采集的商品）
                        let allCollected = true;
                        for (const element of row) {
                            const fingerprint = this.generateProductFingerprint(element);
                            // 跳过无效商品（无法提取SKU）
                            if (!fingerprint) continue;

                            if (!this.validatedProducts.has(fingerprint)) {
                                allCollected = false;
                                break;  // 发现未采集的商品，停止检查
                            }
                        }

                        if (allCollected) {
                            processedRows.add(rowIndex);
                            continue;  // 立即跳过到下一行
                        }

                        // 如果有未采集的商品，继续检查数据是否就绪
                        // 快速检查：检查最后一个商品是否有完整数据（跟卖+佣金）
                        const lastElement = row[row.length - 1];
                        const bangElement = lastElement.querySelector('.ozon-bang-item, [class*="ozon-bang"]');

                        if (bangElement) {
                            const bangText = bangElement.textContent || '';
                            // 判断条件：
                            // 1. 内容充足（> 50字符）
                            const hasContent = bangText.trim().length > 50;

                            // 2. 包含"跟卖最低价"字段（可能是价格或"无跟卖"）
                            const hasMinPrice = /跟卖最低价[：:]\s*[\d\s,]+/.test(bangText);  // 有价格
                            const hasNoCompetitor = /跟卖最低价[：:]\s*无跟卖/.test(bangText);  // 明确无跟卖
                            const hasCompetitorData = hasMinPrice || hasNoCompetitor;

                            // 3. 包含rFBS佣金数据（至少匹配一个档位）
                            const hasRFBSCommission = /rFBS佣金[（(](?:1501~5000|<=1500|>5000)[₽￥][）)][：:]\s*\d+(?:\.\d+)?\s*%/.test(bangText);

                            // 4. 包含FBP佣金数据（至少匹配一个档位）
                            const hasFBPCommission = /FBP佣金[（(](?:1501~5000|<=1500|>5000)[₽￥][）)][：:]\s*\d+(?:\.\d+)?\s*%/.test(bangText);

                            // 数据就绪条件：内容充足 + 跟卖数据 + (rFBS或FBP至少一个)
                            if (hasContent && hasCompetitorData && (hasRFBSCommission || hasFBPCommission)) {
                                // 这行准备好了，立即采集
                                const rowStartCount = newProducts.length;
                                await collectRow(row);
                                const rowNewCount = newProducts.length - rowStartCount;
                                processedRows.add(rowIndex);
                            }
                        }
                    }

                    const cycleNewCount = newProducts.length - beforeCollect;

                    // 如果还有未处理的行，等待200ms后继续检查
                    if (processedRows.size < rows.length) {
                        await this.sleep(CONFIG.bangCheckInterval);
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
            // 注意：不清空 uploadedFingerprints，保留全局上传历史
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
            // 创建主面板
            this.panel = document.createElement('div');
            this.panel.id = 'ozon-selector-panel';
            this.panel.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: #5b9bd5;
                color: white;
                padding: 20px;
                border-radius: 12px;
                box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                min-width: 360px;
                max-width: 400px;
                display: none;
            `;

            this.panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0; font-size: 18px;">🎯 Ozon选品助手</h3>
                    <div style="display: flex; gap: 8px;">
                        <button id="settings-btn" style="background: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.5);
                                color: white; font-size: 16px; cursor: pointer; padding: 4px 8px;
                                border-radius: 6px; font-weight: bold; transition: all 0.3s; min-width: 30px;">⚙️</button>
                        <button id="minimize-btn" style="background: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.5);
                                color: white; font-size: 16px; cursor: pointer; padding: 4px 8px;
                                border-radius: 6px; font-weight: bold; transition: all 0.3s; min-width: 30px;">➖</button>
                    </div>
                </div>

                <div style="background: rgba(255,255,255,0.15); padding: 12px; border-radius: 8px; margin-bottom: 15px;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                        <label style="font-size: 12px; opacity: 0.9; white-space: nowrap;">
                            采集数量:
                        </label>
                        <input type="number" id="target-count" value="${CONFIG.targetProductCount}"
                               min="10" max="500"
                               style="width: 80px; padding: 6px 8px; border: none; border-radius: 4px;
                                      background: rgba(255,255,255,0.9); color: #333; font-size: 14px; text-align: center;">
                    </div>

                    <div style="background: rgba(0,0,0,0.2); padding: 10px; border-radius: 6px; margin-bottom: 12px;">
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 8px; align-items: center; font-size: 12px; margin-bottom: 10px;">
                            <div>✅ 已采集: <span id="collected" style="font-weight: bold;">0</span></div>
                            <div id="status" style="text-align: right; opacity: 0.9;">⏳ 等待开始...</div>
                        </div>
                        <div style="position: relative; background: rgba(255,255,255,0.2); height: 22px; border-radius: 11px; overflow: hidden;">
                            <div id="progress-bar" style="background: linear-gradient(90deg, #48bb78, #68d391);
                                    height: 100%; width: 0%; transition: width 0.3s;">
                            </div>
                            <span id="progress-text" style="position: absolute; top: 0; left: 0; right: 0;
                                    height: 100%; display: flex; align-items: center; justify-content: center;
                                    color: white; font-weight: bold; font-size: 11px; pointer-events: none;">0%</span>
                        </div>
                    </div>

                    <button id="toggle-btn" style="width: 100%; padding: 10px; border: none;
                            border-radius: 6px; background: #48bb78; color: white;
                            font-weight: bold; cursor: pointer; transition: all 0.3s;">
                        🚀 开始
                    </button>
                </div>
            `;

            document.body.appendChild(this.panel);

            // 创建API设置模态框
            this.apiModal = document.createElement('div');
            this.apiModal.id = 'ozon-api-modal';
            this.apiModal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0,0,0,0.5);
                z-index: 2147483648;
                display: none;
                align-items: center;
                justify-content: center;
            `;
            this.apiModal.innerHTML = `
                <div style="background: #5b9bd5;
                            padding: 20px; border-radius: 12px; box-shadow: 0 10px 40px rgba(0,0,0,0.3);
                            min-width: 360px; max-width: 400px; color: white;
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h3 style="margin: 0; font-size: 18px;">⚙️ API设置</h3>
                        <button id="close-modal-btn" style="background: rgba(255,255,255,0.3); border: 1px solid rgba(255,255,255,0.5);
                                color: white; font-size: 16px; cursor: pointer; padding: 4px 8px;
                                border-radius: 6px; font-weight: bold; transition: all 0.3s; min-width: 30px;">✕</button>
                    </div>
                    <div>
                        <label style="display: block; margin-bottom: 5px; font-size: 12px;">API地址:</label>
                        <input type="text" id="api-url-input" value="${CONFIG.apiUrl}" placeholder="https://your-domain.com"
                               style="width: 100%; padding: 8px; border: 1px solid rgba(255,255,255,0.3);
                                      border-radius: 4px; margin-bottom: 10px; font-size: 12px;
                                      background: rgba(255,255,255,0.9); color: #333; box-sizing: border-box;">

                        <label style="display: block; margin-bottom: 5px; font-size: 12px;">API Key:</label>
                        <input type="password" id="api-key-input" value="${CONFIG.apiKey}" placeholder="ef_live_xxxxx..."
                               style="width: 100%; padding: 8px; border: 1px solid rgba(255,255,255,0.3);
                                      border-radius: 4px; margin-bottom: 10px; font-size: 12px;
                                      background: rgba(255,255,255,0.9); color: #333; box-sizing: border-box;">

                        <button id="save-api-config-btn" style="margin-top: 10px; padding: 8px 16px; background: #28a745;
                                color: white; border: none; border-radius: 4px; cursor: pointer;
                                width: 100%; margin-bottom: 5px; font-size: 12px; transition: all 0.3s;">💾 保存配置</button>

                        <button id="test-api-btn" style="padding: 8px 16px; background: #17a2b8; color: white;
                                border: none; border-radius: 4px; cursor: pointer;
                                width: 100%; font-size: 12px; transition: all 0.3s;">🔍 测试连接</button>
                    </div>
                </div>
            `;
            document.body.appendChild(this.apiModal);

            // 创建最小化图标
            this.minimizedIcon = document.createElement('div');
            this.minimizedIcon.id = 'ozon-selector-icon';
            this.minimizedIcon.style.cssText = `
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
                z-index: 2147483647;
                box-shadow: 0 5px 20px rgba(0,0,0,0.3);
                font-size: 24px;
                transition: transform 0.3s;
            `;
            this.minimizedIcon.innerHTML = '🎯';
            this.minimizedIcon.onmouseover = () => {
                this.minimizedIcon.style.transform = 'scale(1.1)';
            };
            this.minimizedIcon.onmouseout = () => {
                this.minimizedIcon.style.transform = 'scale(1)';
            };
            document.body.appendChild(this.minimizedIcon);

            this.bindEvents();
            this.addHoverEffects();
        }

        bindEvents() {
            // Toggle按钮事件
            const toggleBtn = document.getElementById('toggle-btn');
            toggleBtn.onclick = () => {
                if (this.collector.isRunning) {
                    // 停止收集
                    this.stopCollection();
                } else {
                    // 开始收集
                    this.startCollection();
                }
            };

            // 设置按钮事件
            const settingsBtn = document.getElementById('settings-btn');
            settingsBtn.onclick = () => {
                this.apiModal.style.display = 'flex';
            };

            // 设置按钮悬停效果
            settingsBtn.onmouseover = () => {
                settingsBtn.style.background = 'rgba(255,255,255,0.5)';
                settingsBtn.style.transform = 'scale(1.1)';
            };
            settingsBtn.onmouseout = () => {
                settingsBtn.style.background = 'rgba(255,255,255,0.3)';
                settingsBtn.style.transform = 'scale(1)';
            };

            // 最小化/展开事件
            const minimizeBtn = document.getElementById('minimize-btn');
            minimizeBtn.onclick = () => {
                this.panel.style.display = 'none';
                this.minimizedIcon.style.display = 'flex';
            };

            // 最小化按钮悬停效果
            minimizeBtn.onmouseover = () => {
                minimizeBtn.style.background = 'rgba(255,255,255,0.5)';
                minimizeBtn.style.transform = 'scale(1.1)';
            };
            minimizeBtn.onmouseout = () => {
                minimizeBtn.style.background = 'rgba(255,255,255,0.3)';
                minimizeBtn.style.transform = 'scale(1)';
            };

            this.minimizedIcon.onclick = () => {
                this.panel.style.display = 'block';
                this.minimizedIcon.style.display = 'none';
            };

            // API模态框关闭事件
            const closeModalBtn = document.getElementById('close-modal-btn');
            closeModalBtn.onclick = () => {
                this.apiModal.style.display = 'none';
            };

            // 关闭按钮悬停效果
            closeModalBtn.onmouseover = () => {
                closeModalBtn.style.background = 'rgba(255,255,255,0.5)';
                closeModalBtn.style.transform = 'scale(1.1)';
            };
            closeModalBtn.onmouseout = () => {
                closeModalBtn.style.background = 'rgba(255,255,255,0.3)';
                closeModalBtn.style.transform = 'scale(1)';
            };

            // 点击模态框外部关闭
            this.apiModal.onclick = (e) => {
                if (e.target === this.apiModal) {
                    this.apiModal.style.display = 'none';
                }
            };

            // 保存API配置
            document.getElementById('save-api-config-btn').onclick = () => {
                CONFIG.apiEnabled = true;  // 始终启用API上传
                CONFIG.apiUrl = document.getElementById('api-url-input').value.trim();
                CONFIG.apiKey = document.getElementById('api-key-input').value.trim();
                CONFIG.autoUpload = true;  // 始终自动上传
                saveAPIConfig();
                alert('配置已保存！');
            };

            // 测试连接
            document.getElementById('test-api-btn').onclick = () => {
                // 先保存当前输入
                CONFIG.apiUrl = document.getElementById('api-url-input').value.trim();
                CONFIG.apiKey = document.getElementById('api-key-input').value.trim();
                this.testAPIConnection();
            };
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

            // 更新UI：切换按钮为红色"停止"
            const toggleBtn = document.getElementById('toggle-btn');
            toggleBtn.style.background = '#f56565';
            toggleBtn.innerHTML = '⏸️ 停止';
            this.updateStatus(`🚀 开始采集，目标: ${targetCount} 个商品`);

            // 开始收集流程
            await this.runCollection(targetCount);
        }

        async runCollection(targetCount) {
            // 【条件性初始扫描】仅在页面顶部时才进行初始扫描
            // 从中间位置继续采集时跳过，避免重复采集已上传商品
            if (window.scrollY === 0) {
                await this.collector.collectVisibleProducts(true);
                this.updateStats();
            } else {
                console.log(`[跳过初始扫描] 从位置 ${window.scrollY}px 继续采集`);
            }

            let lastCollectedCount = this.collector.validatedProducts.size;
            let sameCountTimes = 0;
            let forceScrollCount = 0;

            // 自动滚动收集
            while (this.collector.isRunning && this.collector.scrollCount < CONFIG.maxScrollAttempts) {
                this.collector.scrollCount++;

                // 检查是否达到目标
                if (this.collector.validatedProducts.size >= targetCount) {
                    this.updateStatus(`✅ 成功采集 ${this.collector.validatedProducts.size} 个商品！`);
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
                } else {
                    scrollDistance = viewportHeight * CONFIG.scrollStepSize;
                }

                // 执行滚动
                window.scrollTo({
                    top: currentScroll + scrollDistance,
                    behavior: 'smooth'
                });

                // 收集新商品（并行轮询，无等待直接开始检测）
                const beforeCount = this.collector.validatedProducts.size;
                this.updateStatus(`⏳ 等待数据加载...`);
                await this.collector.collectVisibleProducts(false);
                const afterCount = this.collector.validatedProducts.size;
                const actualNewCount = afterCount - beforeCount;

                if (actualNewCount === 0) {
                    this.collector.noChangeCount++;

                    if (afterCount === lastCollectedCount) {
                        sameCountTimes++;

                        if (sameCountTimes >= 3 && afterCount < targetCount) {
                            forceScrollCount++;

                            if (forceScrollCount <= 3) {
                                window.scrollTo(0, document.body.scrollHeight);
                                await this.collector.sleep(500);

                                const newPageHeight = document.body.scrollHeight;
                                if (newPageHeight > pageHeight) {
                                    sameCountTimes = 0;
                                    this.collector.noChangeCount = 0;
                                    continue;
                                }
                            } else {
                                if (afterCount > 0) {
                                    this.updateStatus(`✅ 已采集 ${afterCount} 个商品`);
                                    this.stopCollection();
                                    return;
                                }
                            }
                        }
                    } else {
                        sameCountTimes = 0;
                    }

                    if (this.collector.noChangeCount >= CONFIG.noChangeThreshold * 2) {
                        this.updateStatus(`✅ 已采集 ${afterCount} 个商品`);
                        this.stopCollection();
                        return;
                    }
                } else {
                    this.collector.noChangeCount = 0;
                    sameCountTimes = 0;
                    forceScrollCount = 0;
                    lastCollectedCount = afterCount;
                }

                this.updateStats();

                // 动态调整滚动速度
                if (actualNewCount > 5) {
                    CONFIG.scrollStepSize = Math.min(CONFIG.scrollStepSize * 1.1, 2);
                } else if (actualNewCount === 0) {
                    CONFIG.scrollStepSize = Math.max(CONFIG.scrollStepSize * 0.9, 0.8);
                }

                // 滚动延迟（防反爬虫）
                if (CONFIG.scrollDelay > 0) {
                    await this.collector.sleep(CONFIG.scrollDelay);
                }
            }

            this.updateStatus(`✅ 已采集 ${this.collector.validatedProducts.size} 个商品`);
            this.stopCollection();
        }

        stopCollection() {
            this.collector.isRunning = false;

            // 更新UI：切换按钮为绿色"开始"
            const toggleBtn = document.getElementById('toggle-btn');
            toggleBtn.style.background = '#48bb78';
            toggleBtn.innerHTML = '🚀 开始';
            this.updateStats();

            // 如果启用自动上传
            if (CONFIG.apiEnabled && CONFIG.autoUpload) {
                setTimeout(() => {
                    this.uploadToAPI();
                }, 1000);
            }
        }

        updateStats() {
            const stats = this.collector.getStats();
            const targetCount = parseInt(document.getElementById('target-count').value) || CONFIG.targetProductCount;
            const progress = Math.min((stats.collected / targetCount) * 100, 100);

            document.getElementById('collected').textContent = stats.collected;

            // 进度条
            const progressBar = document.getElementById('progress-bar');
            progressBar.style.width = `${progress}%`;
            document.getElementById('progress-text').textContent = `${Math.round(progress)}%`;
        }

        updateStatus(message) {
            document.getElementById('status').textContent = message;
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

        // 上传数据到API
        async uploadToAPI() {
            if (!CONFIG.apiEnabled) {
                alert('API上传未启用\n请在"API设置"中配置');
                return;
            }

            if (!CONFIG.apiUrl || !CONFIG.apiKey) {
                alert('请先配置API地址和Key');
                return;
            }

            const stats = this.collector.getStats();
            if (stats.products.length === 0) {
                alert('没有数据可上传');
                return;
            }

            try {
                this.updateStatus('🚀 正在上传数据...');

                // 转换数据格式
                const products = stats.products.map(p => ({
                    product_id: p['商品ID'],
                    product_name_ru: p['商品名称'],
                    brand: p['品牌'],
                    current_price: this.parseNumber(p['销售价格']),
                    original_price: this.parseNumber(p['原价']),
                    ozon_link: p['商品链接'],
                    image_url: p['商品图片'],
                    category_link: p['类目链接'],
                    rfbs_commission_low: this.parseNumber(p['RFBS <= 1500佣金（%）']),
                    rfbs_commission_mid: this.parseNumber(p['RFBS在 1501~5000佣金（%）']),
                    rfbs_commission_high: this.parseNumber(p['RFBS > 5000佣金（%）']),
                    fbp_commission_low: this.parseNumber(p['FBP <= 1500佣金（%）']),
                    fbp_commission_mid: this.parseNumber(p['FBP在 1501~5000佣金（%）']),
                    fbp_commission_high: this.parseNumber(p['FBP > 5000佣金（%）']),
                    monthly_sales_volume: this.parseInteger(p['30天内的销量(件)']),
                    monthly_sales_revenue: this.parseNumber(p['30天内的销售额']),
                    daily_sales_volume: this.parseInteger(p['平均日销量(件)']),
                    daily_sales_revenue: this.parseNumber(p['平均日销售额']),
                    sales_dynamic_percent: this.parseNumber(p['销售动态(%)']),
                    conversion_rate: this.parseNumber(p['成交率（%）']),
                    package_weight: this.parseInteger(p['包装重量(g)']),
                    package_volume: this.parseNumber(p['商品体积（升）']),
                    package_length: this.parseInteger(p['包装长(mm)']),
                    package_width: this.parseInteger(p['包装宽(mm)']),
                    package_height: this.parseInteger(p['包装高(mm)']),
                    rating: this.parseNumber(p['商品评分']),
                    review_count: this.parseInteger(p['评价次数']),
                    seller_type: p['卖家类型'],
                    delivery_days: this.parseInteger(p['配送时间（天）']),
                    availability_percent: this.parseNumber(p['商品可用性(%)']),
                    ad_cost_share: this.parseNumber(p['广告费用份额（%）']),
                    product_created_date: p['商品创建日期'],
                    competitor_count: this.parseInteger(p['跟卖者数量']),
                    competitor_min_price: this.parseNumber(p['最低跟卖价'])
                }));

                // 发送请求（使用 GM_xmlhttpRequest 绕过 CSP）
                const url = `${CONFIG.apiUrl}/api/ef/v1/ozon/product-selection/upload`;
                const response = await gmFetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': CONFIG.apiKey
                    },
                    body: JSON.stringify({ products })
                });

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.detail?.message || `HTTP ${response.status}`);
                }

                const result = await response.json();
                this.updateStatus(`✅ 上传成功: ${result.success_count}/${result.total} 个商品`);

                if (result.failed_count > 0) {
                    console.warn('部分商品上传失败:', result.errors);
                }

                // 【新增】记录已上传指纹到全局历史
                this.collector.validatedProducts.forEach((product, fingerprint) => {
                    this.collector.uploadedFingerprints.add(fingerprint);
                });
                console.log(`✅ 上传 ${result.success_count} 个 | 累计 ${this.collector.uploadedFingerprints.size} 个指纹`);

                // 上传成功后清空数据并重置进度（保持当前滚动位置，便于继续采集）
                setTimeout(() => {
                    this.collector.clear();
                    this.updateStats();
                    this.updateStatus('⏳ 等待开始...');
                }, 2000); // 延迟2秒让用户看到上传成功的消息

            } catch (error) {
                console.error('上传失败:', error);
                this.updateStatus(`❌ 上传失败: ${error.message}`);
                alert(`上传失败:\n${error.message}`);
            }
        }

        // 辅助方法：解析数字
        parseNumber(value) {
            if (!value || value === '-') return null;
            const num = parseFloat(String(value).replace(/[^\d.-]/g, ''));
            return isNaN(num) ? null : num;
        }

        // 辅助方法：解析整数
        parseInteger(value) {
            if (!value || value === '-') return null;
            const num = parseInt(String(value).replace(/[^\d]/g, ''));
            return isNaN(num) ? null : num;
        }

        // 测试API连接
        async testAPIConnection() {
            if (!CONFIG.apiUrl || !CONFIG.apiKey) {
                alert('请先配置API地址和Key');
                return;
            }

            try {
                this.updateStatus('🔍 测试连接...');
                const url = `${CONFIG.apiUrl}/api/ef/v1/auth/me`;
                const response = await gmFetch(url, {
                    headers: { 'X-API-Key': CONFIG.apiKey }
                });

                if (response.ok) {
                    const data = await response.json();
                    this.updateStatus(`✅ 连接成功！用户: ${data.username}`);
                    alert(`连接成功！\n用户: ${data.username}\nAPI Key有效`);
                } else {
                    throw new Error(`HTTP ${response.status}`);
                }
            } catch (error) {
                this.updateStatus(`❌ 连接失败: ${error.message}`);
                alert(`连接失败:\n${error.message}\n\n请检查:\n1. API地址是否正确\n2. API Key是否有效\n3. 网络是否通畅`);
            }
        }

        destroy() {
            this.collector.destroy();
            this.panel?.remove();
            this.minimizedIcon?.remove();
            this.apiModal?.remove();
        }
    }

    // ===== 一键上架UI类 =====
    class QuickPublishUI {
        constructor() {
            this.button = null;
            this.modal = null;
            this.shops = [];
            this.warehouses = [];
            this.taskId = null;
            this.pollingInterval = null;
            this.createUI();
            this.loadShops();
        }

        createUI() {
            // 创建浮动按钮
            this.button = document.createElement('div');
            this.button.style.cssText = `
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                color: white;
                padding: 15px 25px;
                border-radius: 50px;
                box-shadow: 0 10px 30px rgba(102, 126, 234, 0.4);
                cursor: pointer;
                z-index: 2147483647;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                font-size: 16px;
                font-weight: bold;
                transition: all 0.3s;
                user-select: none;
            `;
            this.button.innerHTML = '🚀 一键上架到EuraFlow';
            this.button.onclick = () => this.showModal();
            this.button.onmouseover = () => {
                this.button.style.transform = 'scale(1.05) translateY(-2px)';
                this.button.style.boxShadow = '0 15px 40px rgba(102, 126, 234, 0.5)';
            };
            this.button.onmouseout = () => {
                this.button.style.transform = 'scale(1)';
                this.button.style.boxShadow = '0 10px 30px rgba(102, 126, 234, 0.4)';
            };
            document.body.appendChild(this.button);

            // 创建模态框
            this.modal = document.createElement('div');
            this.modal.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.6);
                z-index: 2147483648;
                display: none;
                align-items: center;
                justify-content: center;
                backdrop-filter: blur(5px);
            `;
            this.modal.innerHTML = `
                <div style="background: white; padding: 30px; border-radius: 16px;
                            box-shadow: 0 20px 60px rgba(0,0,0,0.3); min-width: 500px; max-width: 600px;
                            max-height: 80vh; overflow-y: auto; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h2 style="margin: 0; font-size: 24px; color: #333;">🚀 一键上架</h2>
                        <button id="qp-close-btn" style="background: #f0f0f0; border: none; color: #666;
                                font-size: 24px; cursor: pointer; padding: 5px 12px; border-radius: 8px;
                                transition: all 0.3s;">×</button>
                    </div>

                    <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
                        <div style="display: grid; grid-template-columns: 120px 1fr; gap: 10px; align-items: center; font-size: 13px;">
                            <div style="color: #666;">商品标题:</div>
                            <div id="qp-title-preview" style="color: #333; font-weight: 500;">加载中...</div>
                            <div style="color: #666;">OZON商品ID:</div>
                            <div id="qp-id-preview" style="color: #333; font-weight: 500;">加载中...</div>
                        </div>
                    </div>

                    <form id="qp-form" style="display: grid; gap: 15px;">
                        <div>
                            <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                店铺 <span style="color: #f56565;">*</span>
                            </label>
                            <select id="qp-shop" required style="width: 100%; padding: 10px; border: 1px solid #ddd;
                                    border-radius: 6px; font-size: 14px; box-sizing: border-box;">
                                <option value="">加载中...</option>
                            </select>
                        </div>

                        <div>
                            <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                仓库 (可选)
                            </label>
                            <div id="qp-warehouses" style="border: 1px solid #ddd; border-radius: 6px; padding: 10px;
                                    max-height: 120px; overflow-y: auto; background: #fafafa;">
                                <div style="color: #999; font-size: 13px;">请先选择店铺</div>
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                    商家SKU <span style="color: #f56565;">*</span>
                                </label>
                                <input type="text" id="qp-offer-id" required placeholder="例: MY-SKU-001"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;
                                              font-size: 14px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                    类目ID <span style="color: #f56565;">*</span>
                                </label>
                                <input type="number" id="qp-category-id" required placeholder="例: 17029016"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;
                                              font-size: 14px; box-sizing: border-box;">
                            </div>
                        </div>

                        <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 15px;">
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                    销售价格(₽) <span style="color: #f56565;">*</span>
                                </label>
                                <input type="number" id="qp-price" required step="0.01" min="0" placeholder="1000"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;
                                              font-size: 14px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                    原价(₽)
                                </label>
                                <input type="number" id="qp-old-price" step="0.01" min="0" placeholder="1500"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;
                                              font-size: 14px; box-sizing: border-box;">
                            </div>
                            <div>
                                <label style="display: block; margin-bottom: 5px; font-size: 13px; font-weight: 600; color: #555;">
                                    库存 <span style="color: #f56565;">*</span>
                                </label>
                                <input type="number" id="qp-stock" required min="0" placeholder="10"
                                       style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px;
                                              font-size: 14px; box-sizing: border-box;">
                            </div>
                        </div>

                        <div style="border-top: 1px solid #e0e0e0; padding-top: 15px; margin-top: 10px;">
                            <label style="display: block; margin-bottom: 10px; font-size: 13px; font-weight: 600; color: #555;">
                                商品尺寸和重量 <span style="color: #f56565;">*</span>
                            </label>
                            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px;">
                                <div>
                                    <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">重量(克)</label>
                                    <input type="number" id="qp-weight" required min="1" placeholder="500"
                                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
                                                  font-size: 13px; box-sizing: border-box;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">长度(mm)</label>
                                    <input type="number" id="qp-length" required min="1" placeholder="200"
                                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
                                                  font-size: 13px; box-sizing: border-box;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">宽度(mm)</label>
                                    <input type="number" id="qp-width" required min="1" placeholder="150"
                                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
                                                  font-size: 13px; box-sizing: border-box;">
                                </div>
                                <div>
                                    <label style="display: block; margin-bottom: 5px; font-size: 12px; color: #666;">高度(mm)</label>
                                    <input type="number" id="qp-height" required min="1" placeholder="100"
                                           style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px;
                                                  font-size: 13px; box-sizing: border-box;">
                                </div>
                            </div>
                        </div>

                        <div id="qp-status" style="background: #e8f4fd; color: #1a73e8; padding: 12px; border-radius: 6px;
                                font-size: 13px; display: none; margin-top: 10px;">
                            <div style="display: flex; align-items: center; gap: 8px;">
                                <span id="qp-status-icon">ℹ️</span>
                                <span id="qp-status-text">准备就绪</span>
                            </div>
                            <div id="qp-progress" style="width: 100%; height: 4px; background: rgba(26, 115, 232, 0.2);
                                    border-radius: 2px; margin-top: 8px; overflow: hidden; display: none;">
                                <div id="qp-progress-bar" style="width: 0%; height: 100%; background: #1a73e8;
                                        transition: width 0.3s;"></div>
                            </div>
                        </div>

                        <div style="display: flex; gap: 10px; margin-top: 10px;">
                            <button type="button" id="qp-cancel-btn" style="flex: 1; padding: 12px; border: 1px solid #ddd;
                                    border-radius: 8px; background: white; color: #666; font-size: 15px; font-weight: 600;
                                    cursor: pointer; transition: all 0.3s;">
                                取消
                            </button>
                            <button type="submit" id="qp-submit-btn" style="flex: 2; padding: 12px; border: none;
                                    border-radius: 8px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                                    color: white; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s;">
                                🚀 开始上架
                            </button>
                        </div>
                    </form>
                </div>
            `;
            document.body.appendChild(this.modal);
            this.bindEvents();
        }

        bindEvents() {
            // 关闭按钮
            document.getElementById('qp-close-btn').onclick = () => this.hideModal();
            document.getElementById('qp-cancel-btn').onclick = () => this.hideModal();

            // 点击模态框外部关闭
            this.modal.onclick = (e) => {
                if (e.target === this.modal) this.hideModal();
            };

            // 店铺选择变化
            document.getElementById('qp-shop').onchange = (e) => {
                const shopId = parseInt(e.target.value);
                if (shopId) this.loadWarehouses(shopId);
            };

            // 表单提交
            document.getElementById('qp-form').onsubmit = (e) => {
                e.preventDefault();
                this.submitQuickPublish();
            };
        }

        showModal() {
            this.modal.style.display = 'flex';
            this.extractPageData();
        }

        hideModal() {
            this.modal.style.display = 'none';
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
                this.pollingInterval = null;
            }
        }

        // 加载店铺列表
        async loadShops() {
            try {
                if (!CONFIG.apiUrl || !CONFIG.apiKey) {
                    return;
                }

                const url = `${CONFIG.apiUrl}/api/ef/v1/ozon/shops`;
                const response = await gmFetch(url, {
                    headers: { 'X-API-Key': CONFIG.apiKey }
                });

                if (!response.ok) throw new Error('加载店铺失败');

                const data = await response.json();
                this.shops = data.data || [];

                const select = document.getElementById('qp-shop');
                select.innerHTML = '<option value="">请选择店铺</option>';
                this.shops.forEach(shop => {
                    const option = document.createElement('option');
                    option.value = shop.id;
                    option.textContent = shop.shop_name;
                    select.appendChild(option);
                });
            } catch (error) {
                console.error('加载店铺失败:', error);
            }
        }

        // 加载仓库列表
        async loadWarehouses(shopId) {
            try {
                const url = `${CONFIG.apiUrl}/api/ef/v1/ozon/quick-publish/shops/${shopId}/warehouses`;
                const response = await gmFetch(url, {
                    headers: { 'X-API-Key': CONFIG.apiKey }
                });

                if (!response.ok) throw new Error('加载仓库失败');

                const data = await response.json();
                this.warehouses = data.data || [];

                const container = document.getElementById('qp-warehouses');
                if (this.warehouses.length === 0) {
                    container.innerHTML = '<div style="color: #999; font-size: 13px;">该店铺没有可用仓库</div>';
                    return;
                }

                container.innerHTML = '';
                this.warehouses.forEach(wh => {
                    const label = document.createElement('label');
                    label.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 6px 0; cursor: pointer;';
                    label.innerHTML = `
                        <input type="checkbox" name="warehouse" value="${wh.warehouse_id}"
                               style="cursor: pointer;">
                        <span style="font-size: 13px; color: #333;">
                            ${wh.name} ${wh.is_rfbs ? '<span style="color: #48bb78; font-weight: 600;">(rFBS)</span>' : ''}
                        </span>
                    `;
                    container.appendChild(label);
                });
            } catch (error) {
                console.error('加载仓库失败:', error);
                const container = document.getElementById('qp-warehouses');
                container.innerHTML = '<div style="color: #f56565; font-size: 13px;">加载失败，请重试</div>';
            }
        }

        // 提取页面数据
        extractPageData() {
            try {
                // 提取OZON商品ID
                const match = window.location.pathname.match(/\/product\/[^/]+-(\d+)/);
                const ozonProductId = match ? match[1] : '';
                document.getElementById('qp-id-preview').textContent = ozonProductId || '未识别';

                // 提取标题
                const titleElement = document.querySelector('h1[class*="tsHeadline"]') ||
                                   document.querySelector('h1') ||
                                   document.querySelector('[data-widget="webProductHeading"]');
                const title = titleElement ? titleElement.textContent.trim() : '未识别';
                document.getElementById('qp-title-preview').textContent = title;

                // 存储提取的数据供后续使用
                this.pageData = {
                    ozon_product_id: ozonProductId,
                    title: title,
                    description: this.extractDescription(),
                    images: this.extractImages(),
                    brand: this.extractBrand(),
                    barcode: this.extractBarcode()
                };
            } catch (error) {
                console.error('提取页面数据失败:', error);
            }
        }

        extractDescription() {
            const descElement = document.querySelector('[data-widget="webDescription"]') ||
                              document.querySelector('[class*="description"]');
            return descElement ? descElement.textContent.trim() : '';
        }

        extractImages() {
            const images = [];
            const imgElements = document.querySelectorAll('img[src*="cdn1.ozone.ru"], img[src*="ozon.ru"]');
            imgElements.forEach(img => {
                let src = img.src;
                // 转换为高清URL
                if (src.includes('wc')) {
                    src = src.replace(/wc\d+/, 'wc1000');
                }
                if (src && !images.includes(src) && images.length < 15) {
                    images.push(src);
                }
            });
            return images;
        }

        extractBrand() {
            const brandElement = document.querySelector('[data-widget="webCharacteristics"] a[href*="brand"]') ||
                               document.querySelector('a[href*="/brand/"]');
            return brandElement ? brandElement.textContent.trim() : '';
        }

        extractBarcode() {
            // 尝试从页面特征中提取条码
            const chars = document.querySelectorAll('[data-widget="webCharacteristics"] dd');
            for (const dd of chars) {
                const text = dd.textContent.trim();
                if (/^\d{8,14}$/.test(text)) {
                    return text;
                }
            }
            return '';
        }

        // 提交上架请求
        async submitQuickPublish() {
            try {
                const submitBtn = document.getElementById('qp-submit-btn');
                submitBtn.disabled = true;
                submitBtn.textContent = '提交中...';

                this.showStatus('⏳', '正在提交商品...', 'info');

                // 收集表单数据
                const shopId = parseInt(document.getElementById('qp-shop').value);
                const warehouseCheckboxes = document.querySelectorAll('input[name="warehouse"]:checked');
                const warehouseIds = Array.from(warehouseCheckboxes).map(cb => parseInt(cb.value));

                const data = {
                    shop_id: shopId,
                    warehouse_ids: warehouseIds,
                    offer_id: document.getElementById('qp-offer-id').value.trim(),
                    price: parseFloat(document.getElementById('qp-price').value),
                    old_price: document.getElementById('qp-old-price').value ?
                              parseFloat(document.getElementById('qp-old-price').value) : null,
                    stock: parseInt(document.getElementById('qp-stock').value),
                    category_id: parseInt(document.getElementById('qp-category-id').value),
                    ozon_product_id: this.pageData.ozon_product_id,
                    title: this.pageData.title,
                    description: this.pageData.description,
                    images: this.pageData.images,
                    brand: this.pageData.brand,
                    barcode: this.pageData.barcode || document.getElementById('qp-offer-id').value,
                    dimensions: {
                        weight: parseInt(document.getElementById('qp-weight').value),
                        height: parseInt(document.getElementById('qp-height').value),
                        width: parseInt(document.getElementById('qp-width').value),
                        length: parseInt(document.getElementById('qp-length').value)
                    },
                    attributes: []
                };

                const url = `${CONFIG.apiUrl}/api/ef/v1/ozon/quick-publish/publish`;
                const response = await gmFetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': CONFIG.apiKey
                    },
                    body: JSON.stringify(data)
                });

                const result = await response.json();

                if (!result.success) {
                    throw new Error(result.error || '提交失败');
                }

                this.taskId = result.task_id;
                this.showStatus('✅', `提交成功！任务ID: ${this.taskId}`, 'success');
                this.startPolling(shopId);

            } catch (error) {
                console.error('提交失败:', error);
                this.showStatus('❌', `提交失败: ${error.message}`, 'error');
                const submitBtn = document.getElementById('qp-submit-btn');
                submitBtn.disabled = false;
                submitBtn.textContent = '🚀 开始上架';
            }
        }

        // 开始轮询任务状态
        startPolling(shopId) {
            document.getElementById('qp-progress').style.display = 'block';
            let progress = 0;

            this.pollingInterval = setInterval(async () => {
                try {
                    const url = `${CONFIG.apiUrl}/api/ef/v1/ozon/quick-publish/task/${this.taskId}/status?shop_id=${shopId}`;
                    const response = await gmFetch(url, {
                        headers: { 'X-API-Key': CONFIG.apiKey }
                    });

                    const result = await response.json();

                    // 更新进度条（模拟进度）
                    if (result.status === 'processing') {
                        progress = Math.min(progress + 10, 90);
                        document.getElementById('qp-progress-bar').style.width = `${progress}%`;
                        this.showStatus('⏳', '正在处理中，请稍候...', 'info');
                    } else if (result.status === 'imported') {
                        clearInterval(this.pollingInterval);
                        document.getElementById('qp-progress-bar').style.width = '100%';
                        this.showStatus('✅', '上架成功！商品已提交到OZON', 'success');

                        const submitBtn = document.getElementById('qp-submit-btn');
                        submitBtn.disabled = false;
                        submitBtn.textContent = '✅ 上架成功';
                        submitBtn.style.background = '#48bb78';

                        setTimeout(() => {
                            this.hideModal();
                            this.resetForm();
                        }, 3000);
                    } else if (result.status === 'failed') {
                        clearInterval(this.pollingInterval);
                        const errorMsg = result.items && result.items[0] ?
                                       (result.items[0].errors || []).map(e => e.message).join('; ') :
                                       result.error || '上架失败';
                        this.showStatus('❌', `上架失败: ${errorMsg}`, 'error');

                        const submitBtn = document.getElementById('qp-submit-btn');
                        submitBtn.disabled = false;
                        submitBtn.textContent = '🚀 重试上架';
                    }
                } catch (error) {
                    console.error('轮询状态失败:', error);
                }
            }, 5000);
        }

        showStatus(icon, text, type) {
            const statusDiv = document.getElementById('qp-status');
            const iconSpan = document.getElementById('qp-status-icon');
            const textSpan = document.getElementById('qp-status-text');

            statusDiv.style.display = 'block';
            iconSpan.textContent = icon;
            textSpan.textContent = text;

            const colors = {
                info: { bg: '#e8f4fd', color: '#1a73e8' },
                success: { bg: '#d4edda', color: '#28a745' },
                error: { bg: '#f8d7da', color: '#dc3545' }
            };

            const colorScheme = colors[type] || colors.info;
            statusDiv.style.background = colorScheme.bg;
            statusDiv.style.color = colorScheme.color;
        }

        resetForm() {
            document.getElementById('qp-form').reset();
            document.getElementById('qp-status').style.display = 'none';
            document.getElementById('qp-progress').style.display = 'none';
            document.getElementById('qp-progress-bar').style.width = '0%';
            const submitBtn = document.getElementById('qp-submit-btn');
            submitBtn.textContent = '🚀 开始上架';
            submitBtn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            submitBtn.disabled = false;
        }

        destroy() {
            this.button?.remove();
            this.modal?.remove();
            if (this.pollingInterval) {
                clearInterval(this.pollingInterval);
            }
        }
    }

    // ===== 初始化 =====
    let collector = null;
    let panel = null;
    let quickPublishUI = null;

    function init() {
        // 检测是否为商品详情页
        if (window.location.pathname.includes('/product/')) {
            // 商品详情页：显示一键上架UI
            setTimeout(() => {
                quickPublishUI = new QuickPublishUI();
            }, 2000);
            return;
        }

        // 列表页：显示原有采集界面
        setTimeout(() => {
            collector = new SmartProductCollector();
            panel = new ControlPanel(collector);
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