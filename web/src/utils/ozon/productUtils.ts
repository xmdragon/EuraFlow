/**
 * 商品相关工具函数
 */

// 西里尔字母到拉丁字母的音译映射表
export const translitMap: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

/**
 * 将商品标题转换为OZON URL slug格式（拉丁字母）
 * @param title 商品标题
 * @returns URL slug
 */
export const generateOzonSlug = (title: string): string => {
  if (!title) return '';

  // 转换为小写并音译西里尔字母
  const transliterated = title.toLowerCase().split('').map(char => {
    return translitMap[char] || char;
  }).join('');

  return transliterated
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // 只保留拉丁字母、数字、空格和连字符
    .replace(/\s+/g, '-') // 将空格替换为连字符
    .replace(/-+/g, '-') // 将多个连字符替换为单个
    .replace(/^-|-$/g, ''); // 移除首尾的连字符
};
