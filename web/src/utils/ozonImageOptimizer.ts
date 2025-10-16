/**
 * OZON图片URL优化工具
 * 使用OZON CDN的缩略图功能（/wc{宽度}/）来减少网络传输，加快图片加载
 */

/**
 * 优化OZON图片URL，添加宽度缩放参数
 *
 * OZON CDN支持按宽度缩放的缩略图路径段，格式为 /wc{宽度}/
 * 例如：/wc1000/ 代表"等比压缩到宽1000像素"
 *
 * @param url 原始图片URL
 * @param targetWidth 目标宽度（像素）
 * @returns 优化后的URL，如果无法优化则返回原URL
 *
 * @example
 * // 原图
 * optimizeOzonImageUrl('https://cdn1.ozone.ru/s3/multimedia-1-m/6943754938.jpg', 160)
 * // 返回：'https://cdn1.ozone.ru/s3/multimedia-1-m/wc160/6943754938.jpg'
 */
export function optimizeOzonImageUrl(url: string | undefined, targetWidth: number): string {
  if (!url) return '';

  // 检查是否为OZON图片URL（支持 ozon.ru 和 ozone.ru）
  const isOzonUrl = url.includes('ozon.ru') || url.includes('ozone.ru');
  if (!isOzonUrl) {
    return url;
  }

  // 如果已经包含 /wc 参数，先移除（避免重复添加）
  let cleanUrl = url.replace(/\/wc\d+\//g, '/');

  // 匹配 s3/multimedia-* 后面的部分，插入 /wc{width}/
  // 支持各种multimedia路径格式：multimedia-1-m, multimedia-r, multimedia-*, 等
  const optimized = cleanUrl.replace(
    /(\/s3\/multimedia-[^\/]+\/)/,
    `$1wc${targetWidth}/`
  );

  // 如果成功替换（URL发生变化），返回优化后的URL；否则返回原URL
  return optimized !== cleanUrl ? optimized : url;
}

/**
 * 批量优化OZON图片URL数组
 *
 * @param urls 图片URL数组
 * @param targetWidth 目标宽度（像素）
 * @returns 优化后的URL数组
 */
export function optimizeOzonImageUrls(urls: string[] | undefined, targetWidth: number): string[] {
  if (!urls || urls.length === 0) return [];

  return urls.map(url => optimizeOzonImageUrl(url, targetWidth));
}
