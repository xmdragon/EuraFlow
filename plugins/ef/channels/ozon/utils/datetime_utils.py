"""
时间处理工具模块
统一处理所有datetime操作，确保所有datetime都是timezone-aware (UTC)
"""
from datetime import datetime, timezone
from typing import Optional


def utcnow() -> datetime:
    """
    返回当前UTC时间（timezone-aware）

    Returns:
        datetime: 带UTC时区的当前时间
    """
    return datetime.now(timezone.utc)


def parse_datetime(dt_str: Optional[str]) -> Optional[datetime]:
    """
    解析日期时间字符串，确保返回UTC timezone-aware datetime

    支持的格式:
    - ISO 8601: "2025-10-09T10:30:00Z" 或 "2025-10-09T10:30:00+00:00"
    - ISO 8601 with microseconds: "2025-10-09T10:30:00.123456Z"

    Args:
        dt_str: 日期时间字符串

    Returns:
        datetime: UTC timezone-aware datetime，如果解析失败返回None
    """
    if not dt_str:
        return None

    try:
        # 替换Z为+00:00以支持fromisoformat
        dt_str = dt_str.replace("Z", "+00:00")
        dt = datetime.fromisoformat(dt_str)

        # 如果是naive datetime，添加UTC时区
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)

        return dt
    except (ValueError, AttributeError, TypeError) as e:
        # 解析失败返回None
        return None


def parse_date(date_str: Optional[str]) -> Optional[datetime]:
    """
    解析日期字符串，返回UTC timezone-aware datetime

    支持的格式:
    - ISO format with time: "2025-10-09T10:30:00Z"
    - Date only: "2025-10-09" (会设置为00:00:00 UTC)

    Args:
        date_str: 日期字符串

    Returns:
        datetime: UTC timezone-aware datetime，如果解析失败返回None
    """
    if not date_str:
        return None

    try:
        # 如果包含T，说明是完整的datetime
        if "T" in date_str:
            return parse_datetime(date_str)
        else:
            # 纯日期格式，解析并添加UTC时区
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            return dt.replace(tzinfo=timezone.utc)
    except (ValueError, AttributeError, TypeError):
        return None


def make_aware(dt: Optional[datetime]) -> Optional[datetime]:
    """
    确保datetime是timezone-aware (UTC)

    如果datetime已经有时区，保持不变
    如果datetime是naive，添加UTC时区

    Args:
        dt: datetime对象

    Returns:
        datetime: UTC timezone-aware datetime
    """
    if dt is None:
        return None

    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)

    return dt


def ensure_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """
    确保datetime是UTC时区

    如果datetime是其他时区，转换为UTC
    如果datetime是naive，假定为UTC并添加时区

    Args:
        dt: datetime对象

    Returns:
        datetime: UTC timezone-aware datetime
    """
    if dt is None:
        return None

    if dt.tzinfo is None:
        # Naive datetime，假定为UTC
        return dt.replace(tzinfo=timezone.utc)

    # 已经有时区，转换为UTC
    return dt.astimezone(timezone.utc)
