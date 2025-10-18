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
        提交物流单号（构建完整的25个字段）

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
                # Step 1: 获取订单详情页HTML
                detail_url = f"{self.base_url}/index/Accountorder/order_purchase_manual/oid/{oid}/currPage/3/order_type/1"

                logger.debug(f"获取订单详情页: {detail_url}")
                response = await client.get(detail_url)

                if response.status_code != 200:
                    logger.error(f"访问订单详情页失败，状态码: {response.status_code}")
                    return {
                        "success": False,
                        "message": f"访问订单详情页失败，状态码: {response.status_code}"
                    }

                html = response.text

                # Step 2: 使用 BeautifulSoup 解析HTML，提取所有表单字段
                from bs4 import BeautifulSoup
                soup = BeautifulSoup(html, 'html.parser')

                # 提取基础字段
                sid = soup.find('input', {'name': 'order_sid', 'id': 'order_sid'})
                section = soup.find('input', {'name': 'order_section_id', 'id': 'order_section_id'})
                order_id_input = soup.find('input', {'name': 'order_id'})
                country_select = soup.find('select', {'name': 'country'})
                order_number_input = soup.find('input', {'name': 'order_number'})
                sheet_order_sn_input = soup.find('input', {'name': 'sheet_order_sn'})
                sheet_input = soup.find('input', {'name': 'sheet'})
                box_label_input = soup.find('input', {'name': 'box_label'})
                group_num_input = soup.find('input', {'name': 'group_num'})
                introduce_textarea = soup.find('textarea', {'name': 'introduce'})

                # 提取 package_list 字段
                img_input = soup.find('input', {'name': 'img'})
                goods_id_input = soup.find('input', {'name': 'goods_id'})
                package_id_input = soup.find('input', {'name': 'package_id'})
                sku_id_input = soup.find('input', {'name': 'sku_id'})
                num_input = soup.find('input', {'name': 'num'})
                describe_textarea = soup.find('textarea', {'name': 'describe'})
                from_platform_input = soup.find('input', {'name': 'from_platform'})
                from_order_input = soup.find('input', {'name': 'from_order'})
                package_of_select = soup.find('select', {'name': 'package_of'})

                # 提取 add_service (checked radio)
                add_service_radio = soup.find('input', {'type': 'radio', 'checked': True})

                # Step 3: 构建表单数据（25个字段，严格按照实际提交的格式）
                from urllib.parse import urlencode

                params = []

                # 1. field[sid]
                params.append(('field[sid]', sid.get('value') if sid else ""))

                # 2-10. field[order_data][0][...]
                params.append(('field[order_data][0][order_id]', str(order_id_input.get('value') if order_id_input else oid)))
                params.append(('field[order_data][0][section]', str(section.get('value') if section else "")))
                params.append(('field[order_data][0][order_number]', order_number_input.get('value') if order_number_input else ""))
                params.append(('field[order_data][0][sheet_order_sn]', sheet_order_sn_input.get('value', '') if sheet_order_sn_input else ""))
                params.append(('field[order_data][0][introduce]', introduce_textarea.get_text() if introduce_textarea else ""))

                # country: 如果没有选中项，使用第一个非空option（默认值）
                country_value = ""
                if country_select:
                    selected_option = country_select.find('option', selected=True)
                    if selected_option and selected_option.get('value'):
                        country_value = selected_option.get('value')
                    else:
                        # 没有 selected 或值为空，使用第一个有值的 option
                        first_option = country_select.find('option', value=lambda x: x and x != "")
                        if first_option:
                            country_value = first_option.get('value', '')
                params.append(('field[order_data][0][country]', country_value))

                params.append(('field[order_data][0][sheet]', sheet_input.get('value', '') if sheet_input else ""))
                params.append(('field[order_data][0][box_label]', box_label_input.get('value', '') if box_label_input else ""))
                params.append(('field[order_data][0][group_num]', str(group_num_input.get('value') if group_num_input else "1")))

                # 11. add_service
                if add_service_radio:
                    params.append(('field[order_data][0][add_service][0][id]', str(add_service_radio.get('value'))))

                # 12-21. package_list
                # package_of: 如果没有选中项，使用第一个option（默认值）
                package_of_value = ""
                if package_of_select:
                    selected_option = package_of_select.find('option', selected=True)
                    if selected_option:
                        package_of_value = selected_option.get('value', '')
                    else:
                        # 没有 selected 属性，使用第一个 option（默认选中）
                        first_option = package_of_select.find('option')
                        if first_option:
                            package_of_value = first_option.get('value', '')
                params.append(('field[order_data][0][package_list][0][package_of]', package_of_value))
                params.append(('field[order_data][0][package_list][0][logistics_order]', logistics_order))  # 物流单号
                params.append(('field[order_data][0][package_list][0][num]', str(num_input.get('value') if num_input else "1")))
                params.append(('field[order_data][0][package_list][0][img]', img_input.get('value', '') if img_input else ""))
                params.append(('field[order_data][0][package_list][0][sku_id]', str(sku_id_input.get('value', '0') if sku_id_input else "0")))
                params.append(('field[order_data][0][package_list][0][describe]', describe_textarea.get_text() if describe_textarea else ""))
                params.append(('field[order_data][0][package_list][0][id]', str(package_id_input.get('value', '0') if package_id_input else "0")))
                params.append(('field[order_data][0][package_list][0][goods_id]', str(goods_id_input.get('value', '') if goods_id_input else "")))
                params.append(('field[order_data][0][package_list][0][from_platform]', str(from_platform_input.get('value', '0') if from_platform_input else "0")))
                params.append(('field[order_data][0][package_list][0][from_order]', from_order_input.get('value', '') if from_order_input else ""))

                # 22-23. is_show_img/sku
                params.append(('field[order_data][0][is_show_img]', '0'))
                params.append(('field[order_data][0][is_show_sku]', '0'))

                # 24. Big_check_section_order
                params.append(('field[Big_check_section_order]', '1'))

                # 25. data_status（1表示已填写完成）
                params.append(('field[data_status]', '1'))

                # Step 4: URL编码并提交
                encoded_data = urlencode(params)

                logger.debug(f"提交数据字段数: {len(params)}")
                logger.debug(f"提交数据长度: {len(encoded_data)} 字符")

                response = await client.post(
                    f"{self.base_url}/index/Accountordersubmit/order_purchase_manual_post",
                    content=encoded_data,
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

                    if result.get("code") == 200 or result.get("code") == 0:
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
                    logger.error(f"响应内容: {response.text[:500]}")
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
                logger.error(f"提交物流单号异常: {e}", exc_info=True)
                return {
                    "success": False,
                    "message": f"提交异常: {str(e)}"
                }

    async def search_order(
        self,
        order_number: str,
        cookies: List[Dict],
    ) -> Dict[str, any]:
        """
        搜索订单（用于物料成本同步）

        Args:
            order_number: 货件编号（OZON posting number）
            cookies: Cookie 列表

        Returns:
            API返回结果:
            {
                "code": 0,
                "count": 1,
                "data": [...]
            }
        """
        logger.info(f"开始搜索订单，order_number: {order_number}")

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
                    "platform_id": "",
                    "country": "",
                    "order_number": order_number,  # 货件编号
                    "order_sheet_sn": "",
                    "logistics_order": "",
                    "order_id": "",
                    "shop_id": "",
                    "sku_id": "",
                    "sku": "",
                    "sid": "",
                    "remark_type": "",
                    "from_platform": "",
                    "from_order": "",
                    "create_time": "",
                    "confirm_time": "",
                    "is_vague": "",
                }

                # 发送搜索请求
                response = await client.post(
                    f"{self.base_url}/index/Accountorder/order_list_search/order_type/6",
                    data=form_data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )

                if response.status_code != 200:
                    if response.status_code == 302:
                        logger.error(f"订单搜索返回302重定向，Cookie已过期")
                        return {
                            "code": -1,
                            "message": "Cookie已过期"
                        }
                    else:
                        logger.error(f"订单搜索请求失败，状态码: {response.status_code}")
                        return {
                            "code": -1,
                            "message": f"请求失败，状态码: {response.status_code}"
                        }

                # 解析响应
                try:
                    result = response.json()
                    logger.debug(f"搜索响应: {result}")

                    if result.get("code") == 0:
                        data_list = result.get("data", [])
                        logger.info(f"搜索成功，找到 {len(data_list)} 条记录")
                        return result
                    else:
                        logger.warning(f"搜索返回错误: {result}")
                        return result

                except Exception as e:
                    logger.error(f"解析搜索响应失败: {e}")
                    logger.error(f"响应内容: {response.text[:500]}")
                    return {
                        "code": -1,
                        "message": f"解析响应失败: {e}"
                    }

            except httpx.TimeoutException:
                logger.error("搜索请求超时")
                return {
                    "code": -1,
                    "message": "请求超时"
                }
            except Exception as e:
                logger.error(f"搜索订单异常: {e}", exc_info=True)
                return {
                    "code": -1,
                    "message": f"搜索异常: {str(e)}"
                }

    async def discard_order(
        self,
        posting_number: str,
        cookies: List[Dict],
    ) -> Dict[str, any]:
        """
        废弃订单（两步操作）

        步骤1：通过 posting_number 查询订单获取 oid
        步骤2：提交废弃请求

        Args:
            posting_number: 货件编号（OZON posting number）
            cookies: Cookie 列表

        Returns:
            废弃结果:
            {
                "success": True/False,
                "message": "结果消息"
            }
        """
        logger.info(f"开始废弃订单，posting_number: {posting_number}")

        # 将 cookies 列表转换为字典
        cookies_dict = {c["name"]: c["value"] for c in cookies}

        async with httpx.AsyncClient(
            cookies=cookies_dict,
            timeout=self.timeout
        ) as client:
            try:
                # 步骤1：查询订单获取 oid
                logger.info(f"步骤1: 查询订单 {posting_number} 获取 oid")

                search_form_data = {
                    "page": "1",
                    "limit": "15",
                    "platform_id": "0",
                    "shipping_carrier": "0",
                    "is_discard": "1",
                    "country": "",
                    "account": "",
                    "group_id": "",
                    "shop_id": "",
                    "sku": "",
                    "goods_num": "",
                    "order_number": posting_number,
                    "order_status": "",
                    "tracking_no": "",
                    "warehouse": "",
                    "place_time": "",
                    "is_save_search": "1",
                    "order_type": "status DESC,place_time DESC",
                    "order_type_id": "1"
                }

                search_url = f"{self.base_url}/index/Accountorder/order_list_purchase"
                logger.info(f"🔍 请求1 - 查询订单")
                logger.info(f"URL: {search_url}")
                logger.info(f"POST数据: {search_form_data}")

                response = await client.post(
                    search_url,
                    data=search_form_data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )

                if response.status_code != 200:
                    if response.status_code == 302:
                        logger.error(f"查询订单返回302重定向，Cookie已过期")
                        return {
                            "success": False,
                            "error": "COOKIE_EXPIRED",
                            "message": "Cookie已过期，请重新登录"
                        }
                    logger.error(f"查询订单失败，状态码: {response.status_code}")
                    return {
                        "success": False,
                        "message": f"查询订单失败，状态码: {response.status_code}"
                    }

                # 解析查询响应
                try:
                    result = response.json()
                    logger.info(f"✅ 查询响应状态码: {response.status_code}")
                    logger.info(f"✅ 查询响应内容: {result}")

                    if result.get("code") != 0:
                        logger.error(f"查询订单返回错误: {result}")
                        return {
                            "success": False,
                            "message": f"查询订单失败: {result.get('msg', '未知错误')}"
                        }

                    count = result.get("count", 0)
                    if count != 1:
                        logger.warning(f"订单查询结果数量异常: {count}")
                        return {
                            "success": False,
                            "message": f"订单不存在或查询结果异常（count={count}）"
                        }

                    # 提取 oid
                    data_list = result.get("data", [])
                    if not data_list or not isinstance(data_list, list):
                        logger.error("查询响应数据格式异常")
                        return {
                            "success": False,
                            "message": "查询响应数据格式异常"
                        }

                    oid = data_list[0].get("id")
                    if not oid:
                        logger.error("无法获取订单 oid")
                        return {
                            "success": False,
                            "message": "无法获取订单 oid"
                        }

                    logger.info(f"成功获取订单 oid: {oid}")

                except Exception as e:
                    logger.error(f"解析查询响应失败: {e}")
                    return {
                        "success": False,
                        "message": f"解析查询响应失败: {e}"
                    }

                # 步骤2：提交废弃请求
                logger.info(f"步骤2: 提交废弃请求，oid={oid}")

                discard_form_data = {
                    "oid": str(oid)
                }

                discard_url = f"{self.base_url}/index/Orderinfo/auto_order_info_submit"
                logger.info(f"🚮 请求2 - 提交废弃")
                logger.info(f"URL: {discard_url}")
                logger.info(f"POST数据: {discard_form_data}")

                response = await client.post(
                    discard_url,
                    data=discard_form_data,
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    },
                )

                if response.status_code != 200:
                    if response.status_code == 302:
                        logger.error(f"提交废弃请求返回302重定向，Cookie已过期")
                        return {
                            "success": False,
                            "error": "COOKIE_EXPIRED",
                            "message": "Cookie已过期，请重新登录"
                        }
                    logger.error(f"提交废弃请求失败，状态码: {response.status_code}")
                    return {
                        "success": False,
                        "message": f"提交废弃请求失败，状态码: {response.status_code}"
                    }

                # 解析废弃响应
                try:
                    result = response.json()
                    logger.info(f"✅ 废弃响应状态码: {response.status_code}")
                    logger.info(f"✅ 废弃响应内容: {result}")

                    msg = result.get("msg", "")
                    if msg == "获取成功":
                        logger.info(f"订单 {posting_number} 废弃成功")
                        return {
                            "success": True,
                            "message": "订单废弃成功"
                        }
                    else:
                        logger.error(f"订单废弃失败，返回消息: {msg}")
                        return {
                            "success": False,
                            "message": f"订单废弃失败: {msg}"
                        }

                except Exception as e:
                    logger.error(f"解析废弃响应失败: {e}")
                    logger.error(f"响应内容: {response.text[:500]}")
                    return {
                        "success": False,
                        "message": f"解析废弃响应失败: {e}"
                    }

            except httpx.TimeoutException:
                logger.error("废弃订单请求超时")
                return {
                    "success": False,
                    "message": "请求超时，请稍后重试"
                }
            except Exception as e:
                logger.error(f"废弃订单异常: {e}", exc_info=True)
                return {
                    "success": False,
                    "message": f"废弃订单异常: {str(e)}"
                }
