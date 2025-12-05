"""
图片工具函数

提供图片来源判断的辅助函数，用于快速发布任务中区分图片类型。
"""


def is_already_staged_url(url: str) -> bool:
    """
    判断 URL 是否已经是图床 URL（无需再上传）

    Args:
        url: 图片 URL

    Returns:
        是否为图床 URL
    """
    if not url:
        return False

    staged_domains = [
        # Cloudinary
        'res.cloudinary.com',
        'cloudinary.com',
        # 阿里云 OSS
        '.aliyuncs.com',
        'oss-cn-',
        'oss-ap-',
        # 其他常见图床
        'cdn.hjdtrading.com',
        'static.hjdtrading.com',
    ]

    url_lower = url.lower()
    return any(domain in url_lower for domain in staged_domains)
