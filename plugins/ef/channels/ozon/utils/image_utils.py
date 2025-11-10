"""
图片URL辅助函数
"""
from typing import List, Tuple


def has_xiangji_urls(images: List[str]) -> bool:
    """
    检测图片列表中是否包含象寄URL

    Args:
        images: 图片URL列表

    Returns:
        bool: 是否包含象寄URL
    """
    if not images:
        return False
    return any('xiangjifanyi.com' in url for url in images if url)


def extract_xiangji_urls(images: List[str]) -> List[Tuple[int, str]]:
    """
    提取所有象寄URL及其在列表中的索引

    Args:
        images: 图片URL列表

    Returns:
        List[Tuple[int, str]]: [(索引, URL), ...]
    """
    if not images:
        return []
    return [(i, url) for i, url in enumerate(images) if url and 'xiangjifanyi.com' in url]


def replace_urls(images: List[str], url_mapping: dict) -> List[str]:
    """
    根据映射关系替换URL

    Args:
        images: 原始图片URL列表
        url_mapping: URL映射 {象寄URL: 图床URL}

    Returns:
        List[str]: 替换后的图片URL列表
    """
    if not images:
        return images
    return [url_mapping.get(url, url) for url in images]


def is_storage_url(url: str) -> bool:
    """
    检测URL是否是图床URL（Cloudinary或阿里云OSS）

    Args:
        url: 图片URL

    Returns:
        bool: 是否是图床URL
    """
    if not url:
        return False

    # Cloudinary URL特征
    if 'cloudinary.com' in url:
        return True

    # 阿里云OSS URL特征
    if 'aliyuncs.com' in url:
        return True

    return False
