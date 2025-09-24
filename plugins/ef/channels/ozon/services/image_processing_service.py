"""
图片处理服务
实现智能水印定位和图片合成
"""

from PIL import Image, ImageEnhance, ImageOps
import numpy as np
from typing import Dict, Any, Optional, List, Tuple
from io import BytesIO
import httpx
import logging
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


class WatermarkColor(Enum):
    """水印颜色类型枚举"""
    WHITE = "white"
    BLUE = "blue"
    BLACK = "black"
    TRANSPARENT = "transparent"


class ImageProcessingService:
    """图片处理服务"""

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

    # 颜色亮度期望值（用于对比度计算）
    COLOR_BRIGHTNESS = {
        WatermarkColor.WHITE: 255,
        WatermarkColor.BLUE: 128,
        WatermarkColor.BLACK: 0,
        WatermarkColor.TRANSPARENT: None  # 透明水印不考虑对比度
    }

    async def download_image(self, url: str, timeout: int = 30) -> Image.Image:
        """
        下载图片并转换为PIL Image对象

        Args:
            url: 图片URL
            timeout: 超时时间（秒）

        Returns:
            PIL Image对象
        """
        try:
            async with httpx.AsyncClient() as client:
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
        watermark_path_or_url: str,
        color_type: str = "transparent"
    ) -> Image.Image:
        """
        加载水印图片

        Args:
            watermark_path_or_url: 水印文件路径或URL
            color_type: 水印颜色类型

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

            logger.info(f"Loaded watermark, size: {watermark.size}, color_type: {color_type}")
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

    async def find_best_watermark_position(
        self,
        base_image: Image.Image,
        watermark: Image.Image,
        watermark_configs: List[Dict[str, Any]],
        allowed_positions: Optional[List[str]] = None
    ) -> Tuple[WatermarkPosition, WatermarkColor]:
        """
        智能选择最佳水印位置和颜色

        Args:
            base_image: 原图
            watermark: 水印图片
            watermark_configs: 水印配置列表
            allowed_positions: 允许的位置列表

        Returns:
            (最佳位置, 最佳颜色)
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
            best_color = WatermarkColor.WHITE
            max_contrast = 0

            # 计算水印区域大小
            region_size = (
                min(watermark.width, base_image.width // 5),
                min(watermark.height, base_image.height // 5)
            )

            # 遍历所有候选位置
            for position in test_positions:
                # 计算该位置的亮度
                brightness = self.calculate_region_brightness(
                    base_image, position, region_size
                )

                # 选择对比度最高的颜色
                for config in watermark_configs:
                    color_type = WatermarkColor(config.get('color_type', 'white'))

                    # 跳过透明水印（不考虑对比度）
                    if color_type == WatermarkColor.TRANSPARENT:
                        continue

                    expected_brightness = self.COLOR_BRIGHTNESS.get(color_type, 128)
                    contrast = abs(brightness - expected_brightness)

                    if contrast > max_contrast:
                        max_contrast = contrast
                        best_position = position
                        best_color = color_type

            logger.info(
                f"Best watermark position: {best_position.value}, "
                f"color: {best_color.value}, contrast: {max_contrast:.2f}"
            )

            return best_position, best_color

        except Exception as e:
            logger.error(f"Failed to find best watermark position: {e}")
            # 返回默认值
            return WatermarkPosition.BOTTOM_RIGHT, WatermarkColor.WHITE

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

            # 转回RGB模式（JPEG不支持RGBA）
            if result.mode == 'RGBA':
                # 创建白色背景
                background = Image.new('RGB', result.size, (255, 255, 255))
                background.paste(result, mask=result.split()[3])
                result = background

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
        position: Optional[WatermarkPosition] = None
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
            watermark = await self.load_watermark(
                watermark_url,
                watermark_config.get('color_type', 'transparent')
            )

            # 选择最佳位置（如果未指定）
            if position is None:
                position, color = await self.find_best_watermark_position(
                    base_image,
                    watermark,
                    [watermark_config],
                    watermark_config.get('positions')
                )
            else:
                color = WatermarkColor(watermark_config.get('color_type', 'white'))

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
                "color_type": color.value,
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
            if format == "JPEG":
                save_kwargs["quality"] = quality
                save_kwargs["optimize"] = True

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