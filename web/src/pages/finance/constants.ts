/**
 * 利润计算器场景配置
 */

export interface ScenarioConfig {
  id: string;
  title: string;
  icon: string;
  weightRange: string;
  priceRange: string;
  defaultPlatformRate: number; // 默认平台扣点率（小数形式）
  packingFee: number; // 打包费（RMB）
  shipping: {
    base: number; // 基础运费（RMB）
    rate: number; // 每克费率（RMB/克）
    formula: string; // 显示用的公式文本
  };
  conditions: {
    minWeight?: number; // 克
    maxWeight?: number; // 克
    minPrice?: number; // RMB
    maxPrice?: number; // RMB
  };
  dimensionLimit: {
    sumLimit: number; // 三边之和限制（厘米）
    maxSideLimit: number; // 最长边限制（厘米）
    description: string; // 显示文本
  };
  color: {
    primary: string; // 主色
    background: string; // 背景色
  };
  transportMode?: string; // 运输方式：'air-land'(陆空) | 'land'(陆运/纯陆)
  matchGroup?: string; // 匹配组：用于识别可同时对比的场景
}

export const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'super-light',
    title: '超级轻小件（陆空）',
    icon: '📦',
    weightRange: '≤500g',
    priceRange: '<1500 RUB',
    defaultPlatformRate: 0.14,
    packingFee: 0,
    shipping: {
      base: 3,
      rate: 0.035,
      formula: '3 + 0.035 × 重量(克)',
    },
    conditions: {
      maxWeight: 500,
      maxPrice: 1500,
    },
    dimensionLimit: {
      sumLimit: 90,
      maxSideLimit: 60,
      description: '三边之和≤90厘米，最长边≤60厘米',
    },
    color: {
      primary: '#1890ff',
      background: '#e6f7ff',
    },
    transportMode: 'air-land',
    matchGroup: 'super-light',
  },
  {
    id: 'super-light-land',
    title: '超级轻小件（陆运）',
    icon: '📦',
    weightRange: '≤500g',
    priceRange: '<1500 RUB',
    defaultPlatformRate: 0.14,
    packingFee: 0,
    shipping: {
      base: 3,
      rate: 0.026,
      formula: '3 + 0.026 × 重量(克)',
    },
    conditions: {
      maxWeight: 500,
      maxPrice: 1500,
    },
    dimensionLimit: {
      sumLimit: 90,
      maxSideLimit: 60,
      description: '三边之和≤90厘米，最长边≤60厘米',
    },
    color: {
      primary: '#52c41a',
      background: '#f6ffed',
    },
    transportMode: 'land',
    matchGroup: 'super-light',
  },
  {
    id: 'light-standard',
    title: '轻单标准件（纯陆）',
    icon: '📋',
    weightRange: '501g-25kg',
    priceRange: '<1500 RUB',
    defaultPlatformRate: 0.14,
    packingFee: 0,
    shipping: {
      base: 23,
      rate: 0.017,
      formula: '23 + 0.017 × 重量(克)',
    },
    conditions: {
      minWeight: 501,
      maxWeight: 25000,
      maxPrice: 1500,
    },
    dimensionLimit: {
      sumLimit: 150,
      maxSideLimit: 60,
      description: '三边之和≤150厘米，最长边≤60厘米',
    },
    color: {
      primary: '#52c41a',
      background: '#f6ffed',
    },
    transportMode: 'land',
  },
  {
    id: 'light-item',
    title: '轻小件（纯陆）',
    icon: '🎁',
    weightRange: '1g-2kg',
    priceRange: '1500-7000 RUB',
    defaultPlatformRate: 0.2,
    packingFee: 0,
    shipping: {
      base: 16,
      rate: 0.025,
      formula: '16 + 0.025 × 重量(克)',
    },
    conditions: {
      minWeight: 1,
      maxWeight: 2000,
      minPrice: 1500,
      maxPrice: 7000,
    },
    dimensionLimit: {
      sumLimit: 150,
      maxSideLimit: 60,
      description: '三边之和≤150厘米，最长边≤60厘米',
    },
    color: {
      primary: '#722ed1',
      background: '#f9f0ff',
    },
    transportMode: 'land',
  },
  {
    id: 'large-item',
    title: '大件（陆空）',
    icon: '📪',
    weightRange: '2.1kg-25kg',
    priceRange: '1501-7000 RUB',
    defaultPlatformRate: 0.2,
    packingFee: 0,
    shipping: {
      base: 36,
      rate: 0.025,
      formula: '36 + 0.025 × 重量(克)',
    },
    conditions: {
      minWeight: 2100,
      maxWeight: 25000,
      minPrice: 1501,
      maxPrice: 7000,
    },
    dimensionLimit: {
      sumLimit: 250,
      maxSideLimit: 150,
      description: '三边之和≤250厘米，最长边≤150厘米',
    },
    color: {
      primary: '#fa8c16',
      background: '#fff7e6',
    },
    transportMode: 'air-land',
  },
  {
    id: 'high-value-light',
    title: '高客单轻小件（陆空）',
    icon: '💎',
    weightRange: '1g-5kg',
    priceRange: '>7000 RUB',
    defaultPlatformRate: 0.2,
    packingFee: 0,
    shipping: {
      base: 22,
      rate: 0.035,
      formula: '22 + 0.035 × 重量(克)',
    },
    conditions: {
      minWeight: 1,
      maxWeight: 5000,
      minPrice: 7000,
    },
    dimensionLimit: {
      sumLimit: 250,
      maxSideLimit: 150,
      description: '三边之和≤250厘米，最长边≤150厘米',
    },
    color: {
      primary: '#eb2f96',
      background: '#fff0f6',
    },
    transportMode: 'air-land',
  },
  {
    id: 'high-value-large',
    title: '高客单大件（陆空）',
    icon: '🏆',
    weightRange: '5.1kg-25kg',
    priceRange: '>7000 RUB',
    defaultPlatformRate: 0.2,
    packingFee: 0,
    shipping: {
      base: 62,
      rate: 0.028,
      formula: '62 + 0.028 × 重量(克)',
    },
    conditions: {
      minWeight: 5100,
      maxWeight: 25000,
      minPrice: 7000,
    },
    dimensionLimit: {
      sumLimit: 310,
      maxSideLimit: 150,
      description: '三边之和≤310厘米，最长边≤150厘米',
    },
    color: {
      primary: '#13c2c2',
      background: '#e6fffb',
    },
    transportMode: 'air-land',
  },
];
