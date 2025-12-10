"""
OZON Web 客户端服务

使用浏览器 Cookie 直接访问 OZON 卖家中心页面，
实现促销清理、账单同步、余额同步等功能。

使用 curl_cffi 模拟 Chrome 浏览器的 TLS 指纹，绕过 OZON 的反爬虫检测。
"""
import json
import re
import logging
from typing import Optional, Dict, Any, List
from dataclasses import dataclass

from curl_cffi.requests import AsyncSession
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


@dataclass
class OzonWebClientConfig:
    """客户端配置"""
    cookies: List[Dict[str, str]]
    user_agent: str
    target_client_id: str  # 目标店铺的 client_id


class OzonWebClientError(Exception):
    """OZON Web 客户端错误"""
    pass


class CookieExpiredError(OzonWebClientError):
    """Cookie 已过期"""
    pass


class CompanyIdMismatchError(OzonWebClientError):
    """company_id 不匹配"""
    pass


class AntibotDetectedError(OzonWebClientError):
    """检测到反爬虫挑战"""
    pass


class OzonWebClient:
    """
    OZON Web 客户端

    使用浏览器 Cookie 访问 OZON 卖家中心页面，执行同步任务。
    使用 curl_cffi 模拟 Chrome 浏览器的 TLS 指纹。
    """

    BASE_URL = "https://seller.ozon.ru"

    # 默认请求头
    DEFAULT_HEADERS = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "DNT": "1",
        "Pragma": "no-cache",
        "Sec-CH-UA": '"Chromium";v="142", "Microsoft Edge";v="142", "Not_A Brand";v="99"',
        "Sec-CH-UA-Mobile": "?0",
        "Sec-CH-UA-Platform": '"Windows"',
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Upgrade-Insecure-Requests": "1",
    }

    # API 请求头
    API_HEADERS = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "x-o3-app-name": "seller-ui",
        "x-o3-language": "zh-Hans",
    }

    def __init__(self, config: OzonWebClientConfig):
        self.config = config
        self._session: Optional[AsyncSession] = None
        self._headers: Optional[Dict[str, str]] = None

    async def __aenter__(self):
        """进入上下文"""
        await self._create_client()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """退出上下文"""
        await self.close()

    async def _create_client(self):
        """创建 HTTP 客户端"""
        # 构建 Cookie 字符串（排除 sc_company_id，因为我们要强制设置为目标店铺）
        cookie_str = "; ".join(
            f"{c['name']}={c['value']}" for c in self.config.cookies
            if c['name'] != 'sc_company_id'
        )

        # 强制设置 sc_company_id 为目标店铺（即使 cookies 中已有也覆盖）
        cookie_str += f"; sc_company_id={self.config.target_client_id}"

        self._headers = {
            **self.DEFAULT_HEADERS,
            "User-Agent": self.config.user_agent,
            "Cookie": cookie_str,
        }

        # 使用 curl_cffi 模拟 Chrome 浏览器
        self._session = AsyncSession(impersonate="chrome131")

    async def close(self):
        """关闭客户端"""
        if self._session:
            await self._session.close()
            self._session = None

    def _extract_company_id_from_html(self, html: str) -> Optional[str]:
        """
        从 HTML 页面提取当前 company_id

        解析来源：
        1. window.__INITIAL_STATE__ 中的 company 信息
        2. window.__MODULE_STATE__ 中的 company 信息
        """
        # 尝试从 __INITIAL_STATE__ 提取
        match = re.search(r'window\.__INITIAL_STATE__\s*=\s*(\{.*?\});', html, re.DOTALL)
        if match:
            try:
                state = json.loads(match.group(1))
                # 尝试多种路径
                company_id = (
                    state.get('company', {}).get('id') or
                    state.get('user', {}).get('company', {}).get('id') or
                    state.get('seller', {}).get('companyId')
                )
                if company_id:
                    return str(company_id)
            except json.JSONDecodeError:
                pass

        # 尝试从 __MODULE_STATE__ 提取
        match = re.search(r'window\.__MODULE_STATE__\s*=\s*(\{.*?\});', html, re.DOTALL)
        if match:
            try:
                state = json.loads(match.group(1))
                # 遍历查找 companyId
                def find_company_id(obj):
                    if isinstance(obj, dict):
                        if 'companyId' in obj:
                            return str(obj['companyId'])
                        for v in obj.values():
                            result = find_company_id(v)
                            if result:
                                return result
                    elif isinstance(obj, list):
                        for item in obj:
                            result = find_company_id(item)
                            if result:
                                return result
                    return None

                company_id = find_company_id(state)
                if company_id:
                    return company_id
            except json.JSONDecodeError:
                pass

        return None

    def _check_login_required(self, html: str) -> bool:
        """检查是否需要登录（Cookie 过期）"""
        # 检查是否包含登录页面特征
        login_indicators = [
            'id="authForm"',
            'name="login"',
            '/auth/login',
            '请登录',
            'Sign in',
            'Войти',
        ]
        return any(indicator in html for indicator in login_indicators)

    def _check_antibot(self, html: str, status_code: int) -> bool:
        """检查是否触发反爬虫挑战"""
        if status_code == 403:
            return True
        if 'antibot' in html.lower():
            return True
        if 'Antibot Challenge Page' in html:
            return True
        return False

    async def _validate_company_id(self, html: str) -> None:
        """验证页面的 company_id 是否与目标一致"""
        page_company_id = self._extract_company_id_from_html(html)
        if page_company_id and page_company_id != self.config.target_client_id:
            raise CompanyIdMismatchError(
                f"页面 company_id ({page_company_id}) 与目标 ({self.config.target_client_id}) 不匹配"
            )

    async def fetch_page(self, path: str) -> str:
        """
        获取页面 HTML

        Args:
            path: 页面路径，如 /app/highlights/list

        Returns:
            HTML 内容

        Raises:
            CookieExpiredError: Cookie 已过期
            CompanyIdMismatchError: company_id 不匹配
            AntibotDetectedError: 触发反爬虫挑战
        """
        if not self._session:
            await self._create_client()

        url = f"{self.BASE_URL}{path}"
        response = await self._session.get(url, headers=self._headers, timeout=30)

        html = response.text

        # 检查是否触发反爬虫
        if self._check_antibot(html, response.status_code):
            raise AntibotDetectedError(
                f"触发 OZON 反爬虫挑战 (status={response.status_code})"
            )

        # 检查是否需要登录
        if self._check_login_required(html):
            raise CookieExpiredError("Cookie 已过期，需要重新登录")

        # 验证 company_id
        await self._validate_company_id(html)

        return html

    async def fetch_api(
        self,
        path: str,
        method: str = "GET",
        json_data: Optional[Dict] = None,
        params: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        """
        调用 OZON 内部 API

        Args:
            path: API 路径
            method: HTTP 方法
            json_data: JSON 请求体
            params: URL 参数

        Returns:
            JSON 响应
        """
        if not self._session:
            await self._create_client()

        url = f"{self.BASE_URL}{path}"

        # 合并 API 请求头
        headers = {
            **self._headers,
            **self.API_HEADERS,
            "x-o3-company-id": self.config.target_client_id,
        }

        if method.upper() == "GET":
            response = await self._session.get(
                url, params=params, headers=headers, timeout=30
            )
        elif method.upper() == "POST":
            response = await self._session.post(
                url, json=json_data, params=params, headers=headers, timeout=30
            )
        else:
            raise ValueError(f"Unsupported method: {method}")

        # 检查是否触发反爬虫
        if self._check_antibot(response.text, response.status_code):
            raise AntibotDetectedError(
                f"触发 OZON 反爬虫挑战 (status={response.status_code})"
            )

        if response.status_code >= 400:
            raise OzonWebClientError(
                f"API 请求失败: {response.status_code} {response.text[:200]}"
            )

        return response.json()

    # ============================================================
    # 促销清理相关方法
    # ============================================================

    async def get_promotion_list(self) -> List[Dict[str, Any]]:
        """
        获取促销活动列表

        从 /app/highlights/list 页面解析促销活动数据
        """
        html = await self.fetch_page("/app/highlights/list")

        # 从 __MODULE_STATE__ 提取促销列表
        match = re.search(r'window\.__MODULE_STATE__\s*=\s*(\{.*?\});', html, re.DOTALL)
        if not match:
            logger.warning("无法从页面提取 __MODULE_STATE__")
            return []

        try:
            state = json.loads(match.group(1))
            highlights = (
                state.get('highlights', {})
                .get('highlightsModule', {})
                .get('highlightList', {})
                .get('originalHighlights', [])
            )
            return highlights
        except (json.JSONDecodeError, KeyError) as e:
            logger.error(f"解析促销列表失败: {e}")
            return []

    async def get_promo_auto_add_products(
        self,
        highlight_id: str,
        auto_add_date: str,
        offset: int = 0,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """
        获取促销活动中待自动拉入的商品

        Args:
            highlight_id: 促销活动 ID
            auto_add_date: 自动拉入日期
            offset: 偏移量
            limit: 数量限制
        """
        path = f"/api/site/sa-auto-add/v1/{highlight_id}/products-with-offset"
        params = {
            "offset": offset,
            "limit": limit,
            "autoAddDate": auto_add_date,
        }

        response = await self.fetch_api(path, params=params)
        return response.get("products", [])

    async def delete_promo_auto_add_products(
        self,
        highlight_id: str,
        product_ids: List[str],
        auto_add_date: str,
    ) -> bool:
        """
        删除促销活动中的待自动拉入商品

        Args:
            highlight_id: 促销活动 ID
            product_ids: 商品 ID 列表
            auto_add_date: 自动拉入日期

        Returns:
            是否成功
        """
        path = f"/api/site/sa-auto-add/v1/{highlight_id}/delete-products"
        json_data = {
            "product_ids": product_ids,
            "auto_add_date": auto_add_date,
        }

        await self.fetch_api(path, method="POST", json_data=json_data)
        return True

    # ============================================================
    # 账单同步相关方法
    # ============================================================

    async def get_invoice_payments(self) -> List[Dict[str, Any]]:
        """
        获取账单付款数据

        从 /app/finances/invoices 页面解析账单表格
        """
        html = await self.fetch_page("/app/finances/invoices")

        soup = BeautifulSoup(html, 'html.parser')

        # 查找账单表格
        table = soup.find('table', class_=re.compile(r'invoicesTable'))
        if not table:
            logger.warning("未找到账单表格")
            return []

        payments = []
        rows = table.find_all('tr')

        for row in rows[1:]:  # 跳过表头
            cells = row.find_all('td')
            if len(cells) < 9:
                continue

            # 解析单元格数据
            # 列顺序: 空白, 付款类型, 金额, 状态, 计划日期, 实际日期, 周期, 文件号, 付款方式, 空白
            payment = {
                "payment_type": cells[1].get_text(strip=True),
                "amount_cny": cells[2].get_text(strip=True),
                "payment_status": cells[3].get_text(strip=True),
                "scheduled_payment_date": cells[4].get_text(strip=True),
                "actual_payment_date": cells[5].get_text(strip=True) or None,
                "period_text": cells[6].get_text(strip=True) or None,
                "payment_file_number": cells[7].get_text(strip=True) or None,
                "payment_method": cells[8].get_text(strip=True) or None,
            }
            payments.append(payment)

        return payments

    # ============================================================
    # 余额同步相关方法
    # ============================================================

    async def get_balance(self) -> Optional[float]:
        """
        获取店铺余额

        从 /app/finances/balance 页面解析余额数据
        """
        html = await self.fetch_page("/app/finances/balance?tab=IncomesExpenses")

        # 优先从 __MODULE_STATE__ 提取
        match = re.search(r'window\.__MODULE_STATE__\s*=\s*(\{.*?\});', html, re.DOTALL)
        if match:
            try:
                state = json.loads(match.group(1))
                balance = (
                    state.get('finances', {})
                    .get('financesModule', {})
                    .get('balanceModule', {})
                    .get('monthlyBalance', {})
                    .get('balance', {})
                    .get('endAmount', {})
                    .get('amount')
                )
                if balance is not None:
                    return float(balance)
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                logger.warning(f"从 __MODULE_STATE__ 解析余额失败: {e}")

        # 备用方案：从 DOM 解析
        soup = BeautifulSoup(html, 'html.parser')
        balance_elem = soup.find(class_=re.compile(r'balanceAmount'))
        if balance_elem:
            balance_text = balance_elem.get_text(strip=True)
            # 解析格式如 "325 831 ₽"
            balance_text = re.sub(r'[^\d.,]', '', balance_text)
            balance_text = balance_text.replace(' ', '').replace(',', '.')
            try:
                return float(balance_text)
            except ValueError:
                logger.warning(f"无法解析余额文本: {balance_text}")

        return None


async def create_client_from_session(
    session_json: str, target_client_id: str
) -> Optional[OzonWebClient]:
    """
    从 Session JSON 创建 Web 客户端

    Args:
        session_json: 用户存储的 Session JSON 字符串
        target_client_id: 目标店铺的 client_id

    Returns:
        OzonWebClient 或 None（如果解析失败）
    """
    try:
        session_data = json.loads(session_json)
        cookies = session_data.get("cookies", [])
        default_ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        user_agent = session_data.get("user_agent", default_ua)

        if not cookies:
            return None

        config = OzonWebClientConfig(
            cookies=cookies,
            user_agent=user_agent,
            target_client_id=target_client_id,
        )

        return OzonWebClient(config)
    except json.JSONDecodeError:
        logger.error("解析 Session JSON 失败")
        return None


async def create_client_from_shop(shop) -> Optional[OzonWebClient]:
    """
    从店铺对象创建 Web 客户端（已废弃，Cookie 现在存储在用户表）

    Args:
        shop: OzonShop 对象

    Returns:
        OzonWebClient 或 None（如果没有 Cookie）
    """
    if not hasattr(shop, 'ozon_session_enc') or not shop.ozon_session_enc:
        return None

    return await create_client_from_session(shop.ozon_session_enc, shop.client_id)
