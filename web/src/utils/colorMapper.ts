/**
 * 颜色名称映射工具
 * 用于将 OZON 颜色属性值映射到 CSS 颜色
 */

/**
 * 颜色名称到 CSS 颜色的映射表
 * 支持中文、英文、俄文颜色名称
 */
const COLOR_MAP: Record<string, string> = {
  // 基础颜色 - 中文
  '白色': '#FFFFFF',
  '白': '#FFFFFF',
  '黑色': '#000000',
  '黑': '#000000',
  '红色': '#FF0000',
  '红': '#FF0000',
  '绿色': '#00FF00',
  '绿': '#00FF00',
  '蓝色': '#0000FF',
  '蓝': '#0000FF',
  '黄色': '#FFFF00',
  '黄': '#FFFF00',
  '橙色': '#FFA500',
  '橙': '#FFA500',
  '紫色': '#800080',
  '紫': '#800080',
  '粉色': '#FFC0CB',
  '粉红色': '#FFB6C1',
  '粉': '#FFB6C1',
  '灰色': '#808080',
  '灰': '#808080',
  '棕色': '#A52A2A',
  '棕': '#A52A2A',
  '褐色': '#8B4513',

  // 特殊颜色
  '透明': '#FFFFFF',
  '米色': '#F5F5DC',
  '金色': '#FFD700',
  '金': '#FFD700',
  '银色': '#C0C0C0',
  '银': '#C0C0C0',
  '青铜': '#CD7F32',
  '金属灰色': '#9E9E9E',
  '绿松石': '#40E0D0',
  '天蓝': '#87CEEB',
  '天蓝色': '#87CEEB',
  '深蓝': '#00008B',
  '深蓝色': '#00008B',
  '浅蓝': '#ADD8E6',
  '浅蓝色': '#ADD8E6',
  '深绿': '#006400',
  '深绿色': '#006400',
  '浅绿': '#90EE90',
  '浅绿色': '#90EE90',
  '橄榄': '#808000',
  '橄榄色': '#808000',
  '青色': '#00FFFF',
  '青': '#00FFFF',
  '洋红': '#FF00FF',
  '洋红色': '#FF00FF',
  '深红': '#8B0000',
  '深红色': '#8B0000',
  '浅红': '#FF6B6B',
  '浅红色': '#FF6B6B',
  '酒红': '#990000',
  '酒红色': '#990000',
  '玫红': '#E91E63',
  '玫红色': '#E91E63',
  '橙红': '#FF4500',
  '橙红色': '#FF4500',
  '深棕': '#654321',
  '深棕色': '#654321',
  '浅棕': '#D2691E',
  '浅棕色': '#D2691E',
  '深灰': '#505050',
  '深灰色': '#505050',
  '浅灰': '#D3D3D3',
  '浅灰色': '#D3D3D3',
  '卡其': '#F0E68C',
  '卡其色': '#F0E68C',
  '奶油': '#FFFDD0',
  '奶油色': '#FFFDD0',
  '象牙': '#FFFFF0',
  '象牙色': '#FFFFF0',
  '珊瑚': '#FF7F50',
  '珊瑚色': '#FF7F50',
  '海军蓝': '#000080',
  '宝蓝': '#4169E1',
  '靛蓝': '#4B0082',
  '紫罗兰': '#EE82EE',
  '薰衣草': '#E6E6FA',
  '桃红': '#FFB3BA',
  '杏色': '#FBCEB1',
  '巧克力': '#D2691E',
  '巧克力色': '#D2691E',
  '咖啡': '#6F4E37',
  '咖啡色': '#6F4E37',
  '小麦': '#F5DEB3',
  '小麦色': '#F5DEB3',
  '亚麻': '#FAF0E6',
  '亚麻色': '#FAF0E6',

  // 英文颜色
  'white': '#FFFFFF',
  'black': '#000000',
  'red': '#FF0000',
  'green': '#00FF00',
  'blue': '#0000FF',
  'yellow': '#FFFF00',
  'orange': '#FFA500',
  'purple': '#800080',
  'pink': '#FFC0CB',
  'gray': '#808080',
  'grey': '#808080',
  'brown': '#A52A2A',
  'beige': '#F5F5DC',
  'gold': '#FFD700',
  'silver': '#C0C0C0',
  'bronze': '#CD7F32',
  'turquoise': '#40E0D0',
  'cyan': '#00FFFF',
  'magenta': '#FF00FF',

  // 俄文颜色（音译）
  'белый': '#FFFFFF',  // 白色
  'черный': '#000000', // 黑色
  'красный': '#FF0000', // 红色
  'зеленый': '#00FF00', // 绿色
  'синий': '#0000FF',  // 蓝色
  'желтый': '#FFFF00', // 黄色
  'оранжевый': '#FFA500', // 橙色
  'фиолетовый': '#800080', // 紫色
  'розовый': '#FFC0CB', // 粉色
  'серый': '#808080',  // 灰色
  'коричневый': '#A52A2A', // 棕色
  'бежевый': '#F5F5DC', // 米色
  'золотой': '#FFD700', // 金色
  'серебряный': '#C0C0C0', // 银色
  'бронзовый': '#CD7F32', // 青铜
  'бирюзовый': '#40E0D0', // 绿松石
};

/**
 * 判断属性名称是否为颜色属性
 * @param attributeName 属性名称
 * @returns 是否为颜色属性
 */
export function isColorAttribute(attributeName: string): boolean {
  const lowerName = attributeName.toLowerCase();
  return (
    lowerName.includes('颜色') ||
    lowerName.includes('色') && !lowerName.includes('特色') && !lowerName.includes('着色') && !lowerName.includes('印色') ||
    lowerName.includes('color') ||
    lowerName.includes('цвет') // 俄语"颜色"
  );
}

/**
 * 根据颜色名称获取对应的 CSS 颜色值
 * @param colorName 颜色名称
 * @returns CSS 颜色值（十六进制），如果未找到则返回 null
 */
export function getColorValue(colorName: string): string | null {
  if (!colorName) return null;

  // 清理颜色名称（移除空格、转小写）
  const cleanName = colorName.trim();

  // 优先完全匹配
  if (COLOR_MAP[cleanName]) {
    return COLOR_MAP[cleanName];
  }

  // 尝试不区分大小写匹配
  const lowerName = cleanName.toLowerCase();
  for (const [key, value] of Object.entries(COLOR_MAP)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  // 尝试包含匹配（如"深蓝色系"匹配"深蓝"）
  for (const [key, value] of Object.entries(COLOR_MAP)) {
    if (cleanName.includes(key) || lowerName.includes(key.toLowerCase())) {
      return value;
    }
  }

  return null;
}

/**
 * 判断颜色是否为深色（用于决定文字颜色）
 * @param hexColor 十六进制颜色值
 * @returns 是否为深色
 */
export function isDarkColor(hexColor: string): boolean {
  // 移除 # 号
  const hex = hexColor.replace('#', '');

  // 转换为 RGB
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);

  // 计算亮度（使用 YIQ 公式）
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;

  // 亮度小于 128 认为是深色
  return brightness < 128;
}

/**
 * 获取颜色的文字颜色（深色背景用白字，浅色背景用黑字）
 * @param hexColor 十六进制颜色值
 * @returns 文字颜色
 */
export function getTextColor(hexColor: string): string {
  return isDarkColor(hexColor) ? '#FFFFFF' : '#000000';
}
