/**
 * 图片中转工具
 * 用于下载 OZON CDN 图片并转换为 Base64，然后上传到后端图床
 */

const LOG_PREFIX = '[ImageRelay]';

/**
 * 下载图片并转换为 Base64
 * @param url 图片 URL
 * @returns Base64 数据（包含 data URL 前缀），失败返回 null
 */
export async function downloadImageAsBase64(url: string): Promise<string | null> {
    try {
        if (import.meta.env.DEV) {
            console.debug(`${LOG_PREFIX} 开始下载图片: ${url.substring(0, 50)}...`);
        }

        const response = await fetch(url, {
            mode: 'cors',
            credentials: 'include',
            headers: {
                // 模拟浏览器请求
                'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
            }
        });

        if (!response.ok) {
            console.warn(`${LOG_PREFIX} 图片下载失败: ${url.substring(0, 50)}... HTTP ${response.status}`);
            return null;
        }

        const blob = await response.blob();

        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const result = reader.result as string;
                if (import.meta.env.DEV) {
                    console.debug(`${LOG_PREFIX} 图片下载成功: ${url.substring(0, 50)}... 大小: ${blob.size} bytes`);
                }
                resolve(result);
            };
            reader.onerror = () => {
                console.error(`${LOG_PREFIX} FileReader 读取失败: ${url.substring(0, 50)}...`);
                resolve(null);
            };
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error(`${LOG_PREFIX} 图片下载异常: ${url.substring(0, 50)}...`, error);
        return null;
    }
}

/**
 * 批量下载图片
 * @param urls 图片 URL 列表
 * @param onProgress 进度回调
 * @returns 下载结果列表
 */
export async function batchDownloadImages(
    urls: string[],
    onProgress?: (current: number, total: number) => void
): Promise<Array<{ url: string; data: string | null }>> {
    const results: Array<{ url: string; data: string | null }> = [];

    if (import.meta.env.DEV) {
        console.info(`${LOG_PREFIX} 开始批量下载 ${urls.length} 张图片`);
    }

    for (let i = 0; i < urls.length; i++) {
        onProgress?.(i + 1, urls.length);
        const data = await downloadImageAsBase64(urls[i]);
        results.push({ url: urls[i], data });
    }

    const successCount = results.filter(r => r.data !== null).length;
    if (import.meta.env.DEV) {
        console.info(`${LOG_PREFIX} 批量下载完成: 成功 ${successCount}/${urls.length}`);
    }

    return results;
}

/**
 * 收集所有图片 URL（从变体数据中）
 * @param variants 变体数据列表
 * @returns 去重后的图片 URL 列表
 */
export function collectAllImageUrls(variants: any[]): string[] {
    const urls = new Set<string>();

    for (const v of variants) {
        // 主图
        if (v.primary_image && typeof v.primary_image === 'string') {
            urls.add(v.primary_image);
        }

        // 附加图片
        if (v.images && Array.isArray(v.images)) {
            for (const img of v.images) {
                const url = typeof img === 'string' ? img : img?.url;
                if (url && typeof url === 'string') {
                    urls.add(url);
                }
            }
        }
    }

    if (import.meta.env.DEV) {
        console.debug(`${LOG_PREFIX} 收集到 ${urls.size} 个唯一图片 URL`);
    }
    return Array.from(urls);
}

/**
 * 替换变体数据中的图片 URL
 * @param variants 原始变体数据
 * @param mapping URL 映射 {原始URL: 新URL}
 * @returns 替换后的变体数据
 */
export function replaceImageUrls(
    variants: any[],
    mapping: Record<string, string>
): any[] {
    const mappingCount = Object.keys(mapping).length;
    if (import.meta.env.DEV) {
        console.debug(`${LOG_PREFIX} 开始替换图片 URL，映射数量: ${mappingCount}`);
    }

    return variants.map(v => ({
        ...v,
        primary_image: mapping[v.primary_image] || v.primary_image,
        images: v.images?.map((img: any) => {
            const url = typeof img === 'string' ? img : img?.url;
            const newUrl = mapping[url] || url;
            return typeof img === 'string' ? newUrl : { ...img, url: newUrl };
        })
    }));
}

/**
 * 判断 URL 是否已经是图床 URL（无需再中转）
 * @param url 图片 URL
 * @returns 是否为图床 URL
 */
export function isAlreadyStagedUrl(url: string): boolean {
    if (!url) return false;

    const stagedDomains = [
        'res.cloudinary.com',
        'cloudinary.com',
        '.aliyuncs.com',
        'oss-cn-',
        'oss-ap-',
    ];

    return stagedDomains.some(domain => url.includes(domain));
}

/**
 * 过滤需要中转的图片 URL（排除已是图床的 URL）
 * @param urls 图片 URL 列表
 * @returns 需要中转的 URL 列表
 */
export function filterUrlsNeedingRelay(urls: string[]): string[] {
    return urls.filter(url => !isAlreadyStagedUrl(url));
}
