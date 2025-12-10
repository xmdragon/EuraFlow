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

    # API 请求头（header 名字使用与浏览器一致的大小写）
    API_HEADERS = {
        "Accept": "application/json, text/plain, */*",
        "Content-Type": "application/json",
        "X-O3-App-Name": "seller-ui",
        "X-O3-Language": "zh-Hans",
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
            # 注意：x-o3-company-id 只在 API 请求时添加（在 fetch_api 中），
            # 页面请求不需要这个 header
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

        解析来源（按优先级）：
        1. x-o3-company-id header 在页面中的引用
        2. window.__INITIAL_STATE__ 中的 company.id
        3. window.__MODULE_STATE__ 中的 companyId
        4. 正则表达式搜索 companyId 字段
        """
        # 方法1: 尝试从 __INITIAL_STATE__ 提取
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

        # 方法2: 尝试从 __MODULE_STATE__ 提取
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

        # 方法3: 直接用正则表达式搜索 "companyId":数字 或 "companyId":"数字"
        # 这是最可靠的方式，因为 OZON 页面中总会有 companyId 字段
        match = re.search(r'"companyId"\s*:\s*"?(\d+)"?', html)
        if match:
            return match.group(1)

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
        # 检查响应内容中是否包含反爬虫特征
        if 'antibot' in html.lower():
            return True
        if 'Antibot Challenge Page' in html:
            return True
        if 'ozon-antibot' in html.lower():
            return True
        # 403 状态码需要结合内容判断：
        # - 如果是 JSON 格式的权限错误，不是 antibot
        # - 如果是 HTML 页面且包含 antibot 特征，才是 antibot
        if status_code == 403:
            # JSON 响应（API 权限错误）不是 antibot
            if html.strip().startswith('{') and 'PermissionDenied' in html:
                return False
            if html.strip().startswith('{') and 'error' in html:
                return False
            # HTML 响应且不包含 antibot 特征
            if '<html' in html.lower() and 'antibot' not in html.lower():
                return False
        return False

    async def _validate_company_id(self, html: str) -> None:
        """
        验证页面的 company_id 是否与目标一致

        必须满足：
        1. 能从页面中提取到 company_id
        2. 提取到的 company_id 必须与目标 client_id 一致

        如果不满足，说明用户没有该店铺的访问权限，OZON 返回了默认店铺的数据。
        """
        page_company_id = self._extract_company_id_from_html(html)

        if not page_company_id:
            # 无法提取 company_id，可能页面结构变化
            logger.warning(
                f"无法从页面提取 company_id，目标店铺: {self.config.target_client_id}"
            )
            raise CompanyIdMismatchError(
                f"无法从页面提取 company_id，无法验证是否为目标店铺 {self.config.target_client_id}"
            )

        if page_company_id != self.config.target_client_id:
            # company_id 不匹配
            # OZON 跨境卖家账号的页面请求绑定到 access_token，无法切换店铺
            raise CompanyIdMismatchError(
                f"非默认店铺，仅支持同步默认店铺 {page_company_id} 的余额"
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

        # 合并 API 请求头（关键：X-O3-Company-Id 用于切换店铺）
        headers = {
            **self._headers,
            **self.API_HEADERS,
            "X-O3-Company-Id": self.config.target_client_id,
            "Origin": self.BASE_URL,
            "Referer": f"{self.BASE_URL}/app/finances/balance?_rr=1",
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
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

        # 检查权限错误
        if response.status_code == 403:
            error_text = response.text
            if "PermissionDenied" in error_text or "no access" in error_text:
                raise CompanyIdMismatchError(
                    f"没有店铺 {self.config.target_client_id} 的访问权限"
                )
            raise OzonWebClientError(f"API 请求被拒绝: {error_text[:200]}")

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

        策略：
        1. 先通过 API 验证店铺访问权限
        2. 尝试从页面解析余额（页面会验证 company_id）
        3. 如果目标店铺不是 access_token 绑定的默认店铺，页面验证会失败

        注意：OZON 跨境卖家账号的页面请求绑定到 access_token，
        只能获取默认店铺的余额。非默认店铺会在页面验证时抛出 CompanyIdMismatchError。
        """
        # 先验证店铺访问权限（通过 API，可以切换店铺）
        await self._verify_company_access()

        # 尝试从页面获取余额
        # 注意：_get_balance_from_page 内部会调用 fetch_page，
        # fetch_page 会验证页面中的 company_id 是否与目标一致
        return await self._get_balance_from_page()

    async def _verify_company_access(self) -> None:
        """验证是否有该店铺的访问权限"""
        response = await self.fetch_api(
            "/api/v2/company/finance-info",
            method="POST",
            json_data={"company_id": int(self.config.target_client_id)}
        )
        # 如果能成功调用，说明有权限
        result_company_id = response.get("result", {}).get("company_id")
        if result_company_id and str(result_company_id) != self.config.target_client_id:
            raise CompanyIdMismatchError(
                f"返回的 company_id ({result_company_id}) 与目标 ({self.config.target_client_id}) 不匹配"
            )

    async def _get_balance_from_page(self) -> Optional[float]:
        """
        从页面解析余额

        注意：这里不使用 fetch_page()，因为 fetch_page 会校验 company_id，
        但测试表明通过设置 sc_company_id Cookie，页面确实会返回对应店铺的数据，
        只是页面中同时包含所有店铺的 ID（用于店铺切换器），校验逻辑会误判。
        """
        if not self._session:
            await self._create_client()

        url = f"{self.BASE_URL}/app/finances/balance?_rr=1&tab=IncomesExpenses"
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
