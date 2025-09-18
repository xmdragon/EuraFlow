/**
 * OZON-UNI运费数据配置
 */

export interface UNIService {
  code: string; // 服务代码
  name: string; // 渠道名称
  minDays: number; // 最短时效(天)
  maxDays: number; // 最长时效(天)
  avgDays: number; // 平均时效(天)
  baseFee: number; // 基础费用(元)
  rateFee: number; // 费率(元/克)
  formula: string; // 费用公式显示
  minWeight?: number; // 最小重量限制(克)
  maxWeight?: number; // 最大重量限制(克)
  minValue?: number; // 最小货值限制(RMB)
  maxValue?: number; // 最大货值限制(RMB)
  dimensionLimit: {
    // 尺寸限制
    sumLimit?: number; // 三边之和(cm)
    maxSide?: number; // 最长边(cm)
  };
  notes?: string[]; // 注意事项
  msds?: boolean; // 是否需要MSDS
  additionalFee?: string; // 送货上门额外贱用公式
}

export interface UNICategory {
  id: string;
  name: string;
  nameEN: string;
  weightRange: string;
  services: UNIService[];
}

// OZON-UNI运费数据
export const OZON_UNI_DATA: UNICategory[] = [
  {
    id: 'extra-small',
    name: '超级轻小件',
    nameEN: 'UNI Extra Small',
    weightRange: '1g-500g',
    services: [
      {
        code: 'UNE',
        name: 'UNI Express Extra Small',
        minDays: 5,
        maxDays: 10,
        avgDays: 9,
        baseFee: 3,
        rateFee: 0.045,
        formula: '3元 + 0.045元/1克',
        minWeight: 1,
        maxWeight: 500,
        dimensionLimit: {},
        notes: ['没有预制有毒池遥远的运100克结，不需要提供', 'MSDS'],
      },
      {
        code: 'UNI',
        name: 'UNI Standard Extra Small',
        minDays: 10,
        maxDays: 15,
        avgDays: 11,
        baseFee: 3,
        rateFee: 0.035,
        formula: '3元 + 0.035元/1克',
        minWeight: 1,
        maxWeight: 500,
        maxValue: 1500,
        dimensionLimit: {
          sumLimit: 90,
          maxSide: 60,
        },
        notes: ['没有预制，不需要提供', 'MSDS'],
      },
      {
        code: 'UNW',
        name: 'UNI Economy Extra Small',
        minDays: 20,
        maxDays: 25,
        avgDays: 20,
        baseFee: 3,
        rateFee: 0.025,
        formula: '3元 + 0.025元/1克',
        minWeight: 1,
        maxWeight: 500,
        dimensionLimit: {},
        notes: [],
      },
    ],
  },
  {
    id: 'budget',
    name: '低客单标准件',
    nameEN: 'UNI Budget',
    weightRange: '501g-25kg',
    services: [
      {
        code: 'UND',
        name: 'UNI Express Budget',
        minDays: 5,
        maxDays: 10,
        avgDays: 9,
        baseFee: 23,
        rateFee: 0.033,
        formula: '23元 + 0.033元/1克',
        minWeight: 501,
        maxWeight: 25000,
        maxValue: 1500,
        dimensionLimit: {},
        notes: ['没有预制有毒池遥远的运100克结，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNQ',
        name: 'UNI Standard Budget',
        minDays: 10,
        maxDays: 15,
        avgDays: 11,
        baseFee: 23,
        rateFee: 0.025,
        formula: '23元 + 0.025元/1克',
        minWeight: 501,
        maxWeight: 25000,
        maxValue: 1500,
        dimensionLimit: {
          sumLimit: 150,
          maxSide: 60,
        },
        notes: ['没有预制，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNZ',
        name: 'UNI Economy Budget',
        minDays: 20,
        maxDays: 25,
        avgDays: 20,
        baseFee: 23,
        rateFee: 0.017,
        formula: '23元 +0.0170元/1克',
        minWeight: 501,
        maxWeight: 25000,
        maxValue: 1500,
        dimensionLimit: {},
        notes: [],
      },
    ],
  },
  {
    id: 'small',
    name: '轻小件',
    nameEN: 'UNI Small',
    weightRange: '1g-2kg',
    services: [
      {
        code: 'UNA',
        name: 'UNI Express Small',
        minDays: 5,
        maxDays: 10,
        avgDays: 9,
        baseFee: 16,
        rateFee: 0.045,
        formula: '16元 +0.045元/1克',
        minWeight: 1,
        maxWeight: 2000,
        minValue: 1501,
        maxValue: 7000,
        additionalFee: '19.5元 + 0.045元/1克',
        dimensionLimit: {},
        notes: ['没有预制有毒池遥远的运100克结，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNY',
        name: 'UNI Standard Small',
        minDays: 10,
        maxDays: 15,
        avgDays: 11,
        baseFee: 16,
        rateFee: 0.035,
        formula: '16元 +0.035元/1克',
        minWeight: 1,
        maxWeight: 2000,
        minValue: 1501,
        additionalFee: '19.5元 + 0.035元/1克',
        maxValue: 7000,
        dimensionLimit: {
          sumLimit: 150,
          maxSide: 60,
        },
        notes: ['没有预制，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNV',
        name: 'UNI Economy Small',
        minDays: 12,
        maxDays: 17,
        avgDays: 0,
        baseFee: 16,
        rateFee: 0.025,
        formula: '16元 + 0.025元/1克',
        minWeight: 1,
        maxWeight: 2000,
        minValue: 1501,
        maxValue: 7000,
        additionalFee: '19.5元 + 0.025元/1克',
        dimensionLimit: {},
        notes: [],
      },
    ],
  },
  {
    id: 'big',
    name: '大件',
    nameEN: 'UNI Big',
    weightRange: '2.001kg-25kg',
    services: [
      {
        code: 'UNP',
        name: 'UNI Express Big',
        minDays: 5,
        maxDays: 10,
        avgDays: 9,
        baseFee: 36,
        rateFee: 0.033,
        formula: '36元 + 0.033元/1克',
        minWeight: 2001,
        maxWeight: 25000,
        minValue: 1501,
        maxValue: 7000,
        additionalFee: '39.5元 + 0.033元/1克',
        dimensionLimit: {},
        notes: ['没有预制有毒池遥远的运100克结，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNQ',
        name: 'UNI Standard Big',
        minDays: 10,
        maxDays: 15,
        avgDays: 11,
        baseFee: 36,
        rateFee: 0.025,
        formula: '36元 + 0.025元/1克',
        minWeight: 2001,
        maxWeight: 25000,
        minValue: 1501,
        additionalFee: '39.5元 + 0.025元/1克',
        maxValue: 7000,
        dimensionLimit: {
          sumLimit: 250,
          maxSide: 150,
        },
        notes: ['没有预制，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNZ',
        name: 'UNI Economy Big',
        minDays: 20,
        maxDays: 25,
        avgDays: 20,
        baseFee: 36,
        rateFee: 0.017,
        formula: '36元 +0.017元/1克',
        minWeight: 2001,
        maxWeight: 25000,
        minValue: 1501,
        maxValue: 7000,
        additionalFee: '39.5元 + 0.017元/1克',
        dimensionLimit: {},
        notes: [],
      },
    ],
  },
  {
    id: 'premium-small',
    name: '高客单轻小件',
    nameEN: 'UNI Premium Small',
    weightRange: '1g-5kg',
    services: [
      {
        code: 'UNA',
        name: 'UNI Express Premium Small',
        minDays: 5,
        maxDays: 10,
        avgDays: 9,
        baseFee: 22,
        rateFee: 0.045,
        formula: '22元 +0.045元/1克',
        minWeight: 1,
        maxWeight: 5000,
        minValue: 7001,
        additionalFee: '25.5元 +0.045元/1克',
        dimensionLimit: {},
        notes: ['没有预制有毒池遥远的运100克结，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNL',
        name: 'UNI Standard Premium Small',
        minDays: 10,
        maxDays: 15,
        avgDays: 11,
        baseFee: 22,
        rateFee: 0.035,
        formula: '22元 + 0.035元/1克',
        minWeight: 1,
        maxWeight: 5000,
        minValue: 7001,
        additionalFee: '25.5元 + 0.035元/1克',
        maxValue: 250000,
        dimensionLimit: {
          sumLimit: 250,
          maxSide: 150,
        },
        notes: ['没有预制，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNM',
        name: 'UNI Economy Premium Small',
        minDays: 13,
        maxDays: 18,
        avgDays: 0,
        baseFee: 22,
        rateFee: 0.025,
        formula: '22元 + 0.0250元/1克',
        minWeight: 1,
        maxWeight: 5000,
        minValue: 7001,
        additionalFee: '25.5元 +0.0250元/1克',
        dimensionLimit: {},
        notes: [],
      },
    ],
  },
  {
    id: 'premium-big',
    name: '高客单大件',
    nameEN: 'UNI Premium Big',
    weightRange: '5.001kg-25kg',
    services: [
      {
        code: 'UNP',
        name: 'UNI Express Premium Big',
        minDays: 5,
        maxDays: 10,
        avgDays: 9,
        baseFee: 62,
        rateFee: 0.033,
        formula: '62元 + 0.033元/1克',
        minWeight: 5001,
        maxWeight: 25000,
        minValue: 7001,
        additionalFee: '65.5元 +0.033元/1克',
        dimensionLimit: {},
        notes: ['没有预制有毒池遥远的运100克结，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNO',
        name: 'UNI Standard Premium Big',
        minDays: 10,
        maxDays: 15,
        avgDays: 11,
        baseFee: 62,
        rateFee: 0.028,
        formula: '62元 + 0.028元/1克',
        minWeight: 5001,
        maxWeight: 25000,
        minValue: 7001,
        additionalFee: '65.5元 + 0.028元/1克',
        maxValue: 250000,
        dimensionLimit: {
          sumLimit: 310,
          maxSide: 150,
        },
        notes: ['没有预制，不需要提供', 'MSDS'],
        msds: true,
      },
      {
        code: 'UNZ',
        name: 'UNI Economy Premium Big',
        minDays: 20,
        maxDays: 25,
        avgDays: 0,
        baseFee: 62,
        rateFee: 0.023,
        formula: '62元 + 0.023元/1克',
        minWeight: 5001,
        maxWeight: 25000,
        minValue: 7001,
        additionalFee: '65.5元 + 0.023元/1克',
        dimensionLimit: {},
        notes: [],
      },
    ],
  },
];

// 计算体积重量（长×宽×高/5000）
export function calculateVolumeWeight(length: number, width: number, height: number): number {
  return (length * width * height) / 5000;
}

// 计算计费重量（实际重量和体积重量的较大值）
export function calculateChargeableWeight(actualWeight: number, volumeWeight: number): number {
  return Math.max(actualWeight, volumeWeight);
}

// 计算运费
export function calculateShippingFee(
  service: UNIService,
  weight: number,
  isDelivery: boolean = false
): number {
  const baseFee =
    isDelivery && service.additionalFee
      ? parseFloat(service.additionalFee.split('+')[0])
      : service.baseFee;
  return baseFee + weight * service.rateFee;
}

// 检查服务是否适用
export function checkServiceAvailable(
  service: UNIService,
  weight: number,
  value: number,
  sumDimension: number,
  maxDimension: number
): { available: boolean; reason?: string } {
  // 检查最小重量限制
  if (service.minWeight && weight < service.minWeight) {
    return { available: false, reason: `低于最小重量限制 ${service.minWeight}g` };
  }

  // 检查最大重量限制
  if (service.maxWeight && weight > service.maxWeight) {
    return { available: false, reason: `超过最大重量限制 ${service.maxWeight}g` };
  }

  // 检查最小货值限制
  if (service.minValue && value < service.minValue) {
    return { available: false, reason: `低于最小货值限制 ${service.minValue} RMB` };
  }

  // 检查最大货值限制
  if (service.maxValue && value > service.maxValue) {
    return { available: false, reason: `超过最大货值限制 ${service.maxValue} RMB` };
  }

  // 检查尺寸限制
  if (service.dimensionLimit.sumLimit && sumDimension > service.dimensionLimit.sumLimit) {
    return { available: false, reason: `三边之和超过限制 ${service.dimensionLimit.sumLimit}cm` };
  }

  if (service.dimensionLimit.maxSide && maxDimension > service.dimensionLimit.maxSide) {
    return { available: false, reason: `最长边超过限制 ${service.dimensionLimit.maxSide}cm` };
  }

  return { available: true };
}
