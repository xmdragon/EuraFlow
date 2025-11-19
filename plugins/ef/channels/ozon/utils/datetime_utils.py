"""
时间处理工具模块
统一处理所有datetime操作，确保所有datetime都是timezone-aware (UTC)
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, Tuple
from zoneinfo import ZoneInfo
import logging
import calendar


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


def parse_date_with_timezone(
    date_str: Optional[str],
    tz_name: str = "UTC"
) -> Optional[datetime]:
    """
    按指定时区解析日期字符串，然后转换为UTC timezone-aware datetime

    用于处理用户在特定时区输入的日期（如莫斯科时间2025-11-02）

    支持的格式:
    - ISO format with time: "2025-10-09T10:30:00" (按指定时区解释)
    - Date only: "2025-10-09" (按指定时区解释为00:00:00，然后转UTC)

    Args:
        date_str: 日期字符串
        tz_name: 时区名称（如 "Europe/Moscow", "Asia/Shanghai"），默认UTC

    Returns:
        datetime: UTC timezone-aware datetime，如果解析失败返回None

    Example:
        >>> # 用户在莫斯科时间选择 2025-11-02
        >>> dt = parse_date_with_timezone("2025-11-02", "Europe/Moscow")
        >>> # 返回 2025-11-01 21:00:00+00:00 (UTC)
    """
    if not date_str:
        return None

    try:
        # 获取时区对象
        tz = ZoneInfo(tz_name)

        # 如果包含T，说明是完整的datetime
        if "T" in date_str:
            # 移除可能存在的时区标识（Z或+xx:xx）
            date_str_clean = date_str.replace("Z", "").split("+")[0].split("-")[0]
            dt = datetime.fromisoformat(date_str_clean)
            # 设置为指定时区
            dt = dt.replace(tzinfo=tz)
        else:
            # 纯日期格式，解析并设置为指定时区的00:00:00
            dt = datetime.strptime(date_str, "%Y-%m-%d")
            dt = dt.replace(tzinfo=tz)

        # 转换为UTC
        return dt.astimezone(timezone.utc)
    except (ValueError, AttributeError, TypeError, KeyError):
        # 解析失败，回退到默认UTC解析
        return parse_date(date_str)


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


# ========== 新增：统一的时区处理工具函数 ==========

async def get_global_timezone(db) -> str:
    """
    获取系统全局时区设置

    从 ozon_global_settings 表读取 default_timezone 配置。

    Args:
        db: 数据库会话（AsyncSession）

    Returns:
        str: 时区名称（如 "Europe/Moscow"），默认 "UTC"

    Note:
        此函数需要数据库会话，通常在API路由中调用
    """
    from sqlalchemy import select
    from ..models.global_settings import OzonGlobalSetting

    logger = logging.getLogger(__name__)

    try:
        result = await db.execute(
            select(OzonGlobalSetting).where(OzonGlobalSetting.setting_key == "default_timezone")
        )
        setting = result.scalar_one_or_none()
        if setting and setting.setting_value:
            return setting.setting_value.get("value", "UTC")
        return "UTC"
    except Exception as e:
        logger.warning(f"Failed to get global timezone: {e}, using UTC as fallback")
        return "UTC"


def calculate_date_range(
    range_type: str,
    timezone_name: str,
    custom_start: Optional[str] = None,
    custom_end: Optional[str] = None
) -> Tuple[datetime, datetime]:
    """
    根据range_type和用户时区计算UTC时间范围

    此函数确保所有日期范围计算都基于用户配置的时区，避免时区边界问题。

    Args:
        range_type: 时间范围类型
            - "7days": 最近7天（今天往前推6天）
            - "14days": 最近14天（今天往前推13天）
            - "thisMonth": 本月（本月1日到今天）
            - "lastMonth": 上月（上月1日到上月最后一天）
            - "custom": 自定义范围（需要提供 custom_start 和 custom_end）
        timezone_name: 时区名称（如 "Europe/Moscow", "Asia/Shanghai"）
        custom_start: 自定义开始日期（仅range_type="custom"时使用，格式："YYYY-MM-DD"）
        custom_end: 自定义结束日期（仅range_type="custom"时使用，格式："YYYY-MM-DD"）

    Returns:
        Tuple[datetime, datetime]: (start_datetime_utc, end_datetime_utc)
        - start_datetime_utc: 用户时区当天00:00:00转为UTC
        - end_datetime_utc: 用户时区当天23:59:59.999999转为UTC

    Raises:
        ValueError: range_type不支持或custom模式缺少日期参数

    Example:
        >>> # 莫斯科时间2025-11-19计算最近7天
        >>> start, end = calculate_date_range("7days", "Europe/Moscow")
        >>> # start: 2025-11-12 21:00:00+00:00 (莫斯科11-13 00:00:00)
        >>> # end:   2025-11-19 20:59:59.999999+00:00 (莫斯科11-19 23:59:59.999999)

        >>> # 自定义范围
        >>> start, end = calculate_date_range("custom", "Europe/Moscow", "2025-01-01", "2025-01-31")
        >>> # start: 2024-12-31 21:00:00+00:00 (莫斯科01-01 00:00:00)
        >>> # end:   2025-01-31 20:59:59.999999+00:00 (莫斯科01-31 23:59:59.999999)
    """
    tz = ZoneInfo(timezone_name)
    now_in_tz = datetime.now(tz)

    # 根据range_type计算日期范围（用户时区的date对象）
    if range_type == '7days':
        end_date_obj = now_in_tz.date()
        start_date_obj = end_date_obj - timedelta(days=6)
    elif range_type == '14days':
        end_date_obj = now_in_tz.date()
        start_date_obj = end_date_obj - timedelta(days=13)
    elif range_type == 'thisMonth':
        end_date_obj = now_in_tz.date()
        start_date_obj = now_in_tz.replace(day=1).date()
    elif range_type == 'lastMonth':
        first_day_of_this_month = now_in_tz.replace(day=1)
        last_day_of_last_month = first_day_of_this_month - timedelta(days=1)
        first_day_of_last_month = last_day_of_last_month.replace(day=1)
        start_date_obj = first_day_of_last_month.date()
        end_date_obj = last_day_of_last_month.date()
    elif range_type == 'custom':
        if not custom_start or not custom_end:
            raise ValueError("custom range_type requires custom_start and custom_end parameters")
        start_date_dt = datetime.strptime(custom_start, '%Y-%m-%d').replace(tzinfo=tz)
        end_date_dt = datetime.strptime(custom_end, '%Y-%m-%d').replace(tzinfo=tz)
        start_date_obj = start_date_dt.date()
        end_date_obj = end_date_dt.date()
    else:
        raise ValueError(f"Unsupported range_type: {range_type}. Supported: 7days, 14days, thisMonth, lastMonth, custom")

    # 转换为UTC时间范围
    # start: 用户时区的00:00:00
    # end: 用户时区的23:59:59.999999
    start_datetime = datetime.combine(start_date_obj, datetime.min.time()).replace(tzinfo=tz)
    end_datetime = datetime.combine(end_date_obj, datetime.max.time()).replace(tzinfo=tz)

    return (
        start_datetime.astimezone(timezone.utc),
        end_datetime.astimezone(timezone.utc)
    )


def utc_to_local_date(
    utc_datetime: Optional[datetime],
    timezone_name: str
) -> Optional[str]:
    """
    将UTC时间转换为指定时区的日期字符串

    Args:
        utc_datetime: UTC timezone-aware datetime
        timezone_name: 时区名称（如 "Europe/Moscow"）

    Returns:
        str: 日期字符串（YYYY-MM-DD），如果输入为None则返回None

    Example:
        >>> dt = datetime(2025, 11, 2, 21, 0, tzinfo=timezone.utc)
        >>> utc_to_local_date(dt, "Europe/Moscow")
        '2025-11-03'  # 莫斯科时间已经是11月3日（UTC+3）

        >>> utc_to_local_date(dt, "Asia/Shanghai")
        '2025-11-03'  # 上海时间已经是11月3日（UTC+8）
    """
    if utc_datetime is None:
        return None

    tz = ZoneInfo(timezone_name)
    local_dt = utc_datetime.astimezone(tz)
    return local_dt.strftime("%Y-%m-%d")
