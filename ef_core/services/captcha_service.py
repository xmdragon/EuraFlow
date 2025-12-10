"""
滑块验证码服务

使用 PIL 生成拼图验证码图片，并通过 Redis 存储验证信息
"""
import io
import os
import random
import secrets
import hashlib
import base64
from typing import Optional
from datetime import datetime, timezone
from PIL import Image, ImageDraw, ImageFilter
import logging

from ef_core.utils.redis import get_redis

logger = logging.getLogger(__name__)

# 验证码配置
CAPTCHA_WIDTH = 280  # 背景图宽度
CAPTCHA_HEIGHT = 160  # 背景图高度
PUZZLE_SIZE = 50  # 拼图块大小
PUZZLE_RADIUS = 8  # 拼图凸起半径
CAPTCHA_EXPIRE = 120  # 验证码有效期（秒）
TOLERANCE = 10  # 验证容差（像素）

# 背景图片目录
BG_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "captcha_backgrounds")


def get_background_images() -> list[str]:
    """获取背景图片列表"""
    if not os.path.exists(BG_IMAGES_DIR):
        return []

    images = []
    for f in os.listdir(BG_IMAGES_DIR):
        if f.lower().endswith(('.jpg', '.jpeg', '.png')):
            images.append(os.path.join(BG_IMAGES_DIR, f))
    return images


def create_random_background() -> Image.Image:
    """创建随机渐变背景"""
    img = Image.new('RGB', (CAPTCHA_WIDTH, CAPTCHA_HEIGHT))
    draw = ImageDraw.Draw(img)

    # 随机选择渐变色
    colors = [
        ((70, 130, 180), (135, 206, 235)),   # 蓝色渐变
        ((60, 179, 113), (144, 238, 144)),   # 绿色渐变
        ((255, 165, 0), (255, 218, 185)),    # 橙色渐变
        ((147, 112, 219), (216, 191, 216)),  # 紫色渐变
        ((100, 149, 237), (176, 224, 230)),  # 天蓝渐变
    ]
    start_color, end_color = random.choice(colors)

    # 绘制渐变
    for y in range(CAPTCHA_HEIGHT):
        ratio = y / CAPTCHA_HEIGHT
        r = int(start_color[0] + (end_color[0] - start_color[0]) * ratio)
        g = int(start_color[1] + (end_color[1] - start_color[1]) * ratio)
        b = int(start_color[2] + (end_color[2] - start_color[2]) * ratio)
        draw.line([(0, y), (CAPTCHA_WIDTH, y)], fill=(r, g, b))

    # 添加一些随机形状增加复杂度
    for _ in range(15):
        x = random.randint(0, CAPTCHA_WIDTH)
        y = random.randint(0, CAPTCHA_HEIGHT)
        size = random.randint(10, 40)
        alpha = random.randint(20, 60)
        color = (
            random.randint(200, 255),
            random.randint(200, 255),
            random.randint(200, 255),
        )
        draw.ellipse([x, y, x + size, y + size], fill=color)

    # 应用轻微模糊使背景更自然
    img = img.filter(ImageFilter.GaussianBlur(radius=1))

    return img


def create_puzzle_mask(size: int, radius: int) -> Image.Image:
    """创建拼图形状的遮罩（带凸起）"""
    mask = Image.new('L', (size + radius * 2, size + radius * 2), 0)
    draw = ImageDraw.Draw(mask)

    # 基础正方形
    offset = radius
    draw.rectangle([offset, offset, offset + size, offset + size], fill=255)

    # 右侧凸起
    cx = offset + size
    cy = offset + size // 2
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)

    # 底部凸起
    cx = offset + size // 2
    cy = offset + size
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=255)

    # 左侧凹陷（用黑色覆盖）
    cx = offset
    cy = offset + size // 2
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=0)

    # 顶部凹陷
    cx = offset + size // 2
    cy = offset
    draw.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=0)

    return mask


class CaptchaService:
    """滑块验证码服务"""

    def __init__(self):
        self.redis = None

    async def _get_redis(self):
        """获取 Redis 连接"""
        if self.redis is None:
            self.redis = await get_redis()
        return self.redis

    async def create_captcha(self) -> dict:
        """
        创建滑块验证码

        Returns:
            {
                "captcha_id": "唯一标识",
                "bg_url": "背景图 base64 data URL",
                "puzzle_url": "拼图块 base64 data URL",
                "y": 拼图 Y 坐标
            }
        """
        # 生成唯一 ID
        captcha_id = secrets.token_urlsafe(16)

        # 获取或创建背景图
        bg_images = get_background_images()
        if bg_images:
            bg_path = random.choice(bg_images)
            bg_img = Image.open(bg_path).convert('RGB')
            bg_img = bg_img.resize((CAPTCHA_WIDTH, CAPTCHA_HEIGHT), Image.Resampling.LANCZOS)
        else:
            bg_img = create_random_background()

        # 随机确定拼图位置（确保不会太靠边）
        min_x = PUZZLE_SIZE + PUZZLE_RADIUS * 2 + 20
        max_x = CAPTCHA_WIDTH - PUZZLE_SIZE - PUZZLE_RADIUS * 2 - 10
        min_y = PUZZLE_RADIUS * 2 + 10
        max_y = CAPTCHA_HEIGHT - PUZZLE_SIZE - PUZZLE_RADIUS * 2 - 10

        puzzle_x = random.randint(min_x, max_x)
        puzzle_y = random.randint(min_y, max_y)

        # 创建拼图遮罩
        puzzle_mask = create_puzzle_mask(PUZZLE_SIZE, PUZZLE_RADIUS)
        mask_size = (PUZZLE_SIZE + PUZZLE_RADIUS * 2, PUZZLE_SIZE + PUZZLE_RADIUS * 2)

        # 从背景图裁剪拼图块
        puzzle_region = bg_img.crop((
            puzzle_x - PUZZLE_RADIUS,
            puzzle_y - PUZZLE_RADIUS,
            puzzle_x + PUZZLE_SIZE + PUZZLE_RADIUS,
            puzzle_y + PUZZLE_SIZE + PUZZLE_RADIUS
        ))

        # 创建拼图块图片（带透明背景）
        puzzle_img = Image.new('RGBA', mask_size, (0, 0, 0, 0))
        puzzle_img.paste(puzzle_region, mask=puzzle_mask)

        # 给拼图块添加边框效果
        puzzle_draw = ImageDraw.Draw(puzzle_img)
        # 简单的边框效果通过在边缘添加半透明白色实现

        # 在背景图上创建拼图缺口
        bg_with_hole = bg_img.copy()

        # 创建缺口效果：用半透明灰色填充
        hole_overlay = Image.new('RGBA', mask_size, (0, 0, 0, 0))
        hole_color = Image.new('RGBA', mask_size, (100, 100, 100, 180))
        hole_overlay.paste(hole_color, mask=puzzle_mask)

        # 将缺口叠加到背景
        bg_rgba = bg_with_hole.convert('RGBA')
        bg_rgba.paste(hole_overlay, (puzzle_x - PUZZLE_RADIUS, puzzle_y - PUZZLE_RADIUS), hole_overlay)
        bg_with_hole = bg_rgba.convert('RGB')

        # 转换为 base64
        bg_buffer = io.BytesIO()
        bg_with_hole.save(bg_buffer, format='JPEG', quality=85)
        bg_base64 = base64.b64encode(bg_buffer.getvalue()).decode()

        puzzle_buffer = io.BytesIO()
        puzzle_img.save(puzzle_buffer, format='PNG')
        puzzle_base64 = base64.b64encode(puzzle_buffer.getvalue()).decode()

        # 存储验证信息到 Redis
        redis = await self._get_redis()
        captcha_key = f"captcha:{captcha_id}"
        await redis.setex(
            captcha_key,
            CAPTCHA_EXPIRE,
            f"{puzzle_x}:{puzzle_y}"
        )

        logger.info(f"创建验证码: captcha_id={captcha_id}, x={puzzle_x}, y={puzzle_y}")

        return {
            "captcha_id": captcha_id,
            "bg_url": f"data:image/jpeg;base64,{bg_base64}",
            "puzzle_url": f"data:image/png;base64,{puzzle_base64}",
            "y": puzzle_y - PUZZLE_RADIUS  # 拼图块的实际 Y 坐标
        }

    async def verify_captcha(
        self,
        captcha_id: str,
        x: int,
        duration: Optional[int] = None,
        trail: Optional[list] = None
    ) -> dict:
        """
        验证滑块位置

        Args:
            captcha_id: 验证码 ID
            x: 用户滑动的 X 坐标
            duration: 滑动耗时（毫秒）
            trail: 滑动轨迹

        Returns:
            {
                "success": True/False,
                "token": "验证成功后的 token（用于登录）",
                "message": "错误信息"
            }
        """
        redis = await self._get_redis()
        captcha_key = f"captcha:{captcha_id}"

        # 获取存储的验证信息
        stored_data = await redis.get(captcha_key)
        if not stored_data:
            logger.warning(f"验证码不存在或已过期: captcha_id={captcha_id}")
            return {
                "success": False,
                "message": "验证码已过期，请刷新重试"
            }

        # 解析存储的坐标
        try:
            stored_x, stored_y = map(int, stored_data.split(':'))
        except Exception:
            logger.error(f"验证码数据格式错误: {stored_data}")
            return {
                "success": False,
                "message": "验证失败，请刷新重试"
            }

        # 验证 X 坐标（带容差）
        if abs(x - stored_x) > TOLERANCE:
            logger.info(f"验证失败: captcha_id={captcha_id}, expected_x={stored_x}, actual_x={x}")
            # 不删除验证码，允许重试
            return {
                "success": False,
                "message": "验证失败，请重试"
            }

        # 可选：检查滑动行为（防止机器人）
        if duration is not None:
            # 滑动时间太短（小于 200ms）可能是机器人
            if duration < 200:
                logger.warning(f"滑动时间过短: captcha_id={captcha_id}, duration={duration}ms")
                return {
                    "success": False,
                    "message": "操作过快，请重试"
                }
            # 滑动时间太长（大于 10s）可能有问题
            if duration > 10000:
                logger.warning(f"滑动时间过长: captcha_id={captcha_id}, duration={duration}ms")

        # 验证成功，删除验证码
        await redis.delete(captcha_key)

        # 生成验证成功 token
        token = secrets.token_urlsafe(32)
        token_key = f"captcha_token:{token}"

        # Token 有效期 5 分钟
        await redis.setex(token_key, 300, "valid")

        logger.info(f"验证成功: captcha_id={captcha_id}")

        return {
            "success": True,
            "token": token
        }

    async def validate_token(self, token: str) -> bool:
        """
        验证 captcha token 是否有效

        Args:
            token: 验证成功后获得的 token

        Returns:
            True 如果 token 有效，否则 False
        """
        if not token:
            return False

        redis = await self._get_redis()
        token_key = f"captcha_token:{token}"

        # 检查并删除 token（一次性使用）
        result = await redis.delete(token_key)
        return result > 0


# 单例
_captcha_service: Optional[CaptchaService] = None


def get_captcha_service() -> CaptchaService:
    """获取验证码服务单例"""
    global _captcha_service
    if _captcha_service is None:
        _captcha_service = CaptchaService()
    return _captcha_service
