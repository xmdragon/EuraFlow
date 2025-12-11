"""
OZON 买家端 API 客户端

使用用户存储的 Cookie 访问 OZON 买家端商品详情页 API，
获取商品信息和标签数据。

使用 curl_cffi 模拟 Chrome 浏览器的 TLS 指纹，绕过 OZON 的反爬虫检测。
"""
import json
import logging
import uuid
from dataclasses import dataclass
from typing import Optional, Dict, Any, List

from curl_cffi.requests import AsyncSession

logger = logging.getLogger(__name__)

# OZON 买家端 API 配置
OZON_BUYER_BASE = "https://www.ozon.ru"

# 默认版本信息（从浏览器扩展 ozon-headers.ts 同步）
FALLBACK_APP_VERSION = 'release_26-10-2025_8c89c203'
FALLBACK_MANIFEST_VERSION = (
    'frontend-ozon-ru:8c89c203596282a83b13ccb7e135e0f6324a8619;'
    'checkout-render-api:8f355203eb2d681f25c4bfdf1d3ae4a97621b7e8;'
    'fav-render-api:5ff5cd7b6a74633afb5bb7b2517706b8f94d6fed;'
    'sf-render-api:3a16dc35125e614c314decfc16f0ae2c95d01e10;'
    'pdp-render-api:08d5a1f8796caf3ff65ea1067ee6c9f515126858'
)


class OzonBuyerClientError(Exception):
    """OZON 买家端客户端错误"""
    pass


class CookieExpiredError(OzonBuyerClientError):
    """Cookie 已过期"""
    pass


class ProductNotFoundError(OzonBuyerClientError):
    """商品不存在"""
    pass


class AntibotDetectedError(OzonBuyerClientError):
    """检测到反爬虫挑战"""
    pass


@dataclass
class ProductInfo:
    """商品基本信息"""
    sku: str
    name: str
    image_url: Optional[str]
    link: str
    card_price: Optional[str]  # 绿色卡价
    price: Optional[str]  # 黑色普通价
    original_price: Optional[str]  # 划线价
    seller_name: Optional[str]
    seller_link: Optional[str]  # 卖家店铺链接


@dataclass
class ProductTag:
    """商品标签"""
    text: str
    link: str


@dataclass
class TagLookupResult:
    """标签反查结果"""
    product: ProductInfo
    tags: List[ProductTag]
    warning: Optional[str] = None


def _generate_request_id() -> str:
    """生成请求 ID（与浏览器扩展一致）"""
    return uuid.uuid4().hex


def _build_cookie_string(cookies: List[Dict[str, str]]) -> str:
    """构建 Cookie 字符串"""
    return "; ".join(f"{c['name']}={c['value']}" for c in cookies)


def _get_ozon_buyer_headers(
    referer: str,
    user_agent: str,
    cookie_string: str,
    service_name: str = 'composer'
) -> Dict[str, str]:
    """
    生成 OZON 买家端 API 请求 headers

    模拟浏览器扩展的 getOzonStandardHeaders 函数
    """
    request_id = _generate_request_id()
    page_view_id = _generate_request_id()

    # Chrome 版本（从 User-Agent 中提取或使用默认值）
    chrome_version = '136'
    if 'Chrome/' in user_agent:
        try:
            chrome_version = user_agent.split('Chrome/')[1].split('.')[0]
        except (IndexError, ValueError):
            pass

    # 检测浏览器类型
    browser_name = 'Microsoft Edge' if 'Edg/' in user_agent else 'Google Chrome'
    sec_ch_ua = f'"Chromium";v="{chrome_version}", "{browser_name}";v="{chrome_version}", "Not_A Brand";v="99"'

    headers = {
        'Accept': 'application/json',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Cache-Control': 'no-cache',
        'Cookie': cookie_string,
        'Dnt': '1',
        'Origin': 'https://www.ozon.ru',
        'Pragma': 'no-cache',
        'Priority': 'u=1, i',
        'Referer': referer,
        'User-Agent': user_agent,
        # Chrome 浏览器特征 headers
        'sec-ch-ua': sec_ch_ua,
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'Sec-Fetch-Storage-Access': 'active',
        # OZON 特定 headers
        'X-O3-App-Name': 'dweb_client',
        'X-O3-App-Version': FALLBACK_APP_VERSION,
        'X-O3-Manifest-Version': FALLBACK_MANIFEST_VERSION,
        'X-O3-Parent-Requestid': request_id,
        'X-Page-View-Id': page_view_id,
        'x-o3-service-name': service_name,
        'Content-Type': 'application/json',
    }

    return headers


def _check_antibot(html: str, status_code: int) -> bool:
    """检查是否触发反爬虫挑战"""
    if 'antibot' in html.lower():
        return True
    if 'Antibot Challenge Page' in html:
        return True
    if 'ozon-antibot' in html.lower():
        return True
    return False


def _check_login_required(html: str) -> bool:
    """检查是否需要登录（Cookie 过期）"""
    login_indicators = [
        'id="authForm"',
        'name="login"',
        '/auth/login',
        '请登录',
        'Sign in',
        'Войти',
    ]
    return any(indicator in html for indicator in login_indicators)


def _parse_widget_states(data: Dict[str, Any]) -> Dict[str, Any]:
    """解析 widgetStates，将 JSON 字符串解析为字典"""
    widget_states = data.get('widgetStates', {})
    parsed = {}

    for key, value in widget_states.items():
        if isinstance(value, str):
            try:
                parsed[key] = json.loads(value)
            except json.JSONDecodeError:
                parsed[key] = value
        else:
            parsed[key] = value

    return parsed


def _extract_product_info(widget_states: Dict[str, Any], sku: str) -> ProductInfo:
    """从 widgetStates 中提取商品基本信息"""
    # 从 webStickyProducts 获取基本信息
    sticky_data = None
    for key, value in widget_states.items():
        if 'webStickyProducts' in key:
            sticky_data = value
            break

    # 从 webPrice 获取价格信息
    price_data = None
    for key, value in widget_states.items():
        if key.startswith('webPrice-') and 'Decreased' not in key:
            price_data = value
            break

    # 构建商品信息
    name = ''
    image_url = None
    seller_name = None
    seller_link = None

    if sticky_data:
        name = sticky_data.get('name', '')
        image_url = sticky_data.get('coverImageUrl')
        seller = sticky_data.get('seller', {})
        if seller:
            seller_name = seller.get('name')
            seller_link = seller.get('link')

    card_price = None
    price = None
    original_price = None

    if price_data:
        card_price = price_data.get('cardPrice')
        price = price_data.get('price')
        original_price = price_data.get('originalPrice')

    return ProductInfo(
        sku=sku,
        name=name,
        image_url=image_url,
        link=f"{OZON_BUYER_BASE}/product/{sku}/",
        card_price=card_price,
        price=price,
        original_price=original_price,
        seller_name=seller_name,
        seller_link=seller_link,
    )


def _extract_tags(widget_states: Dict[str, Any]) -> List[ProductTag]:
    """从 widgetStates 中提取标签"""
    tags = []

    for key, value in widget_states.items():
        if 'webHashtags' in key:
            badges = value.get('badges', [])
            for badge in badges:
                text = badge.get('text', '')
                link = badge.get('common', {}).get('action', {}).get('link', '')

                if text and link:
                    # 拼接完整链接
                    full_link = f"{OZON_BUYER_BASE}{link}" if link.startswith('/') else link
                    tags.append(ProductTag(text=text, link=full_link))
            break

    return tags


async def _fetch_page(
    session: AsyncSession,
    api_url: str,
    headers: Dict[str, str],
    sku: str
) -> Dict[str, Any]:
    """请求单个页面并返回解析后的 widget_states"""
    response = await session.get(api_url, headers=headers, timeout=30)

    # 检查是否触发反爬虫
    if _check_antibot(response.text, response.status_code):
        logger.warning(f"触发 OZON 反爬虫: SKU={sku}")
        raise AntibotDetectedError("触发 OZON 反爬虫挑战")

    # 检查是否需要登录
    if _check_login_required(response.text):
        logger.warning(f"Cookie 已过期: SKU={sku}")
        raise CookieExpiredError("Cookie 已过期，请重新同步")

    if response.status_code != 200:
        logger.error(f"请求失败: status={response.status_code}, SKU={sku}")
        raise OzonBuyerClientError(f"请求失败: {response.status_code}")

    # 解析响应
    try:
        data = response.json()
    except json.JSONDecodeError as e:
        logger.error(f"JSON 解析失败: {e}")
        raise OzonBuyerClientError("响应格式错误")

    return _parse_widget_states(data)


async def fetch_product_with_tags(
    sku: str,
    session_data: Dict[str, Any]
) -> TagLookupResult:
    """
    获取商品信息和标签

    Args:
        sku: 商品 SKU
        session_data: 用户的 OZON Session 数据（包含 cookies 和 user_agent）

    Returns:
        TagLookupResult 包含商品信息和标签

    Raises:
        CookieExpiredError: Cookie 已过期
        ProductNotFoundError: 商品不存在
        AntibotDetectedError: 触发反爬虫挑战
        OzonBuyerClientError: 其他错误
    """
    cookies = session_data.get('cookies', [])
    user_agent = session_data.get(
        'user_agent',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    )

    if not cookies:
        raise CookieExpiredError("Cookie 数据为空")

    cookie_string = _build_cookie_string(cookies)

    # 构建 API URL
    # 第一页：商品基本信息（价格、卖家等）
    product_url = f'/product/{sku}/'
    api_url_page1 = f"{OZON_BUYER_BASE}/api/entrypoint-api.bx/page/json/v2?url={product_url}"
    # 第二页：标签信息（webHashtags 在 pdpPage2column 布局的第二页）
    api_url_page2 = f"{OZON_BUYER_BASE}/api/entrypoint-api.bx/page/json/v2?url={product_url}?layout_container=pdpPage2column&layout_page_index=2"

    # 获取 headers
    referer = f"{OZON_BUYER_BASE}/product/{sku}/"
    headers = _get_ozon_buyer_headers(referer, user_agent, cookie_string)

    logger.info(f"标签反查请求: SKU={sku}")

    # 使用 curl_cffi 模拟 Chrome 浏览器
    async with AsyncSession(impersonate="chrome131") as session:
        try:
            # 请求第一页获取商品基本信息
            widget_states_page1 = await _fetch_page(session, api_url_page1, headers, sku)

            if not widget_states_page1:
                logger.warning(f"商品不存在: SKU={sku}")
                raise ProductNotFoundError("商品不存在")

            # 提取商品信息
            product = _extract_product_info(widget_states_page1, sku)

            # 检查商品名是否为空（说明商品不存在）
            if not product.name:
                logger.warning(f"商品名为空，可能不存在: SKU={sku}")
                raise ProductNotFoundError("商品不存在")

            # 先尝试从第一页提取标签
            tags = _extract_tags(widget_states_page1)

            # 如果第一页没有标签，请求第二页
            if not tags:
                logger.info(f"第一页无标签，请求第二页: SKU={sku}")
                try:
                    widget_states_page2 = await _fetch_page(session, api_url_page2, headers, sku)
                    tags = _extract_tags(widget_states_page2)
                except Exception as e:
                    # 第二页请求失败不影响整体结果
                    logger.warning(f"第二页请求失败: SKU={sku}, error={e}")

            # 确定是否有警告
            warning = None
            if not tags:
                warning = "该商品暂无标签"

            logger.info(f"标签反查成功: SKU={sku}, 标签数={len(tags)}")

            return TagLookupResult(
                product=product,
                tags=tags,
                warning=warning,
            )

        except (CookieExpiredError, ProductNotFoundError, AntibotDetectedError):
            raise
        except Exception as e:
            logger.error(f"标签反查异常: SKU={sku}, error={e}")
            raise OzonBuyerClientError(f"请求异常: {str(e)}")
