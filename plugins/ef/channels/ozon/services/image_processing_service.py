"""
图片处理服务
实现智能水印定位和图片合成

性能优化：
- 复用 httpx.AsyncClient 连接，避免重复 TLS 握手
- CPU 密集计算移到线程池，避免阻塞事件循环
"""

from PIL import Image, ImageEnhance, ImageOps
import numpy as np
from typing import Dict, Any, Optional, List, Tuple, Union
from io import BytesIO
import httpx
import logging
import asyncio
from enum import Enum

from ef_core.utils.logger import get_logger

logger = get_logger(__name__)


class WatermarkPosition(Enum):
    """水印位置枚举"""
    TOP_LEFT = "top_left"
    TOP_CENTER = "top_center"
    TOP_RIGHT = "top_right"
    CENTER_LEFT = "center_left"
    CENTER = "center"
    CENTER_RIGHT = "center_right"
    BOTTOM_LEFT = "bottom_left"
    BOTTOM_CENTER = "bottom_center"
    BOTTOM_RIGHT = "bottom_right"


class ImageProcessingService:
    """
    图片处理服务（性能优化版）

    特性：
    - HTTP 连接复用，批量下载时避免重复 TLS 握手
    - 线程池支持，CPU 密集计算不阻塞事件循环
    """

    # 位置坐标映射（相对位置）
    POSITION_RATIOS = {
        WatermarkPosition.TOP_LEFT: (0.1, 0.1),
        WatermarkPosition.TOP_CENTER: (0.5, 0.1),
        WatermarkPosition.TOP_RIGHT: (0.9, 0.1),
        WatermarkPosition.CENTER_LEFT: (0.1, 0.5),
        WatermarkPosition.CENTER: (0.5, 0.5),
        WatermarkPosition.CENTER_RIGHT: (0.9, 0.5),
        WatermarkPosition.BOTTOM_LEFT: (0.1, 0.9),
        WatermarkPosition.BOTTOM_CENTER: (0.5, 0.9),
        WatermarkPosition.BOTTOM_RIGHT: (0.9, 0.9)
    }

    def __init__(self):
        """初始化图片处理服务"""
        self._http_client: Optional[httpx.AsyncClient] = None
        self._client_lock = asyncio.Lock()

    async def get_client(self) -> httpx.AsyncClient:
        """
        获取复用的 HTTP 客户端（单例模式）

        Returns:
            httpx.AsyncClient 实例
        """
        if self._http_client is None:
            async with self._client_lock:
                # 双重检查锁定
                if self._http_client is None:
                    self._http_client = httpx.AsyncClient(
                        timeout=30.0,
                        limits=httpx.Limits(
                            max_connections=10,  # 最大连接数
                            max_keepalive_connections=5  # 保持活动的连接数
                        ),
                        follow_redirects=True
                    )
                    logger.info("Created shared HTTP client for image processing")
        return self._http_client

    async def close(self):
        """关闭 HTTP 客户端，释放资源"""
        if self._http_client is not None:
            await self._http_client.aclose()
            self._http_client = None
            logger.info("Closed HTTP client for image processing")

    async def download_image(self, url: str, timeout: int = 30) -> Image.Image:
        """
        下载图片并转换为PIL Image对象（使用连接复用）

        Args:
            url: 图片URL
            timeout: 超时时间（秒）

        Returns:
            PIL Image对象
        """
        try:
            # 使用复用的客户端，避免重复 TLS 握手
            client = await self.get_client()
            response = await client.get(url, timeout=timeout)
            response.raise_for_status()

            image = Image.open(BytesIO(response.content))

            # 转换为RGB模式（处理RGBA、P模式等）
            if image.mode not in ('RGB', 'RGBA'):
                image = image.convert('RGB')

            logger.info(f"Downloaded image from {url}, size: {image.size}, mode: {image.mode}")
            return image

        except httpx.HTTPError as e:
            logger.error(f"Failed to download image from {url}: {e}")
            raise
        except Exception as e:
            logger.error(f"Failed to process downloaded image: {e}")
            raise

    async def load_watermark(
        self,
        watermark_path_or_url: str
    ) -> Image.Image:
        """
        加载水印图片

        Args:
            watermark_path_or_url: 水印文件路径或URL

        Returns:
            水印Image对象
        """
        try:
            if watermark_path_or_url.startswith(('http://', 'https://')):
                watermark = await self.download_image(watermark_path_or_url)
            else:
                watermark = Image.open(watermark_path_or_url)

            # 确保水印有透明通道
            if watermark.mode != 'RGBA':
                watermark = watermark.convert('RGBA')

            logger.info(f"Loaded watermark, size: {watermark.size}")
            return watermark

        except Exception as e:
            logger.error(f"Failed to load watermark: {e}")
            raise

    def calculate_region_brightness(
        self,
        image: Image.Image,
        position: WatermarkPosition,
        region_size: Tuple[int, int]
    ) -> float:
        """
        计算图片特定区域的平均亮度

        Args:
            image: 原图
            position: 位置
            region_size: 区域大小

        Returns:
            平均亮度值（0-255）
        """
        try:
            # 转换为灰度图用于亮度分析
            gray_image = image.convert('L')
            img_array = np.array(gray_image)

            # 获取位置坐标
            x_ratio, y_ratio = self.POSITION_RATIOS[position]
            center_x = int(x_ratio * image.width)
            center_y = int(y_ratio * image.height)

            # 计算区域边界
            half_width = region_size[0] // 2
            half_height = region_size[1] // 2

            x1 = max(0, center_x - half_width)
            y1 = max(0, center_y - half_height)
            x2 = min(image.width, center_x + half_width)
            y2 = min(image.height, center_y + half_height)

            # 提取区域并计算平均亮度
            region = img_array[y1:y2, x1:x2]
            avg_brightness = np.mean(region)

            return float(avg_brightness)

        except Exception as e:
            logger.error(f"Failed to calculate region brightness: {e}")
            return 128.0  # 返回中等亮度作为默认值

    def calculate_region_complexity(
        self,
        image: Image.Image,
        position: WatermarkPosition,
        region_size: Tuple[int, int]
    ) -> float:
        """
        计算图片特定区域的复杂度（标准差）

        Args:
            image: 原图
            position: 位置
            region_size: 区域大小

        Returns:
            复杂度值（0-255，越低表示区域越平滑）
        """
        try:
            # 转换为灰度图
            gray_image = image.convert('L')
            img_array = np.array(gray_image)

            # 获取位置坐标
            x_ratio, y_ratio = self.POSITION_RATIOS[position]
            center_x = int(x_ratio * image.width)
            center_y = int(y_ratio * image.height)

            # 计算区域边界
            half_width = region_size[0] // 2
            half_height = region_size[1] // 2

            x1 = max(0, center_x - half_width)
            y1 = max(0, center_y - half_height)
            x2 = min(image.width, center_x + half_width)
            y2 = min(image.height, center_y + half_height)

            # 提取区域并计算标准差
            region = img_array[y1:y2, x1:x2]
            std_dev = np.std(region)

            return float(std_dev)

        except Exception as e:
            logger.error(f"Failed to calculate region complexity: {e}")
            return 50.0  # 返回中等复杂度作为默认值

    def calculate_edge_density(
        self,
        image: Image.Image,
        position: WatermarkPosition,
        region_size: Tuple[int, int]
    ) -> float:
        """
        计算图片特定区域的边缘密度（使用Sobel算子）

        Args:
            image: 原图
            position: 位置
            region_size: 区域大小

        Returns:
            边缘密度（0-1，越低表示区域越平滑，没有文字或复杂图案）
        """
        try:
            from scipy import ndimage

            # 转换为灰度图
            gray_image = image.convert('L')
            img_array = np.array(gray_image, dtype=np.float32)

            # 获取位置坐标
            x_ratio, y_ratio = self.POSITION_RATIOS[position]
            center_x = int(x_ratio * image.width)
            center_y = int(y_ratio * image.height)

            # 计算区域边界
            half_width = region_size[0] // 2
            half_height = region_size[1] // 2

            x1 = max(0, center_x - half_width)
            y1 = max(0, center_y - half_height)
            x2 = min(image.width, center_x + half_width)
            y2 = min(image.height, center_y + half_height)

            # 提取区域
            region = img_array[y1:y2, x1:x2]

            # 应用Sobel算子检测边缘
            sobel_x = ndimage.sobel(region, axis=1)
            sobel_y = ndimage.sobel(region, axis=0)
            edge_magnitude = np.sqrt(sobel_x**2 + sobel_y**2)

            # 计算边缘密度（边缘像素占比）
            threshold = 30  # 边缘阈值
            edge_pixels = np.sum(edge_magnitude > threshold)
            total_pixels = region.size
            edge_density = edge_pixels / total_pixels if total_pixels > 0 else 0

            return float(edge_density)

        except Exception as e:
            logger.error(f"Failed to calculate edge density: {e}")
            return 0.1  # 返回低边缘密度作为默认值

    def detect_text_region(
        self,
        image: Image.Image,
        position: WatermarkPosition,
        region_size: Tuple[int, int]
    ) -> float:
        """
        检测区域是否包含文字（通过梯度投影分析）

        Args:
            image: 原图
            position: 位置
            region_size: 区域大小

        Returns:
            文字概率（0-1，越高表示越可能有文字）
        """
        try:
            # 转换为灰度图
            gray_image = image.convert('L')
            img_array = np.array(gray_image, dtype=np.uint8)

            # 获取区域
            x_ratio, y_ratio = self.POSITION_RATIOS[position]
            center_x = int(x_ratio * image.width)
            center_y = int(y_ratio * image.height)

            half_width = region_size[0] // 2
            half_height = region_size[1] // 2

            x1 = max(0, center_x - half_width)
            y1 = max(0, center_y - half_height)
            x2 = min(image.width, center_x + half_width)
            y2 = min(image.height, center_y + half_height)

            region = img_array[y1:y2, x1:x2]

            # 计算水平和垂直方向的梯度
            grad_x = np.abs(np.diff(region, axis=1))
            grad_y = np.abs(np.diff(region, axis=0))

            # 投影到水平和垂直轴
            h_projection = np.sum(grad_x, axis=1)
            v_projection = np.sum(grad_y, axis=0)

            # 分析投影的周期性（文字通常有规律的间隔）
            h_std = np.std(h_projection) if len(h_projection) > 0 else 0
            v_std = np.std(v_projection) if len(v_projection) > 0 else 0

            # 检测峰值数量（多个峰值表示可能有文字行）
            h_mean = np.mean(h_projection) if len(h_projection) > 0 else 0
            v_mean = np.mean(v_projection) if len(v_projection) > 0 else 0

            h_peaks = np.sum(h_projection > h_mean * 1.5) if h_mean > 0 else 0
            v_peaks = np.sum(v_projection > v_mean * 1.5) if v_mean > 0 else 0

            # 计算峰值密度
            h_peak_density = h_peaks / max(len(h_projection), 1)
            v_peak_density = v_peaks / max(len(v_projection), 1)

            # 综合评估文字概率
            text_score = 0.0

            # 水平方向文字检测（横排文字）
            if h_peak_density > 0.1 and h_peak_density < 0.5:
                text_score = max(text_score, h_peak_density * 2)

            # 垂直方向文字检测（竖排文字或多列文字）
            if v_peak_density > 0.1 and v_peak_density < 0.5:
                text_score = max(text_score, v_peak_density * 2)

            # 如果标准差很大，说明有明显的纹理变化（可能是文字）
            if h_std > 20 or v_std > 20:
                text_score = max(text_score, 0.5)

            return min(text_score, 1.0)

        except Exception as e:
            logger.error(f"Failed to detect text region: {e}")
            return 0.0

    async def find_best_watermark_position(
        self,
        base_image: Image.Image,
        watermark: Image.Image,
        watermark_configs: List[Dict[str, Any]],
        allowed_positions: Optional[List[str]] = None
    ) -> WatermarkPosition:
        """
        智能选择最佳水印位置和颜色
        综合考虑：对比度、内容复杂度、边缘密度

        Args:
            base_image: 原图
            watermark: 水印图片
            watermark_configs: 水印配置列表
            allowed_positions: 允许的位置列表

        Returns:
            最佳位置
        """
        try:
            # 默认使用所有位置
            if not allowed_positions:
                test_positions = list(WatermarkPosition)
            else:
                test_positions = [
                    WatermarkPosition(pos) for pos in allowed_positions
                    if pos in [p.value for p in WatermarkPosition]
                ]

            # 如果没有有效位置，使用默认
            if not test_positions:
                test_positions = [WatermarkPosition.BOTTOM_RIGHT]

            best_position = WatermarkPosition.BOTTOM_RIGHT
            best_score = -float('inf')

            # 计算水印区域大小（使用实际水印大小+边距）
            margin = 20  # 额外边距
            region_size = (
                min(int(watermark.width * 1.2) + margin, base_image.width // 4),
                min(int(watermark.height * 1.2) + margin, base_image.height // 4)
            )

            # 调整评分权重，加大对复杂区域的惩罚
            WEIGHT_CONTRAST = 0.2      # 降低对比度权重
            WEIGHT_SMOOTHNESS = 0.35    # 提高平滑度权重
            WEIGHT_LOW_EDGE = 0.25      # 边缘权重
            WEIGHT_NO_TEXT = 0.2        # 新增：无文字权重

            position_scores = []

            # 遍历所有候选位置
            for position in test_positions:
                # 计算该位置的各项指标
                brightness = self.calculate_region_brightness(
                    base_image, position, region_size
                )
                complexity = self.calculate_region_complexity(
                    base_image, position, region_size
                )
                edge_density = self.calculate_edge_density(
                    base_image, position, region_size
                )
                text_probability = self.detect_text_region(
                    base_image, position, region_size
                )

                # 标准化复杂度分数（0-1，越低越好）
                # 降低阈值，让复杂度更敏感
                complexity_score = min(complexity / 50.0, 1.0)  # 降低阈值到50
                smoothness_score = 1.0 - complexity_score

                # 边缘密度分数（0-1，越低越好）
                # 使用非线性映射，让高边缘密度区域得分快速下降
                edge_score = max(0, 1.0 - (edge_density ** 1.5) * 3)  # 非线性放大

                # 文字惩罚分数（0-1，越低越好）
                no_text_score = 1.0 - text_probability

                # 使用固定的对比度分数（透明PNG水印不需要考虑颜色对比）
                # 主要依靠透明度和位置来确保水印可见性
                contrast_score = 0.5  # 中等对比度权重

                # 综合评分（加入文字惩罚）
                total_score = (
                    WEIGHT_CONTRAST * contrast_score +
                    WEIGHT_SMOOTHNESS * smoothness_score +
                    WEIGHT_LOW_EDGE * edge_score +
                    WEIGHT_NO_TEXT * no_text_score
                )

                # 如果检测到明显的文字区域，额外惩罚
                if text_probability > 0.5:
                    total_score *= (1.0 - text_probability * 0.5)  # 最多减尔50%分数

                position_scores.append({
                    'position': position,
                    'score': total_score,
                    'brightness': brightness,
                    'complexity': complexity,
                    'edge_density': edge_density,
                    'text_prob': text_probability,
                    'contrast': best_contrast_for_position
                })

                if total_score > best_score:
                    best_score = total_score
                    best_position = position

            # 记录所有位置的评分（用于调试）
            logger.info("Watermark position scores:")
            for ps in sorted(position_scores, key=lambda x: x['score'], reverse=True)[:5]:
                logger.info(
                    f"  {ps['position'].value}: score={ps['score']:.3f}, "
                    f"complexity={ps['complexity']:.1f}, edge={ps['edge_density']:.3f}, "
                    f"text={ps['text_prob']:.2f}, contrast={ps['contrast']:.1f}"
                )

            logger.info(
                f"Selected best position: {best_position.value}, "
                f"score: {best_score:.3f}"
            )

            return best_position

        except Exception as e:
            logger.error(f"Failed to find best watermark position: {e}")
            # 返回默认值
            return WatermarkPosition.BOTTOM_RIGHT

    def apply_watermark(
        self,
        base_image: Image.Image,
        watermark: Image.Image,
        position: WatermarkPosition = WatermarkPosition.BOTTOM_RIGHT,
        opacity: float = 0.8,
        scale_ratio: float = 0.1,
        margin: int = 20
    ) -> Image.Image:
        """
        应用水印到图片

        Args:
            base_image: 原图
            watermark: 水印图片
            position: 水印位置
            opacity: 透明度（0-1）
            scale_ratio: 缩放比例
            margin: 边距（像素）

        Returns:
            添加水印后的图片
        """
        try:
            # 复制原图以避免修改原始图片
            result = base_image.copy()

            # 转换为RGBA模式以支持透明度
            if result.mode != 'RGBA':
                result = result.convert('RGBA')

            # 缩放水印
            max_size = int(min(base_image.width, base_image.height) * scale_ratio)
            watermark_ratio = watermark.width / watermark.height

            if watermark.width > watermark.height:
                new_width = max_size
                new_height = int(max_size / watermark_ratio)
            else:
                new_height = max_size
                new_width = int(max_size * watermark_ratio)

            watermark = watermark.resize(
                (new_width, new_height),
                Image.Resampling.LANCZOS
            )

            # 调整透明度
            if watermark.mode != 'RGBA':
                watermark = watermark.convert('RGBA')

            # 应用透明度
            alpha = watermark.split()[-1]
            alpha = ImageEnhance.Brightness(alpha).enhance(opacity)
            watermark.putalpha(alpha)

            # 计算位置
            x_ratio, y_ratio = self.POSITION_RATIOS[position]
            x = int(x_ratio * base_image.width) - watermark.width // 2
            y = int(y_ratio * base_image.height) - watermark.height // 2

            # 应用边距约束
            x = max(margin, min(base_image.width - watermark.width - margin, x))
            y = max(margin, min(base_image.height - watermark.height - margin, y))

            # 合成图片
            result.paste(watermark, (x, y), watermark)

            # 保持RGBA模式以支持透明度
            # 转换为RGB由image_to_bytes根据输出格式决定

            logger.info(
                f"Applied watermark at position {position.value}, "
                f"size: {watermark.size}, opacity: {opacity}"
            )

            return result

        except Exception as e:
            logger.error(f"Failed to apply watermark: {e}")
            # 返回原图
            return base_image

    async def process_image_with_watermark(
        self,
        image_url: str,
        watermark_url: str,
        watermark_config: Dict[str, Any],
        position: Optional[Union[WatermarkPosition, str]] = None
    ) -> Tuple[Image.Image, Dict[str, Any]]:
        """
        处理单张图片添加水印

        Args:
            image_url: 原图URL
            watermark_url: 水印URL
            watermark_config: 水印配置
            position: 指定位置（None表示自动选择）

        Returns:
            (处理后的图片, 处理元数据)
        """
        try:
            # 下载原图和水印
            base_image = await self.download_image(image_url)
            watermark = await self.load_watermark(watermark_url)

            # 处理位置参数（如果是字符串，转换为枚举）
            if position is None:
                position = await self.find_best_watermark_position(
                    base_image,
                    watermark,
                    [watermark_config],
                    watermark_config.get('positions')
                )
            else:
                # 如果position是字符串，转换为枚举
                if isinstance(position, str):
                    try:
                        position = WatermarkPosition(position)
                    except ValueError:
                        logger.warning(f"Invalid position '{position}', using default")
                        position = WatermarkPosition.BOTTOM_RIGHT

            # 应用水印
            result_image = self.apply_watermark(
                base_image,
                watermark,
                position=position,
                opacity=float(watermark_config.get('opacity', 0.8)),
                scale_ratio=float(watermark_config.get('scale_ratio', 0.1)),
                margin=int(watermark_config.get('margin_pixels', 20))
            )

            # 处理元数据
            metadata = {
                "original_size": base_image.size,
                "watermark_size": watermark.size,
                "position": position.value,
                "opacity": watermark_config.get('opacity', 0.8),
                "scale_ratio": watermark_config.get('scale_ratio', 0.1),
                "margin_pixels": watermark_config.get('margin_pixels', 20)
            }

            return result_image, metadata

        except Exception as e:
            logger.error(f"Failed to process image with watermark: {e}")
            raise

    def image_to_bytes(
        self,
        image: Image.Image,
        format: str = "JPEG",
        quality: int = 85
    ) -> bytes:
        """
        将PIL Image转换为字节数据

        Args:
            image: PIL Image对象
            format: 图片格式
            quality: 图片质量（1-100）

        Returns:
            图片字节数据
        """
        try:
            buffer = BytesIO()

            # 保存图片到缓冲区
            save_kwargs = {"format": format}

            # 处理JPEG格式和RGBA模式的兼容性
            if format.upper() == "JPEG":
                save_kwargs["quality"] = quality
                save_kwargs["optimize"] = True
                # JPEG不支持透明度，需要转换为RGB
                if image.mode in ("RGBA", "LA", "P"):
                    # 创建白色背景
                    background = Image.new('RGB', image.size, (255, 255, 255))
                    if image.mode == 'P':
                        image = image.convert('RGBA')
                    background.paste(image, mask=image.split()[-1] if image.mode in ('RGBA', 'LA') else None)
                    image = background

            image.save(buffer, **save_kwargs)

            return buffer.getvalue()

        except Exception as e:
            logger.error(f"Failed to convert image to bytes: {e}")
            raise

    def image_to_base64(
        self,
        image: Image.Image,
        format: str = "JPEG",
        quality: int = 85
    ) -> str:
        """
        将PIL Image转换为Base64编码

        Args:
            image: PIL Image对象
            format: 图片格式
            quality: 图片质量

        Returns:
            Base64编码的字符串
        """
        import base64

        try:
            image_bytes = self.image_to_bytes(image, format, quality)
            base64_str = base64.b64encode(image_bytes).decode('utf-8')

            # 添加data URL前缀
            mime_type = "image/jpeg" if format == "JPEG" else f"image/{format.lower()}"
            return f"data:{mime_type};base64,{base64_str}"

        except Exception as e:
            logger.error(f"Failed to convert image to base64: {e}")
            raise