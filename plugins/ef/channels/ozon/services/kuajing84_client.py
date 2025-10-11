"""跨境巴士平台客户端

使用 httpx 进行 HTTP 请求，实现：
1. 登录获取 Cookie
2. 订单查询（根据 order_number 查找 oid）
3. 物流单号提交
"""

import logging
import re
from typing import Dict, List, Optional
from datetime import datetime, timedelta

import httpx

logger = logging.getLogger(__name__)


class Kuajing84Client:
    """跨境巴士平台客户端（使用 HTTP 请求）"""

    def __init__(
        self,
        base_url: str = "https://www.kuajing84.com",
        timeout: float = 30.0,
    ):
        self.base_url = base_url
        self.timeout = timeout
        self._client: Optional[httpx.AsyncClient] = None

    async def __aenter__(self):
        """异步上下文管理器入口"""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器退出"""
        await self.close()

    async def close(self):
        """关闭客户端"""
        if self._client:
            await self._client.aclose()
            self._client = None

    async def login(
        self, username: str, password: str
    ) -> Dict[str, any]:
        """
        登录跨境巴士平台（卖家登录）

        Args:
            username: 用户名
            password: 密码（明文）

        Returns:
            包含 Cookie 和过期时间的字典:
            {
                "cookies": [...],  # Cookie 列表（字典格式）
                "expires_at": "2025-10-12T10:00:00Z"  # 过期时间
            }

        Raises:
            Exception: 登录失败
        """
        logger.info(f"开始登录跨境巴士，用户名: {username}")

        async with httpx.AsyncClient(
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "application/json, text/javascript, */*; q=0.01",
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                "X-Requested-With": "XMLHttpRequest",
            },
            timeout=self.timeout,
            follow_redirects=True
        ) as client:

            # 1. 访问登录页获取 session cookies
            try:
                response = await client.get(f"{self.base_url}/index/login/login.html")
                logger.debug(f"登录页面访问成功，状态码: {response.status_code}")
            except Exception as e:
                logger.error(f"访问登录页失败: {e}")
                raise Exception(f"访问登录页失败: {e}")

            # 2. 提交登录表单
            # 表单字段名：field[username] 和 field[password]
            login_data = {
                "field[username]": username,
                "field[password]": password,
            }

            try:
                response = await client.post(
                    f"{self.base_url}/index/login/login.html",
                    data=login_data
                )

                logger.debug(f"登录请求完成，状态码: {response.status_code}")

                # 3. 解析登录响应
                try:
                    result = response.json()
                    logger.debug(f"登录响应: {result}")

                    if result.get("code") == 200:
                        logger.info("登录成功")

                        # 4. 提取 cookies 并转换为兼容格式
                        # 注意：使用 client.cookies 而不是 response.cookies
                        # 因为 session cookies 是在访问登录页时设置的，保存在 client 对象中
                        cookies_list = []
                        for name, value in client.cookies.items():
                            cookies_list.append({
                                "name": name,
                                "value": value,
                                "domain": ".kuajing84.com",
                                "path": "/",
                            })

                        # Cookie 过期时间设为24小时后
                        expires_at = (datetime.utcnow() + timedelta(hours=24)).isoformat() + "Z"

                        logger.info(f"成功获取 {len(cookies_list)} 个 Cookie")

                        return {
                            "cookies": cookies_list,
                            "expires_at": expires_at
                        }
                    else:
                        error_msg = result.get("msg", "登录失败")
                        logger.error(f"登录失败: {error_msg}")
                        raise Exception(f"登录失败: {error_msg}")

                except Exception as e:
                    logger.error(f"解析登录响应失败: {e}")
                    raise Exception(f"登录失败: {e}")

            except httpx.TimeoutException:
                logger.error("登录请求超时")
                raise Exception("登录请求超时，请检查网络")
            except Exception as e:
                logger.error(f"登录请求失败: {e}")
                raise Exception(f"登录失败: {e}")

    async def check_cookie_valid(self, cookies: List[Dict]) -> bool:
        """
        检查 Cookie 是否有效

        Args:
            cookies: Cookie 列表

        Returns:
            True 表示有效，False 表示无效
        """
        try:
            # 将 cookies 列表转换为字典
            cookies_dict = {c["name"]: c["value"] for c in cookies}

            async with httpx.AsyncClient(
                cookies=cookies_dict,
                timeout=self.timeout,
                follow_redirects=False  # 不自动跟随重定向
            ) as client:
                # 访问控制台页面，检查是否跳转到登录页
                response = await client.get(
                    f"{self.base_url}/index/console/index",
                )

                # 如果被重定向到登录页，说明 Cookie 已失效
                if response.status_code == 302:
                    location = response.headers.get("location", "")
                    if "login" in location:
                        logger.info("Cookie 已失效（跳转到登录页）")
                        return False

                # 如果返回 200，说明 Cookie 有效
                if response.status_code == 200:
                    logger.info("Cookie 有效")
                    return True

                logger.warning(f"Cookie 验证返回异常状态码: {response.status_code}")
                return False

        except Exception as e:
            logger.error(f"检查 Cookie 有效性失败: {e}")
            return False

    async def get_customer_id(self, cookies: List[Dict]) -> Optional[str]:
        """
        获取客户ID（从控制台页面提取）

        Args:
            cookies: Cookie 列表

        Returns:
            客户ID，如果获取失败返回 None
        """
        try:
            # 将 cookies 列表转换为字典
            cookies_dict = {c["name"]: c["value"] for c in cookies}

            async with httpx.AsyncClient(
                cookies=cookies_dict,
                timeout=self.timeout,
                follow_redirects=True
            ) as client:
                # 访问控制台页面
                response = await client.get(
                    f"{self.base_url}/index/console/index.html"
                )

                if response.status_code == 200:
                    html = response.text

                    # 查找客户ID（格式：客户ID:35308 或 客户ID：35308）
                    match = re.search(r"客户ID[：:]\s*(\d+)", html)
                    if match:
                        customer_id = match.group(1)
                        logger.info(f"成功获取客户ID: {customer_id}")
                        return customer_id
                    else:
                        logger.warning("控制台页面未找到客户ID")
                        return None
                else:
                    logger.error(f"访问控制台页面失败，状态码: {response.status_code}")
                    return None

        except Exception as e:
            logger.error(f"获取客户ID失败: {e}")
            return None

    async def find_order_oid(
        self, order_number: str, cookies: List[Dict]
    ) -> Optional[str]:
        """
        根据 order_number 查找订单的 oid（使用搜索功能）

        Args:
            order_number: 订单号
            cookies: Cookie 列表

        Returns:
            订单 oid，如果找不到返回 None
        """
        logger.info(f"开始查找订单 oid，order_number: {order_number}")

        # 将 cookies 列表转换为字典
        cookies_dict = {c["name"]: c["value"] for c in cookies}

        async with httpx.AsyncClient(
            cookies=cookies_dict,
            timeout=self.timeout
        ) as client:
            try:
                # 构造搜索表单数据
                form_data = {
                    "page": "1",
                    "limit": "15",
                    "platform_id": "0",
                    "shipping_carrier": "0",
                    "is_discard": "1",
                    "country": "",
                    "account": "",
                    "shop_id": "",
                    "sku": "",
                    "goods_num": "",
                    "order_number": order_number,  # 关键搜索参数
                    "order_status": "",
                    "tracking_no": "",
                    "warehouse": "",
                    "place_time": "",
                    "is_save_search": "1",
                    "order_type": "status DESC,place_time DESC",
                    "order_type_id": "1"
                }

                # 发送搜索请求
                response = await client.post(
                    f"{self.base_url}/index/Accountorder/order_list_purchase",
                    data=form_data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )

                if response.status_code != 200:
                    logger.error(f"订单搜索请求失败，状态码: {response.status_code}")
                    return None

                data = response.json()

                if data.get("code") != 0:
                    logger.error(f"订单搜索返回错误: {data}")
                    return None

                # 查找匹配的订单
                orders = data.get("data", [])

                if not orders:
                    logger.warning(f"未找到订单: {order_number}")
                    return None

                # 遍历结果查找精确匹配的订单号
                for order in orders:
                    if order.get("order_number") == order_number:
                        oid = str(order.get("id"))
                        logger.info(f"找到订单 oid: {oid}")
                        return oid

                # 如果没有精确匹配，记录找到的订单号
                found_orders = [o.get("order_number") for o in orders]
                logger.warning(f"未找到精确匹配的订单 {order_number}，搜索结果: {found_orders}")
                return None

            except Exception as e:
                logger.error(f"查找订单 oid 失败: {e}")
                return None

    async def submit_logistics_order(
        self,
        oid: str,
        logistics_order: str,
        cookies: List[Dict],
    ) -> Dict[str, any]:
        """
        提交物流单号

        Args:
            oid: 跨境巴士订单 oid
            logistics_order: 国内物流单号
            cookies: Cookie 列表

        Returns:
            提交结果:
            {
                "success": True/False,
                "message": "提交结果消息"
            }
        """
        logger.info(f"开始提交物流单号，oid: {oid}, logistics_order: {logistics_order}")

        # 将 cookies 列表转换为字典
        cookies_dict = {c["name"]: c["value"] for c in cookies}

        async with httpx.AsyncClient(
            cookies=cookies_dict,
            timeout=self.timeout
        ) as client:
            try:
                # 提交物流单号
                # 假设接口为 POST /index/Accountorder/order_purchase_manual_post
                response = await client.post(
                    f"{self.base_url}/index/Accountorder/order_purchase_manual_post",
                    data={
                        "oid": oid,
                        "logistics_order": logistics_order,
                        "agreement_box": "1",  # 同意协议
                    },
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )

                logger.debug(f"提交请求完成，状态码: {response.status_code}")

                # 解析响应
                try:
                    result = response.json()
                    logger.debug(f"提交响应: {result}")

                    if result.get("code") == 200:
                        logger.info("物流单号提交成功")
                        return {
                            "success": True,
                            "message": result.get("msg", "提交成功")
                        }
                    else:
                        error_msg = result.get("msg", "提交失败")
                        logger.error(f"物流单号提交失败: {error_msg}")
                        return {
                            "success": False,
                            "message": error_msg
                        }

                except Exception as e:
                    logger.error(f"解析提交响应失败: {e}")
                    return {
                        "success": False,
                        "message": f"提交失败: {e}"
                    }

            except httpx.TimeoutException:
                logger.error("提交请求超时")
                return {
                    "success": False,
                    "message": "提交超时，请稍后重试"
                }
            except Exception as e:
                logger.error(f"提交物流单号异常: {e}")
                return {
                    "success": False,
                    "message": f"提交异常: {str(e)}"
                }
