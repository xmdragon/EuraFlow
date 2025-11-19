import { DataFusionEngine } from './fusion/engine';
import { spbApiClient } from '../shared/spbang-api-client';
import { additionalDataClient } from '../shared/additional-data-client';
import type { ProductData, CollectionProgress } from '../shared/types';

declare global {
  interface Window {
    EURAFLOW_DEBUG: boolean;
  }
}

if (typeof window.EURAFLOW_DEBUG === 'undefined') {
  window.EURAFLOW_DEBUG = false;
}

interface CollectingProduct {
  data: ProductData;
  isComplete: boolean;
  checkCount: number;
}

export class ProductCollector {
  public isRunning = false;
  private collected = new Map<string, ProductData>();
  private uploadedFingerprints = new Set<string>();
  private progress: CollectionProgress = {
    collected: 0,
    target: 0,
    isRunning: false,
    errors: []
  };

  private scrollStepSize = 0.5;
  private scrollCount = 0;
  private noChangeCount = 0;
  private onProgressCallback?: (progress: CollectionProgress) => void;

  constructor(private fusionEngine: DataFusionEngine) {}

  async startCollection(
    targetCount: number,
    onProgress?: (progress: CollectionProgress) => void
  ): Promise<ProductData[]> {
    if (this.isRunning) {
      throw new Error('采集已在运行中');
    }

    this.onProgressCallback = onProgress;

    const debugFlag = localStorage.getItem('EURAFLOW_DEBUG');
    if (debugFlag === 'true' || debugFlag === '1') {
      window.EURAFLOW_DEBUG = true;
      console.log('[EuraFlow] 🐞 调试模式已启用');
    }

    this.isRunning = true;
    this.collected.clear();
    this.scrollCount = 0;
    this.noChangeCount = 0;
    this.scrollStepSize = 0.5;

    this.progress = {
      collected: 0,
      target: targetCount,
      isRunning: true,
      errors: []
    };

    try {
      await this.waitAndCollect(targetCount);
      onProgress?.(this.progress);

      let lastCollectedCount = this.collected.size;
      let sameCountTimes = 0;
      let forceScrollCount = 0;
      const maxScrollAttempts = 200;
      const noChangeThreshold = 5;

      while (this.isRunning && this.scrollCount < maxScrollAttempts) {
        this.scrollCount++;

        if (this.collected.size >= targetCount) {
          break;
        }

        const currentScroll = window.scrollY;
        const pageHeight = document.body.scrollHeight;
        const viewportHeight = window.innerHeight;
        const isNearBottom = currentScroll + viewportHeight >= pageHeight - 100;

        let scrollDistance;
        if (isNearBottom) {
          const latestPageHeight = document.body.scrollHeight;
          scrollDistance = latestPageHeight - currentScroll;
        } else {
          scrollDistance = viewportHeight * this.scrollStepSize;
        }

        window.scrollTo({
          top: currentScroll + scrollDistance,
          behavior: 'smooth'
        });

        const actualNewCount = await this.waitAndCollect(targetCount);
        const afterCount = this.collected.size;

        if (actualNewCount === 0) {
          this.noChangeCount++;

          if (afterCount === lastCollectedCount) {
            sameCountTimes++;

            // 强制滚到底部（最多3次）
            if (sameCountTimes >= 3 && afterCount < targetCount) {
              forceScrollCount++;

              if (forceScrollCount <= 3) {
                window.scrollTo(0, document.body.scrollHeight);
                await this.sleep(500);

                const newPageHeight = document.body.scrollHeight;
                if (newPageHeight > pageHeight) {
                  // 页面高度增加，重置计数器
                  sameCountTimes = 0;
                  this.noChangeCount = 0;
                  continue;
                }
              } else {
                // 强制滚动3次后仍无新增，停止采集
                if (afterCount > 0) {
                  break;
                }
              }
            }
          } else {
            sameCountTimes = 0;
          }

          // 无变化阈值检查
          if (this.noChangeCount >= noChangeThreshold * 2) {
            break;
          }
        } else {
          // 有新增：重置所有计数器
          this.noChangeCount = 0;
          sameCountTimes = 0;
          forceScrollCount = 0;
          lastCollectedCount = afterCount;

          // 【动态调整滚动速度】.
          if (actualNewCount > 5) {
            // 新增较多：加速
            this.scrollStepSize = Math.min(this.scrollStepSize * 1.1, 2);
          } else if (actualNewCount === 0) {
            // 无新增：减速
            this.scrollStepSize = Math.max(this.scrollStepSize * 0.9, 0.8);
          }
        }

        // 随机延迟（1000-2000ms），等待页面加载新商品
        const randomDelay = Math.floor(Math.random() * 1000) + 1000;
        await this.sleep(randomDelay);
      }

      const products = Array.from(this.collected.values());

      // 【阶段2】批量调用上品帮API获取销售数据
      if (products.length > 0) {
        this.progress.status = '正在获取销售数据...';
        onProgress?.(this.progress);

        console.log(`%c[阶段2: 销售数据] 开始获取 ${products.length} 个商品的销售数据`, 'color: #1890ff; font-weight: bold');

        try {
          const skus = products.map(p => p.product_id);

          const spbDataMap = await spbApiClient.getSalesDataInBatches(
            skus,
            (current, total) => {
              this.progress.status = `获取销售数据: ${current}/${total}`;
              onProgress?.(this.progress);
            }
          );

          console.log(`[销售数据] API返回Map大小: ${spbDataMap.size}`);
          if (spbDataMap.size > 0) {
            const firstEntry = Array.from(spbDataMap.entries())[0];
            console.log(`[销售数据] Map第一条 SKU=${firstEntry[0]}:`, firstEntry[1]);
            console.log(`[销售数据] 包装数据:`, {
              weight: firstEntry[1]?.weight,
              depth: firstEntry[1]?.depth,
              width: firstEntry[1]?.width,
              height: firstEntry[1]?.height
            });
          }

          // 合并上品帮数据到已采集的商品
          let successCount = 0;
          products.forEach((product, index) => {
            const spbData = spbDataMap.get(product.product_id);
            if (spbData) {
              // 合并数据到临时数组（保留OZON原生数据，补充上品帮数据）
              Object.assign(product, spbData);

              // 同步更新 this.collected 中的数据
              const collectedProduct = this.collected.get(product.product_id);
              if (collectedProduct) {
                Object.assign(collectedProduct, spbData);
              }

              // 品牌标准化
              if (spbData.brand && !product.brand_normalized) {
                product.brand_normalized = spbData.brand.toUpperCase().replace(/\s+/g, '_');
              }

              successCount++;

              // 输出前3个合并结果
              if (window.EURAFLOW_DEBUG && index < 3) {
                console.log(`[销售数据] 合并后 ${product.product_id}:`, {
                  月销量: product.monthly_sales_volume,
                  包装重量: product.weight,
                  深度: product.depth
                });
              }
            }
          });

          console.log(`%c[阶段2: 销售数据] 成功 ${successCount}/${products.length}`, 'color: #52c41a; font-weight: bold');

          // 【降级方案】检查哪些商品缺少尺寸数据，调用OZON Seller API补充
          const productsWithoutDimensions = products.filter(p =>
            !p.weight || !p.depth || !p.width || !p.height
          );

          if (productsWithoutDimensions.length > 0) {
            console.log(`%c[尺寸降级] 发现 ${productsWithoutDimensions.length}/${products.length} 个商品缺少尺寸，调用OZON Seller API`, 'color: #faad14; font-weight: bold');

            let dimensionSuccessCount = 0;
            for (const product of productsWithoutDimensions) {
              try {
                // 调用OZON Seller API获取尺寸
                const response = await chrome.runtime.sendMessage({
                  type: 'GET_OZON_PRODUCT_DETAIL',
                  data: {
                    productSku: product.product_id,
                    cookieString: document.cookie
                  }
                });

                if (response.success && response.data?.dimensions) {
                  const dim = response.data.dimensions;
                  // 补充缺失的尺寸数据
                  if (!product.weight && dim.weight) product.weight = parseFloat(dim.weight);
                  if (!product.depth && dim.depth) product.depth = parseFloat(dim.depth);
                  if (!product.width && dim.width) product.width = parseFloat(dim.width);
                  if (!product.height && dim.height) product.height = parseFloat(dim.height);

                  // 同步到 this.collected
                  const collectedProduct = this.collected.get(product.product_id);
                  if (collectedProduct) {
                    if (!collectedProduct.weight && product.weight) collectedProduct.weight = product.weight;
                    if (!collectedProduct.depth && product.depth) collectedProduct.depth = product.depth;
                    if (!collectedProduct.width && product.width) collectedProduct.width = product.width;
                    if (!collectedProduct.height && product.height) collectedProduct.height = product.height;
                  }

                  dimensionSuccessCount++;
                  console.log(`[尺寸降级] SKU=${product.product_id} 成功获取尺寸:`, {
                    weight: product.weight,
                    depth: product.depth,
                    width: product.width,
                    height: product.height
                  });
                }
              } catch (error: any) {
                console.warn(`[尺寸降级] SKU=${product.product_id} 失败:`, error.message);
              }

              // 延迟50ms避免限流
              if (product !== productsWithoutDimensions[productsWithoutDimensions.length - 1]) {
                await new Promise(resolve => setTimeout(resolve, 50));
              }
            }

            console.log(`%c[尺寸降级] 完成 ${dimensionSuccessCount}/${productsWithoutDimensions.length}`, 'color: #52c41a; font-weight: bold');
          } else {
            console.log('%c[尺寸降级] 跳过，所有商品均有完整尺寸数据', 'color: #52c41a; font-weight: bold');
          }

        } catch (error: any) {
          console.error('%c[阶段2: 销售数据] 失败:', 'color: #ff4d4f; font-weight: bold', error.message);
          // 容错：即使上品帮API失败，也返回OZON原生数据
        }
      }

      // 【阶段3】批量获取佣金数据
      if (products.length > 0) {
        this.progress.status = '正在获取佣金数据...';
        onProgress?.(this.progress);

        console.log(`%c[阶段3: 佣金数据] 开始获取 ${products.length} 个商品的佣金数据`, 'color: #1890ff; font-weight: bold');

        try {
          // 准备佣金API请求参数（需要 goods_id 和 category_name）
          // ⚠️ 不过滤！即使没有category也尝试调用API（上品帮会处理）
          const goodsForCommissions = products.map(p => ({
            goods_id: p.product_id,
            category_name: p.category_level_1 || p.category_path?.split(' > ')[0] || '未知类目'
          }));

          console.log(`[佣金数据] 准备请求:`, {
            总数: goodsForCommissions.length,
            有类目: products.filter(p => p.category_level_1).length,
            无类目: products.filter(p => !p.category_level_1).length,
            示例: goodsForCommissions.slice(0, 2)
          });

          const commissionsMap = await additionalDataClient.getCommissionsDataBatch(goodsForCommissions);

          console.log(`[佣金数据] API返回Map大小: ${commissionsMap.size}`);
          if (commissionsMap.size > 0) {
            const firstEntry = Array.from(commissionsMap.entries())[0];
            console.log(`[佣金数据] Map第一条 SKU=${firstEntry[0]}:`, firstEntry[1]);
            console.log(`[佣金数据] 原始值:`, {
              rfbs_commission_low: firstEntry[1]?.rfbs_commission_low,
              rfbs_commission_mid: firstEntry[1]?.rfbs_commission_mid,
              rfbs_commission_high: firstEntry[1]?.rfbs_commission_high,
              fbp_commission_low: firstEntry[1]?.fbp_commission_low,
              fbp_commission_mid: firstEntry[1]?.fbp_commission_mid,
              fbp_commission_high: firstEntry[1]?.fbp_commission_high
            });
          } else {
            console.warn(`[佣金数据] ⚠️ API返回的Map是空的！检查API调用`);
          }

          // 合并佣金数据
          let successCount = 0;
          products.forEach((product, index) => {
            const commissionData = commissionsMap.get(product.product_id);
            if (commissionData) {
              // 合并数据到临时数组
              Object.assign(product, commissionData);

              // 同步更新 this.collected 中的数据
              const collectedProduct = this.collected.get(product.product_id);
              if (collectedProduct) {
                Object.assign(collectedProduct, commissionData);
              }

              successCount++;

              // 输出前3个合并结果
              if (window.EURAFLOW_DEBUG && index < 3) {
                console.log(`[佣金数据] 合并后 ${product.product_id}:`, {
                  rfbs_mid: product.rfbs_commission_mid,
                  fbp_mid: product.fbp_commission_mid
                });
              }
            }
          });

          console.log(`%c[阶段3: 佣金数据] 成功 ${successCount}/${goodsForCommissions.length}`, 'color: #52c41a; font-weight: bold');
        } catch (error: any) {
          console.error('%c[阶段3: 佣金数据] 失败:', 'color: #ff4d4f; font-weight: bold', error.message);
          // 容错：佣金数据获取失败不影响主流程
        }
      }

      // 【阶段4】逐个获取跟卖数据（避免限流）
      if (products.length > 0) {
        console.log(`%c[阶段4: 跟卖数据] 开始逐个获取 ${products.length} 个商品的跟卖数据`, 'color: #1890ff; font-weight: bold');

        try {
          let successCount = 0;
          let errorCount = 0;

          for (let i = 0; i < products.length; i++) {
            const product = products[i];

            this.progress.status = `获取跟卖数据: ${i + 1}/${products.length}`;
            onProgress?.(this.progress);

            try {
              const followSellerData = await additionalDataClient.getFollowSellerDataSingle(product.product_id);

              if (followSellerData) {
                // 合并跟卖数据到product对象
                Object.assign(product, followSellerData);

                // 同时更新 this.collected 中的数据
                const collectedProduct = this.collected.get(product.product_id);
                if (collectedProduct) {
                  Object.assign(collectedProduct, followSellerData);
                }

                successCount++;

                // ✅ 跟卖数据获取成功，该商品所有数据完整，更新进度
                this.progress.collected = successCount + errorCount;
                this.onProgressCallback?.(this.progress);

                // 输出前3个合并结果
                if (window.EURAFLOW_DEBUG && i < 3) {
                  console.log(`[跟卖数据] 第${i+1}个 ${product.product_id}:`, {
                    count: product.follow_seller_count,
                    min_price: product.follow_seller_min_price,
                    原始数据: followSellerData
                  });
                }
              } else {
                errorCount++;

                // ⚠️ 跟卖数据获取失败，但商品已有基础+销售+佣金数据，也计入进度
                this.progress.collected = successCount + errorCount;
                this.onProgressCallback?.(this.progress);
              }
            } catch (error: any) {
              console.warn(`[跟卖数据] SKU=${product.product_id} 获取失败:`, error.message);
              errorCount++;

              // ⚠️ 即使出错，也计入进度（商品至少有基础+销售+佣金数据）
              this.progress.collected = successCount + errorCount;
              this.onProgressCallback?.(this.progress);
            }

            // 延迟150-200ms（防止限流）
            if (i < products.length - 1) {
              const delay = 150 + Math.random() * 50;
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }

          console.log(`%c[阶段4: 跟卖数据] 完成 成功=${successCount} 失败=${errorCount}`, 'color: #52c41a; font-weight: bold');
        } catch (error: any) {
          console.error('%c[阶段4: 跟卖数据] 失败:', 'color: #ff4d4f; font-weight: bold', error.message);
          // 容错：跟卖数据获取失败不影响主流程
        }

        this.progress.status = '采集完成';
        onProgress?.(this.progress);

        console.log('%c所有数据融合完成', 'color: #52c41a; font-weight: bold');

        // 验证 this.collected 是否包含完整数据
        const collectedProducts = Array.from(this.collected.values());
        console.log(`[DEBUG] this.collected 大小: ${this.collected.size}`);
        console.log(`[DEBUG] products 大小: ${products.length}`);

        // 输出前3个商品的完整数据
        console.table(products.slice(0, 3).map(p => ({
          SKU: p.product_id,
          标题: p.product_name_ru?.substring(0, 30) + '...',
          价格: p.current_price,
          月销量: p.monthly_sales_volume,
          重量: p.weight,
          深度: p.depth,
          宽度: p.width,
          高度: p.height,
          'rFBS佣金(中)': p.rfbs_commission_mid,
          'FBP佣金(中)': p.fbp_commission_mid,
          跟卖数量: p.follow_seller_count,
          最低跟卖价: p.follow_seller_min_price
        })));

        // 再次验证 this.collected 中的数据
        console.log('[DEBUG] this.collected 前3个商品:');
        console.table(collectedProducts.slice(0, 3).map(p => ({
          SKU: p.product_id,
          重量: p.weight,
          深度: p.depth,
          跟卖数量: p.follow_seller_count,
          'rFBS佣金': p.rfbs_commission_mid
        })));
      }

      // 上传数据（如果配置了自动上传）
      // 注意：自动上传由外部控制，这里不自动上传
      // 上传逻辑应该在 ControlPanel 的 stopCollection 中处理

      // 限制返回数量不超过目标数量
      return products.slice(0, targetCount);
    } finally {
      this.isRunning = false;
      this.progress.isRunning = false;
      onProgress?.(this.progress);

      if (window.EURAFLOW_DEBUG) {
        console.log('[DEBUG] 采集器已停止');
      }
    }
  }

  /**
   * 停止采集
   */
  stopCollection(): void {
    this.isRunning = false;
    this.progress.isRunning = false;
  }

  /**
   * 获取当前进度
   */
  getProgress(): CollectionProgress {
    return { ...this.progress };
  }

  /**
   * 获取已采集的商品
   */
  getCollectedProducts(): ProductData[] {
    return Array.from(this.collected.values());
  }

  /**
   * 采集当前可见的商品（两阶段采集 + SKU属性标记 + 轮询增强）
   *
   * @deprecated 已被 waitAndCollect 替代，保留此方法用于备用/调试
   *
   * 阶段1：快速采集所有已有数据（几百毫秒）
   * 阶段2：轮询增强关键数据（最多2秒）
   * 阶段3：存储到已采集集合
   */
  // @ts-ignore - 保留用于备用/调试
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async collectVisibleProducts(targetCount?: number): Promise<void> {
    const cards = this.getVisibleProductCards();

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG] 开始两阶段采集，可见商品: ${cards.length}个`);
    }

    // ====== 阶段1：快速采集所有已有数据 ======
    const tempMap = new Map<string, CollectingProduct>();

    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];

      if (!this.isRunning) break;

      try {
        // 【优化】先快速提取 SKU，避免对重复商品做完整数据提取
        const sku = this.quickExtractSKU(card);
        if (!sku) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 阶段1] 第 ${i + 1} 个卡片无法提取SKU，跳过`);
          }
          continue;
        }

        // 跳过已采集或已上传的商品（基于 SKU 指纹）
        if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 阶段1] 跳过已采集商品: ${sku}`);
          }
          continue;
        }

        if (targetCount && (tempMap.size + this.collected.size) >= targetCount) {
          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG 阶段1] 已达目标数量，停止采集 (tempMap=${tempMap.size}, collected=${this.collected.size}, target=${targetCount})`);
          }
          break;
        }

        // 【关键】给卡片添加 data-sku 属性，方便后续定位
        card.setAttribute('data-sku', sku);

        // 立即采集完整数据（不等待）
        const product = await this.fusionEngine.fuseProductDataImmediate(card);

        if (product.product_id) {

          tempMap.set(product.product_id, {
            data: product,
            isComplete: this.isProductComplete(product),
            checkCount: 0
          });

          if (window.EURAFLOW_DEBUG) {
            // 【增强】更清晰地显示重量值（区分undefined、0和数字）
            const weightDisplay = product.weight === undefined
              ? 'undefined(未加载)'
              : (product.weight === 0 ? '0(无数据)' : `${product.weight}g`);

            console.log(`[DEBUG 阶段1] 采集 ${tempMap.size}/${targetCount || '∞'}: ${product.product_id}`, {
              完整: this.isProductComplete(product),
              'rFBS(高/中/低)': `${product.rfbs_commission_high}/${product.rfbs_commission_mid}/${product.rfbs_commission_low}`,
              重量: weightDisplay,
              跟卖: product.competitor_count
            });
          }
        }
      } catch (error: any) {
        this.progress.errors.push(error.message);
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG 阶段1] 第 ${i + 1} 个卡片采集失败:`, error.message);
        }
      }
    }

    // 更新进度
    this.progress.collected = tempMap.size;
    const completeCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
    this.progress.status = `快速采集完成: ${completeCount}/${tempMap.size} 完整`;
    this.onProgressCallback?.(this.progress);

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG 阶段1] 完成，已采集 ${tempMap.size} 个商品，其中 ${completeCount} 个数据完整`);
    }

    // ====== 阶段2：轮询增强关键数据 ======
    const maxRounds = 40;  // 最多40轮 × 50ms = 2秒
    let round = 0;

    while (this.hasIncompleteProducts(tempMap) && round < maxRounds && this.isRunning) {
      await this.sleep(50);
      round++;

      let enhancedCount = 0;

      for (const [sku, item] of tempMap) {
        if (item.isComplete) continue;

        // 【关键】通过 data-sku 属性快速定位卡片
        const card = document.querySelector(`[data-sku="${sku}"]`) as HTMLElement;
        if (!card) {
          if (window.EURAFLOW_DEBUG) {
            console.warn(`[DEBUG] 找不到卡片 [data-sku="${sku}"]，可能已被移除`);
          }
          continue;
        }

        try {
          // 重新提取数据（不等待）
          const updated = await this.fusionEngine.fuseProductDataImmediate(card);

          // 【优化】智能合并：只更新从undefined变为有值的字段
          const beforeData = { ...item.data };
          this.smartMerge(item.data, updated);
          const wasComplete = item.isComplete;
          item.isComplete = this.isProductComplete(item.data);
          item.checkCount++;

          // DEBUG：仅在有新字段被填充时打印
          if (window.EURAFLOW_DEBUG) {
            const newlyFilledFields = this.getNewlyFilledFields(beforeData, item.data);
            if (newlyFilledFields.length > 0) {
              console.log(`[DEBUG 阶段2] SKU=${sku} 新填充字段:`, newlyFilledFields);
            }
          }

          // 数据从不完整变为完整
          if (!wasComplete && item.isComplete) {
            enhancedCount++;
            if (window.EURAFLOW_DEBUG) {
              console.log(`[DEBUG 阶段2] 数据完整 (第${round}轮): ${sku}`, {
                'rFBS(高/中/低)': `${item.data.rfbs_commission_high}/${item.data.rfbs_commission_mid}/${item.data.rfbs_commission_low}`,
                重量: item.data.weight,
                跟卖: item.data.competitor_count
              });
            }
          }
        } catch (error: any) {
          // 轮询增强失败不影响已有数据
          if (window.EURAFLOW_DEBUG) {
            console.warn(`[DEBUG 阶段2] SKU ${sku} 增强失败:`, error.message);
          }
        }
      }

      // 更新进度
      const newCompleteCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
      this.progress.status = `增强中 (第${round}轮)... ${newCompleteCount}/${tempMap.size} 完整`;
      this.onProgressCallback?.(this.progress);

      if (window.EURAFLOW_DEBUG && enhancedCount > 0) {
        console.log(`[DEBUG 阶段2] 第${round}轮：${enhancedCount} 个商品数据完整`);
      }
    }

    // 轮询结束统计
    const finalCompleteCount = Array.from(tempMap.values()).filter(p => p.isComplete).length;
    const incompleteCount = tempMap.size - finalCompleteCount;

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG 阶段2] 完成，共${round}轮，完整 ${finalCompleteCount}/${tempMap.size}`);
      if (incompleteCount > 0) {
        console.warn(`[DEBUG] 仍有 ${incompleteCount} 个商品数据不完整`);
        // 输出不完整的商品SKU
        const incompleteSKUs = Array.from(tempMap.entries())
          .filter(([, item]) => !item.isComplete)
          .map(([sku]) => sku);
        console.warn('[DEBUG] 不完整商品SKU:', incompleteSKUs);
      }
    }

    // ====== 阶段3：移动到已采集集合 ======
    for (const [sku, item] of tempMap) {
      if (!this.collected.has(sku) && !this.uploadedFingerprints.has(sku)) {
        this.collected.set(sku, item.data);

        if (window.EURAFLOW_DEBUG) {
          const weightDisplay = item.data.weight !== undefined
            ? (item.data.weight === 0 ? '无数据' : item.data.weight)
            : '✗';

          console.log(`[DEBUG 阶段3] 存储: ${sku}`, {
            完整: item.isComplete,
            检测轮数: item.checkCount,
            'rFBS(高/中/低)': `${item.data.rfbs_commission_high || '✗'}/${item.data.rfbs_commission_mid || '✗'}/${item.data.rfbs_commission_low || '✗'}`,
            重量: weightDisplay,
            跟卖: item.data.competitor_count !== undefined ? '✓' : '✗'
          });
        }
      }
    }

    // 最终进度
    this.progress.collected = this.collected.size;
    this.progress.status = incompleteCount > 0
      ? `完成 (${incompleteCount}个不完整)`
      : '完成';
    this.onProgressCallback?.(this.progress);
  }

  /**
   * 判断商品数据是否完整（关键数据都已加载）
   *
   * 关键数据：rFBS佣金、包装重量、跟卖数据
   *
   * 【修正】数据状态：
   * - undefined = 未加载（上品帮还在渲染，页面显示"-"）
   * - "无数据" = 已加载完成（上品帮确认无数据）
   * - 实际值 = 已加载完成（有数据）
   */
  private isProductComplete(product: Partial<ProductData>): boolean {
    if (!product.product_id) return false;

    // 【修正】数据状态说明：
    // - undefined = 未加载（上品帮还在渲染，显示"-"）
    // - "无数据" = 已加载完成（上品帮确认无数据）
    // - 数字/字符串 = 已加载完成（有实际数据）

    // 关键数据1：rFBS佣金（三个档位至少有一个不是 undefined）
    const hasRFBS = product.rfbs_commission_high !== undefined ||
                    product.rfbs_commission_mid !== undefined ||
                    product.rfbs_commission_low !== undefined;

    // 关键数据2：包装重量
    const hasWeight = product.weight !== undefined;

    // 关键数据3：跟卖数据（数量或价格至少有一个不是 undefined）
    const hasCompetitor = product.competitor_count !== undefined ||
                          product.competitor_min_price !== undefined;

    return hasRFBS && hasWeight && hasCompetitor;
  }

  /**
   * 检查是否还有不完整的商品
   */
  private hasIncompleteProducts(map: Map<string, CollectingProduct>): boolean {
    return Array.from(map.values()).some(p => !p.isComplete);
  }

  /**
   * 智能合并：只更新目标对象中值为 undefined 的字段
   *
   * @param target 目标对象（会被修改）
   * @param source 源对象（提供新值）
   */
  private smartMerge(target: Partial<ProductData>, source: Partial<ProductData>): void {
    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const targetValue = target[key as keyof ProductData];
        const sourceValue = source[key as keyof ProductData];

        // 只有当目标字段是 undefined 且源字段有值时，才更新
        if (targetValue === undefined && sourceValue !== undefined) {
          (target as any)[key] = sourceValue;
        }
      }
    }
  }

  /**
   * 获取从 undefined 变为有值的字段列表
   *
   * @param before 更新前的数据
   * @param after 更新后的数据
   * @returns 新填充的字段名列表
   */
  private getNewlyFilledFields(before: Partial<ProductData>, after: Partial<ProductData>): string[] {
    const filled: string[] = [];

    for (const key in after) {
      if (after.hasOwnProperty(key)) {
        const beforeValue = before[key as keyof ProductData];
        const afterValue = after[key as keyof ProductData];

        // 字段从 undefined 变为有值（包括 "无数据"、0、空字符串等）
        if (beforeValue === undefined && afterValue !== undefined) {
          filled.push(key);
        }
      }
    }

    return filled;
  }

  /**
   * 等待上品帮数据注入（优化：等待新商品注入完成）
   *
   * @deprecated 已被 waitAndCollect 内部逻辑替代，保留此方法用于备用/调试
   */
  // @ts-ignore - 保留用于备用/调试
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async waitForShangpinbangData(maxAttempts: number): Promise<void> {
    const interval = 100;

    // 获取所有商品卡片（不管有没有标记）
    const allCardsSelector = '[data-widget="searchResultsV2"] > div, [data-widget="megaPaginator"] > div, .tile-root, div[class*="tile"]';

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const allCards = Array.from(document.querySelectorAll<HTMLElement>(allCardsSelector))
        .filter(card => !!card.querySelector('a[href*="/product/"]')); // 有商品链接的卡片

      if (allCards.length === 0) {
        await this.sleep(interval);
        continue;
      }

      // 检查所有商品卡片中有多少已被注入数据
      const markedCount = allCards.filter(card => {
        const hasShangpinbang = card.getAttribute('data-ozon-bang') === 'true';
        return hasShangpinbang;
      }).length;

      const ratio = markedCount / allCards.length;

      if (window.EURAFLOW_DEBUG && attempt % 5 === 0) {
        console.log(`[DEBUG] 等待数据注入（尝试 ${attempt + 1}/${maxAttempts}）: ${markedCount}/${allCards.length} (${(ratio * 100).toFixed(0)}%)`);
      }

      // 如果80%以上的商品都已注入数据，认为可以开始采集
      if (ratio >= 0.8) {
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG] 数据注入就绪: ${markedCount}/${allCards.length} 个商品已标记`);
        }
        return;
      }

      await this.sleep(interval);
    }

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG] 上品帮数据等待超时（${maxAttempts * interval}ms）`);
    }
  }

  /**
   * 获取所有商品卡片（不管有没有数据标记）
   * @returns 所有商品卡片数组
   */
  private getAllProductCards(): HTMLElement[] {
    const selectors = [
      '[data-widget="searchResultsV2"] > div',
      '[data-widget="megaPaginator"] > div',
      '.tile-root',
      'div[class*="tile"]'
    ];

    let allCards: HTMLElement[] = [];
    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        allCards = Array.from(elements);
        break;
      }
    }

    // 只返回有商品链接的卡片
    return allCards.filter(card => !!card.querySelector('a[href*="/product/"]'));
  }

  /**
   * 边检测边采集（核心方法）
   * 每50ms检测一次，发现新注入数据的商品就立即采集
   * @param targetCount 目标采集数量
   * @returns 本轮新采集的商品数量
   */
  private async waitAndCollect(targetCount: number): Promise<number> {
    const maxRounds = 60;  // 60轮 × 50ms = 3秒
    const alreadyProcessed = new Set<string>(); // 已处理的SKU（包括跳过的）
    let newCollectedCount = 0;

    for (let round = 0; round < maxRounds; round++) {
      if (!this.isRunning) break;

      if (this.collected.size >= targetCount) {
        break;
      }

      // 1. 获取所有商品卡片
      const allCards = this.getAllProductCards();

      if (allCards.length === 0) {
        await this.sleep(50);
        continue;
      }

      // 2. 第一轮：严格按DOM顺序采集；后续轮：按数据就绪速度采集
      if (round === 0) {
        // 【第一轮】按DOM顺序逐个检查和采集
        for (const card of allCards) {
          if (!this.isRunning) break;
          if (this.collected.size >= targetCount) break;

          const sku = this.quickExtractSKU(card);
          if (!sku) continue;

          // 已处理过的跳过
          if (alreadyProcessed.has(sku)) continue;
          if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
            alreadyProcessed.add(sku);
            continue;
          }

          // 立即采集OZON原生数据（不等待上品帮标记）
          alreadyProcessed.add(sku);

          // 采集单个商品（仅OZON原生数据）
          const product = await this.collectSingleProduct(card, sku);

          if (product) {
            this.collected.set(sku, product);
            newCollectedCount++;

            if (window.EURAFLOW_DEBUG) {
              console.log(`[DEBUG waitAndCollect] ✓ 采集成功 ${sku} (${this.collected.size}/${targetCount})`);
            }
          } else {
            if (window.EURAFLOW_DEBUG) {
              console.warn(`[DEBUG waitAndCollect] ✗ 采集失败 ${sku}`);
            }
          }
        }
      } else {
        // 【后续轮】按数据就绪速度采集（不按DOM顺序）
        const newReadyCards: Array<{ card: HTMLElement; sku: string }> = [];

        for (const card of allCards) {
          const sku = this.quickExtractSKU(card);
          if (!sku) continue;

          // 已经处理过（成功或失败）
          if (alreadyProcessed.has(sku)) continue;

          // 已采集或已上传
          if (this.collected.has(sku) || this.uploadedFingerprints.has(sku)) {
            alreadyProcessed.add(sku);
            continue;
          }

          // 立即采集（不等待上品帮标记）
          newReadyCards.push({ card, sku });
        }

        // 立即采集这些新商品
        for (const { card, sku } of newReadyCards) {
          if (!this.isRunning) break;
          if (this.collected.size >= targetCount) break;

          alreadyProcessed.add(sku);

          if (window.EURAFLOW_DEBUG) {
            console.log(`[DEBUG waitAndCollect] 第${round}轮 发现新商品 ${sku}，开始采集...`);
          }

          // 采集单个商品（仅OZON原生数据）
          const product = await this.collectSingleProduct(card, sku);

          if (product) {
            this.collected.set(sku, product);
            newCollectedCount++;

            if (window.EURAFLOW_DEBUG) {
              console.log(`[DEBUG waitAndCollect] ✓ 采集成功 ${sku} (${this.collected.size}/${targetCount})`);
            }
          } else {
            if (window.EURAFLOW_DEBUG) {
              console.warn(`[DEBUG waitAndCollect] ✗ 采集失败 ${sku}`);
            }
          }
        }
      }

      // 4. 检查是否所有商品都已处理
      if (alreadyProcessed.size >= allCards.length) {
        if (window.EURAFLOW_DEBUG) {
          console.log(`[DEBUG waitAndCollect] 所有商品已处理完毕 (${alreadyProcessed.size}/${allCards.length})`);
        }
        break;
      }

      // 5. 等待 50ms 进行下一轮检测
      await this.sleep(50);

      // DEBUG：每5轮输出一次进度
      if (window.EURAFLOW_DEBUG && round % 5 === 0 && round > 0) {
        const ratio = alreadyProcessed.size / allCards.length;
        console.log(`[DEBUG waitAndCollect] 第${round}轮 已处理=${alreadyProcessed.size}/${allCards.length} (${(ratio * 100).toFixed(0)}%), 新采集=${newCollectedCount}`);
      }
    }

    if (window.EURAFLOW_DEBUG) {
      console.log(`[DEBUG waitAndCollect] 完成，本轮新采集 ${newCollectedCount} 个商品`);
    }

    return newCollectedCount;
  }

  /**
   * 采集单个商品（包括轮询增强）
   * @param card 商品卡片元素
   * @param sku 商品SKU
   * @returns 商品数据或null
   */
  private async collectSingleProduct(card: HTMLElement, sku: string): Promise<ProductData | null> {
    try {
      // 1. 给卡片添加 data-sku 属性，方便后续定位
      card.setAttribute('data-sku', sku);

      // 2. 快速提取数据
      const product = await this.fusionEngine.fuseProductDataImmediate(card);

      if (!product.product_id) {
        return null;
      }

      if (window.EURAFLOW_DEBUG) {
        console.log(`[DEBUG 采集OZON数据] ${sku}`, {
          标题: product.product_name_ru,
          当前价格: product.current_price,
          原价: product.original_price,
          评分: product.rating,
          评论数: product.review_count
        });
      }

      return product;
    } catch (error: any) {
      if (window.EURAFLOW_DEBUG) {
        console.error(`[DEBUG 采集失败] SKU=${sku}:`, error.message);
      }
      return null;
    }
  }

  /**
   * 快速提取商品卡片的 SKU（用于去重判断）
   * @param card 商品卡片元素
   * @returns SKU 或 undefined
   */
  private quickExtractSKU(card: HTMLElement): string | undefined {
    const link = card.querySelector<HTMLAnchorElement>('a[href*="/product/"]');
    if (!link || !link.href) {
      return undefined;
    }

    // 从URL末尾提取SKU（格式：/product/name-SKU/或/product/name-SKU?params）
    const urlParts = link.href.split('/product/');
    if (urlParts.length <= 1) {
      return undefined;
    }

    // 提取路径部分，去除查询参数
    const pathPart = urlParts[1].split('?')[0].replace(/\/$/, '');

    // 提取最后的数字SKU（通常在最后一个连字符后）
    const lastDashIndex = pathPart.lastIndexOf('-');
    if (lastDashIndex === -1) {
      return undefined;
    }

    const potentialSKU = pathPart.substring(lastDashIndex + 1);

    // 验证是否为纯数字且长度合理（通常6位以上）
    if (/^\d{6,}$/.test(potentialSKU)) {
      return potentialSKU;
    }

    return undefined;
  }

  /**
   * 获取当前可见的商品卡片
   * 【重要】仅返回有数据工具标记的商品（上品帮）
   */
  private getVisibleProductCards(): HTMLElement[] {
    // 获取所有可能的商品卡片
    const selectors = [
      '[data-widget="searchResultsV2"] > div',
      '[data-widget="megaPaginator"] > div',
      '.tile-root',
      'div[class*="tile"]'
    ];

    let allCards: HTMLElement[] = [];
    for (const selector of selectors) {
      const elements = document.querySelectorAll<HTMLElement>(selector);
      if (elements.length > 0) {
        allCards = Array.from(elements);
        break;
      }
    }

    if (allCards.length === 0) {
      return [];
    }

    // 【关键过滤】只返回有数据工具标记的商品
    const filtered = allCards.filter(card => {
      // 检查是否有商品链接
      const hasProductLink = !!card.querySelector('a[href*="/product/"]');
      if (!hasProductLink) {
        return false;
      }

      // 检查上品帮标记
      const hasShangpinbang = card.getAttribute('data-ozon-bang') === 'true';

      // 必须有上品帮标记
      return hasShangpinbang;
    });

    return filtered;
  }

  /**
   * 延迟函数
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * 更新指纹集（用于精确数量控制）
   * @param uploaded 已上传的商品SKU列表
   * @param notUploaded 未上传的商品SKU列表（需要从指纹集移除）
   */
  updateFingerprints(uploaded: string[], notUploaded: string[]): void {
    // 添加已上传的商品到指纹集
    uploaded.forEach(sku => this.uploadedFingerprints.add(sku));
    // 移除未上传的商品（确保下次能重新采集）
    notUploaded.forEach(sku => this.uploadedFingerprints.delete(sku));
  }

  /**
   * 获取累计采集统计
   */
  getCumulativeStats(): { totalUploaded: number; currentBatch: number } {
    return {
      totalUploaded: this.uploadedFingerprints.size,
      currentBatch: this.collected.size
    };
  }

  /**
   * 重置采集器（清空所有数据）
   * 注意：这个方法一般不需要调用，因为页面刷新/跳转时会自动重置
   */
  reset(): void {
    this.collected.clear();
    this.uploadedFingerprints.clear();
    this.progress = {
      collected: 0,
      target: 0,
      isRunning: false,
      errors: []
    };
  }
}
