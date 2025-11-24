/**
 * 图片分辨率调整工具
 * 支持裁剪和填充模式
 */

export type ResizeStrategy =
  | 'auto'
  | 'crop_horizontal' // 左右裁剪
  | 'crop_vertical' // 上下裁剪
  | 'pad_horizontal' // 左右填充
  | 'pad_vertical'; // 上下填充

export interface ResizeOptions {
  width: number;
  height: number;
  strategy?: ResizeStrategy;
  fillColor?: string; // 填充颜色，默认白色
}

export interface ResizeResult {
  base64: string;
  width: number;
  height: number;
  strategy: ResizeStrategy;
}

/**
 * 计算智能裁剪/填充策略
 * 差异小（<15%）→ 裁剪；差异大（≥15%）→ 填充
 */
export function calculateResizeStrategy(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Exclude<ResizeStrategy, 'auto'> {
  const sourceRatio = sourceWidth / sourceHeight;
  const targetRatio = targetWidth / targetHeight;
  const ratioDiff = Math.abs(sourceRatio - targetRatio);

  // 差异小（<15%）→ 裁剪
  if (ratioDiff < 0.15) {
    if (sourceRatio > targetRatio) {
      return 'crop_horizontal'; // 原图更宽，裁剪左右
    } else {
      return 'crop_vertical'; // 原图更高，裁剪上下
    }
  }
  // 差异大（≥15%）→ 填充
  else {
    if (sourceRatio > targetRatio) {
      return 'pad_vertical'; // 原图更宽，上下填充
    } else {
      return 'pad_horizontal'; // 原图更高，左右填充
    }
  }
}

/**
 * 加载图片
 */
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous'; // 处理跨域
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

/**
 * 调整图片分辨率
 */
export async function resizeImage(
  imageUrl: string,
  options: ResizeOptions
): Promise<ResizeResult> {
  const { width: targetWidth, height: targetHeight, strategy = 'auto', fillColor = '#FFFFFF' } = options;

  // 加载原图
  const img = await loadImage(imageUrl);
  const sourceWidth = img.naturalWidth;
  const sourceHeight = img.naturalHeight;

  // 计算实际策略
  const actualStrategy = strategy === 'auto'
    ? calculateResizeStrategy(sourceWidth, sourceHeight, targetWidth, targetHeight)
    : strategy;

  // 创建Canvas
  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;

  // 填充白色背景（用于填充模式）
  if (actualStrategy.startsWith('pad')) {
    ctx.fillStyle = fillColor;
    ctx.fillRect(0, 0, targetWidth, targetHeight);
  }

  // 根据策略绘制图片
  if (actualStrategy === 'crop_horizontal') {
    // 左右裁剪：先缩放使高度等于目标高度，然后裁剪宽度
    const scale = targetHeight / sourceHeight;
    const scaledWidth = sourceWidth * scale;
    const _offsetX = (scaledWidth - targetWidth) / 2;

    // 绘制时：从原图居中裁剪，缩放到目标尺寸
    ctx.drawImage(
      img,
      (sourceWidth - targetWidth / scale) / 2, // sx: 原图裁剪起始X
      0, // sy: 原图裁剪起始Y
      targetWidth / scale, // sWidth: 原图裁剪宽度
      sourceHeight, // sHeight: 原图裁剪高度
      0, // dx: 目标画布X
      0, // dy: 目标画布Y
      targetWidth, // dWidth: 目标宽度
      targetHeight // dHeight: 目标高度
    );
  } else if (actualStrategy === 'crop_vertical') {
    // 上下裁剪：先缩放使宽度等于目标宽度，然后裁剪高度
    const scale = targetWidth / sourceWidth;
    const scaledHeight = sourceHeight * scale;
    const _offsetY = (scaledHeight - targetHeight) / 2;

    // 绘制时：从原图居中裁剪，缩放到目标尺寸
    ctx.drawImage(
      img,
      0, // sx: 原图裁剪起始X
      (sourceHeight - targetHeight / scale) / 2, // sy: 原图裁剪起始Y
      sourceWidth, // sWidth: 原图裁剪宽度
      targetHeight / scale, // sHeight: 原图裁剪高度
      0, // dx: 目标画布X
      0, // dy: 目标画布Y
      targetWidth, // dWidth: 目标宽度
      targetHeight // dHeight: 目标高度
    );
  } else if (actualStrategy === 'pad_horizontal') {
    // 左右填充：先缩放使高度等于目标高度，然后左右填充白色
    const scale = targetHeight / sourceHeight;
    const scaledWidth = sourceWidth * scale;
    const offsetX = (targetWidth - scaledWidth) / 2;

    // 绘制整个原图，缩放后居中放置
    ctx.drawImage(
      img,
      0, // sx
      0, // sy
      sourceWidth, // sWidth
      sourceHeight, // sHeight
      offsetX, // dx: 居中放置
      0, // dy
      scaledWidth, // dWidth: 缩放后的宽度
      targetHeight // dHeight
    );
  } else if (actualStrategy === 'pad_vertical') {
    // 上下填充：先缩放使宽度等于目标宽度，然后上下填充白色
    const scale = targetWidth / sourceWidth;
    const scaledHeight = sourceHeight * scale;
    const offsetY = (targetHeight - scaledHeight) / 2;

    // 绘制整个原图，缩放后居中放置
    ctx.drawImage(
      img,
      0, // sx
      0, // sy
      sourceWidth, // sWidth
      sourceHeight, // sHeight
      0, // dx
      offsetY, // dy: 居中放置
      targetWidth, // dWidth
      scaledHeight // dHeight: 缩放后的高度
    );
  }

  // 转为Base64
  const base64 = canvas.toDataURL('image/jpeg', 0.9);

  return {
    base64,
    width: targetWidth,
    height: targetHeight,
    strategy: actualStrategy,
  };
}

/**
 * 预设分辨率配置
 */
export const PRESET_RESOLUTIONS = [
  { label: '900x1200px (3:4)', width: 900, height: 1200 },
  { label: '800x800px (1:1)', width: 800, height: 800 },
  { label: '1000x1000px (1:1)', width: 1000, height: 1000 },
  { label: '1200x1200px (1:1)', width: 1200, height: 1200 },
];

/**
 * 策略显示名称
 */
export const STRATEGY_LABELS: Record<Exclude<ResizeStrategy, 'auto'>, string> = {
  crop_horizontal: '左右裁剪',
  crop_vertical: '上下裁剪',
  pad_horizontal: '左右填充（白色）',
  pad_vertical: '上下填充（白色）',
};
