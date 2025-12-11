/**
 * OZON图片URL优化工具
 * 使用OZON CDN的缩略图功能（/wc{宽度}/）来减少网络传输，加快图片加载
 */

// 全局 CDN 配置（由 Dashboard 初始化时从后端全局设置加载）
let selectedCdn: string | null = null;

/**
 * 设置 OZON 图片 CDN 域名（系统全局设置，由管理员配置）
 * @param cdn CDN 域名（如 cdn1.ozone.ru），传 null 或空字符串恢复默认
 */
export function setOzonImageCdn(cdn: string | null): void {
  selectedCdn = cdn && cdn.trim() ? cdn.trim() : null;
}

/**
 * 获取当前设置的 OZON 图片 CDN 域名
 * @returns CDN 域名，未设置返回 null
 */
export function getOzonImageCdn(): string | null {
  return selectedCdn;
}

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
  // 严格检查参数类型：必须是非空字符串
  if (!url || typeof url !== 'string') return '';

  // 检查是否为OZON图片URL（通过路径特征识别，而非域名）
  // OZON 图片 CDN 域名经常变化，但路径格式 /s3/multimedia-* 是固定的
  const isOzonUrl = url.includes('/s3/multimedia-');
  if (!isOzonUrl) {
    return url;
  }

  // 如果已经包含 /wc 或 /c 参数，先移除（避免重复添加）
  // /wc160/ 是宽度缩放，/c50/ 是 OZON 内部裁剪格式
  let cleanUrl = url.replace(/\/wc\d+\//g, '/').replace(/\/c\d+\//g, '/');

  // 如果设置了自定义 CDN，替换域名
  const cdn = getOzonImageCdn();
  if (cdn) {
    cleanUrl = cleanUrl.replace(/https?:\/\/[^/]+/, `https://${cdn}`);
  }

  // 匹配 s3/multimedia-* 后面的部分，插入 /wc{width}/
  // 支持各种multimedia路径格式：multimedia-1-m, multimedia-r, multimedia-*, 等
  const optimized = cleanUrl.replace(/(\/s3\/multimedia-[^/]+\/)/, `$1wc${targetWidth}/`);

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

  return urls.map((url) => optimizeOzonImageUrl(url, targetWidth));
}
