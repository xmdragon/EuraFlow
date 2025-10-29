import type { PageDataParser } from '../parsers/base';
import type { ProductData, FusionStats } from '../../shared/types';

/**
 * 智能数据融合引擎
 *
 * 从多个数据源（上品帮、毛子ERP）提取数据并动态选择最佳值
 */
export class DataFusionEngine {
  constructor(
    private parsers: PageDataParser[]
  ) {}

  /**
   * 获取所有可用的解析器
   */
  getAvailableParsers(): PageDataParser[] {
    return this.parsers.filter(p => p.isInjected());
  }

  /**
   * 智能融合：从所有可用解析器提取数据，选择最佳值
   */
  async fuseProductData(cardElement: HTMLElement): Promise<ProductData> {
    const available = this.getAvailableParsers();

    if (available.length === 0) {
      throw new Error('未检测到任何数据工具（上品帮/毛子ERP），请先安装至少一个');
    }

    // 1. 等待所有可用工具完成数据注入
    // 注意：parseProductCard 方法内部已经包含了对单个卡片的等待逻辑
    await Promise.all(
      available.map(p => p.waitForInjection?.() || Promise.resolve())
    );

    // 2. 从所有解析器并行提取数据
    // 每个解析器的 parseProductCard 方法会自行等待数据就绪
    const dataList = await Promise.all(
      available.map(async parser => ({
        parser,
        data: await parser.parseProductCard(cardElement)
      }))
    );

    // 3. 融合数据（对每个字段选择最佳值）
    const fused = this.mergeData(dataList);

    // 4. 验证必需字段
    if (!fused.product_id) {
      throw new Error('无法提取商品ID（所有数据源都没有）');
    }

    // 5. 验证关键数据完整性（特别是跟卖数据）
    if (fused.competitor_min_price === undefined && fused.competitor_count === undefined) {
      console.warn('[DataFusionEngine] 警告：跟卖数据可能缺失', {
        sku: fused.product_id,
        product_name: fused.product_name_ru
      });
    }

    return fused as ProductData;
  }

  /**
   * 合并多个数据源的数据
   */
  private mergeData(
    dataList: Array<{ parser: PageDataParser; data: Partial<ProductData> }>
  ): Partial<ProductData> {
    const merged: any = {};

    // 收集所有字段
    const allFields = new Set<keyof ProductData>();
    dataList.forEach(({ data }) => {
      Object.keys(data).forEach(key => allFields.add(key as keyof ProductData));
    });

    // 对每个字段选择最佳值
    for (const field of allFields) {
      merged[field] = this.selectBestValue(field, dataList);
    }

    return merged;
  }

  /**
   * 为单个字段选择最佳值
   */
  private selectBestValue<K extends keyof ProductData>(
    field: K,
    dataList: Array<{ parser: PageDataParser; data: Partial<ProductData> }>
  ): ProductData[K] | undefined {
    // 收集所有非空值
    const values = dataList
      .map(({ parser, data }) => ({ parser, value: data[field] }))
      .filter(({ value }) => !this.isNullish(value));

    // 1. 没有任何数据源有值
    if (values.length === 0) {
      return undefined;
    }

    // 2. 只有一个数据源有值
    if (values.length === 1) {
      return values[0].value as ProductData[K];
    }

    // 3. 多个数据源都有值 → 根据字段类型选择

    // 3.1 数值型：取最大值
    const firstValue = values[0].value;
    if (typeof firstValue === 'number') {
      let maxValue = firstValue;
      for (const { value } of values) {
        if (typeof value === 'number' && value > maxValue) {
          maxValue = value;
        }
      }
      return maxValue as ProductData[K];
    }

    // 3.2 字符串型：根据字段特性选择
    if (typeof firstValue === 'string') {
      return this.selectBestString(field, values) as ProductData[K];
    }

    // 3.3 日期型：取最新的
    if (firstValue instanceof Date) {
      let latestDate = firstValue;
      for (const { value } of values) {
        if (value instanceof Date && value > latestDate) {
          latestDate = value;
        }
      }
      return latestDate as ProductData[K];
    }

    // 默认：返回第一个值
    return firstValue as ProductData[K];
  }

  /**
   * 为字符串字段选择最佳值
   */
  private selectBestString<K extends keyof ProductData>(
    field: K,
    values: Array<{ parser: PageDataParser; value: any }>
  ): string {
    // 品牌：优先毛子ERP（中文识别更准）
    if (field === 'brand') {
      const mzValue = values.find(({ parser }) => parser.toolName === 'maozi-erp');
      if (mzValue && mzValue.value) {
        return mzValue.value;
      }
    }

    // SKU：应该相同，如果不同取长的
    if (field === 'product_id') {
      const longest = values.reduce((max, { value }) => {
        return value.length > max.value.length ? value : max;
      }, values[0].value);
      return longest;
    }

    // 商品名称：取更长/更完整的
    if (field === 'product_name_ru' || field === 'product_name_cn') {
      const longest = values.reduce((max, { value }) => {
        return value.length > max.value.length ? value : max;
      }, values[0].value);
      return longest;
    }

    // URL类：优先有效的（以http开头）
    if (field === 'ozon_link' || field === 'image_url') {
      const validUrl = values.find(({ value }) => value.startsWith('http'));
      if (validUrl) {
        return validUrl.value;
      }
    }

    // 默认：取更长的（信息更完整）
    const longest = values.reduce((max, { value }) => {
      return value.length > max.value.length ? value : max;
    }, values[0].value);
    return longest;
  }

  /**
   * 检查值是否为空
   */
  private isNullish(value: any): boolean {
    return value === null ||
           value === undefined ||
           value === '' ||
           value === '--' ||
           value === 'null' ||
           value === 'undefined';
  }

  /**
   * 获取融合统计信息（用于UI显示）
   */
  async getFusionStats(
    cardElement: HTMLElement
  ): Promise<FusionStats> {
    const available = this.getAvailableParsers();

    if (available.length === 0) {
      return {
        spbFields: 0,
        mzFields: 0,
        totalFields: 0,
        fusedFields: []
      };
    }

    // 从所有解析器提取数据
    const dataList = await Promise.all(
      available.map(async parser => ({
        parser,
        data: await parser.parseProductCard(cardElement)
      }))
    );

    // 统计每个数据源的字段数
    const spbData = dataList.find(({ parser }) => parser.toolName === 'shangpinbang');
    const mzData = dataList.find(({ parser }) => parser.toolName === 'maozi-erp');

    const spbFields = spbData ? this.countFields(spbData.data) : 0;
    const mzFields = mzData ? this.countFields(mzData.data) : 0;

    // 统计融合的字段（两个数据源都有的字段）
    const fusedFields: string[] = [];
    if (spbData && mzData) {
      const spbKeys = new Set(Object.keys(spbData.data));
      const mzKeys = new Set(Object.keys(mzData.data));

      for (const key of spbKeys) {
        if (mzKeys.has(key) &&
            !this.isNullish(spbData.data[key as keyof ProductData]) &&
            !this.isNullish(mzData.data[key as keyof ProductData])) {
          fusedFields.push(key);
        }
      }
    }

    // 总字段数
    const allFields = new Set<string>();
    dataList.forEach(({ data }) => {
      Object.keys(data).forEach(key => allFields.add(key));
    });

    return {
      spbFields,
      mzFields,
      totalFields: allFields.size,
      fusedFields
    };
  }

  /**
   * 统计非空字段数量
   */
  private countFields(data: Partial<ProductData>): number {
    return Object.values(data).filter(v => !this.isNullish(v)).length;
  }

  /**
   * 获取数据源状态（用于UI显示）
   */
  getSourceStatus(): { shangpinbang: boolean; maoziErp: boolean } {
    return {
      shangpinbang: this.parsers.find(p => p.toolName === 'shangpinbang')?.isInjected() || false,
      maoziErp: this.parsers.find(p => p.toolName === 'maozi-erp')?.isInjected() || false
    };
  }
}
