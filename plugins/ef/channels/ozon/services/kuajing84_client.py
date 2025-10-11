"""跨境巴士平台客户端

使用 Playwright 模拟浏览器操作，实现：
1. 登录获取 Cookie
2. 订单查询（根据 order_number 查找 oid）
3. 物流单号提交
"""

import json
import logging
from typing import Dict, List, Optional
from datetime import datetime, timedelta

from playwright.async_api import async_playwright, Browser, Page, TimeoutError as PlaywrightTimeout
import httpx

logger = logging.getLogger(__name__)


class Kuajing84Client:
    """跨境巴士平台客户端"""

    def __init__(
        self,
        base_url: str = "https://www.kuajing84.com",
        headless: bool = True,
        timeout: int = 30000,
    ):
        self.base_url = base_url
        self.headless = headless
        self.timeout = timeout
        self._browser: Optional[Browser] = None

    async def __aenter__(self):
        """异步上下文管理器入口"""
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        """异步上下文管理器退出，关闭浏览器"""
        await self.close()

    async def close(self):
        """关闭浏览器"""
        if self._browser:
            await self._browser.close()
            self._browser = None

    async def login(
        self, username: str, password: str
    ) -> Dict[str, any]:
        """
        登录跨境巴士平台（卖家登录）

        Args:
            username: 用户名
            password: 密码

        Returns:
            包含 Cookie 和过期时间的字典:
            {
                "cookies": [...],  # Cookie 列表
                "expires_at": "2025-10-12T10:00:00Z"  # 过期时间
            }

        Raises:
            Exception: 登录失败
        """
        logger.info(f"开始登录跨境巴士，用户名: {username}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            page = await browser.new_page()

            try:
                # 1. 访问登录页
                await page.goto(
                    f"{self.base_url}/index/login/login.html",
                    wait_until="networkidle",
                    timeout=self.timeout,
                )
                logger.debug("登录页面加载完成")

                # 2. 选择"卖家登录"
                # 根据 HTML 结构，可能需要点击选择卖家登录选项卡
                # 这里假设有一个卖家登录的选择器（需要根据实际页面调整）
                try:
                    # 尝试多种可能的选择器
                    seller_login_selectors = [
                        'text="卖家登录"',
                        'text="卖家登陆"',
                        '.seller-login',
                        '[data-type="seller"]'
                    ]

                    for selector in seller_login_selectors:
                        try:
                            await page.click(selector, timeout=3000)
                            logger.debug(f"点击卖家登录选择器成功: {selector}")
                            break
                        except:
                            continue
                except Exception as e:
                    logger.warning(f"未找到卖家登录选择器，可能已在卖家登录页面: {e}")

                # 3. 填写用户名和密码
                # 根据常见表单命名，尝试多种选择器
                username_selectors = [
                    'input[name="username"]',
                    'input[name="account"]',
                    'input[type="text"]',
                    '#username',
                    '#account'
                ]

                password_selectors = [
                    'input[name="password"]',
                    'input[type="password"]',
                    '#password'
                ]

                # 填写用户名
                for selector in username_selectors:
                    try:
                        await page.fill(selector, username, timeout=3000)
                        logger.debug(f"填写用户名成功: {selector}")
                        break
                    except:
                        continue

                # 填写密码
                for selector in password_selectors:
                    try:
                        await page.fill(selector, password, timeout=3000)
                        logger.debug(f"填写密码成功: {selector}")
                        break
                    except:
                        continue

                # 4. 点击登录按钮
                login_button_selectors = [
                    'button[type="submit"]',
                    'button:has-text("登录")',
                    'button:has-text("登陆")',
                    '.login-btn',
                    '#login-btn'
                ]

                for selector in login_button_selectors:
                    try:
                        await page.click(selector, timeout=3000)
                        logger.debug(f"点击登录按钮成功: {selector}")
                        break
                    except:
                        continue

                # 5. 等待跳转到首页/控制台
                try:
                    await page.wait_for_url(
                        "**/index/console/**",
                        timeout=self.timeout
                    )
                    logger.info("登录成功，已跳转到控制台")
                except PlaywrightTimeout:
                    # 检查是否有错误提示
                    error_text = await page.text_content("body")
                    if "验证码" in error_text or "captcha" in error_text.lower():
                        raise Exception("登录需要验证码，请联系管理员")
                    elif "密码错误" in error_text or "用户名错误" in error_text:
                        raise Exception("用户名或密码错误")
                    else:
                        raise Exception(f"登录超时或失败: {error_text[:200]}")

                # 6. 提取 Cookie
                cookies = await page.context.cookies()

                # Cookie 过期时间设为24小时后（可以根据实际情况调整）
                expires_at = (datetime.utcnow() + timedelta(hours=24)).isoformat() + "Z"

                logger.info(f"成功获取 {len(cookies)} 个 Cookie")

                return {
                    "cookies": cookies,
                    "expires_at": expires_at
                }

            finally:
                await browser.close()

    async def check_cookie_valid(self, cookies: List[Dict]) -> bool:
        """
        检查 Cookie 是否有效

        Args:
            cookies: Cookie 列表

        Returns:
            True 表示有效，False 表示无效
        """
        try:
            async with async_playwright() as p:
                browser = await p.chromium.launch(headless=self.headless)
                context = await browser.new_context()

                # 添加 Cookie
                await context.add_cookies(cookies)

                page = await context.new_page()

                # 访问控制台页面，检查是否跳转到登录页
                await page.goto(
                    f"{self.base_url}/index/console/index",
                    wait_until="networkidle",
                    timeout=self.timeout
                )

                # 如果 URL 包含 login，说明 Cookie 已失效
                current_url = page.url
                is_valid = "/login/" not in current_url

                await browser.close()

                logger.info(f"Cookie 有效性检查: {is_valid}, 当前URL: {current_url}")
                return is_valid

        except Exception as e:
            logger.error(f"检查 Cookie 有效性失败: {e}")
            return False

    async def find_order_oid(
        self, order_number: str, cookies: List[Dict], max_pages: int = 10
    ) -> Optional[str]:
        """
        根据 order_number 查找订单的 oid

        Args:
            order_number: 订单号
            cookies: Cookie 列表
            max_pages: 最多搜索的页数

        Returns:
            订单 oid，如果找不到返回 None
        """
        logger.info(f"开始查找订单 oid，order_number: {order_number}")

        # 使用 httpx 发送 AJAX 请求
        async with httpx.AsyncClient(cookies={c["name"]: c["value"] for c in cookies}) as client:
            for page in range(1, max_pages + 1):
                try:
                    # 发送订单列表请求
                    response = await client.post(
                        f"{self.base_url}/index/Accountorder/order_list_purchase",
                        data={"page": page},
                        headers={
                            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                            "X-Requested-With": "XMLHttpRequest",
                        },
                        timeout=30.0
                    )

                    if response.status_code != 200:
                        logger.error(f"订单列表请求失败，状态码: {response.status_code}")
                        continue

                    data = response.json()

                    if data.get("code") != 0:
                        logger.error(f"订单列表返回错误: {data}")
                        break

                    # 遍历订单列表查找匹配的 order_number
                    orders = data.get("data", [])
                    for order in orders:
                        if order.get("order_number") == order_number:
                            oid = str(order.get("id"))
                            logger.info(f"找到订单 oid: {oid}")
                            return oid

                    logger.debug(f"第 {page} 页未找到订单，继续搜索")

                except Exception as e:
                    logger.error(f"查找订单 oid 失败（第 {page} 页）: {e}")
                    continue

        logger.warning(f"未找到订单 {order_number} 的 oid（已搜索 {max_pages} 页）")
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

        Raises:
            Exception: 提交失败
        """
        logger.info(f"开始提交物流单号，oid: {oid}, logistics_order: {logistics_order}")

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context()

            # 添加 Cookie
            await context.add_cookies(cookies)

            page = await context.new_page()

            try:
                # 1. 访问订单表单页
                form_url = f"{self.base_url}/index/Accountorder/order_purchase_manual/oid/{oid}/currPage/3/order_type/1"
                await page.goto(form_url, wait_until="networkidle", timeout=self.timeout)
                logger.debug("订单表单页加载完成")

                # 2. 填写物流单号
                # 根据 HTML 分析，字段名为 logistics_order
                await page.fill('input[name="logistics_order"]', logistics_order)
                logger.debug(f"填写物流单号: {logistics_order}")

                # 3. 勾选协议复选框
                # 字段名为 agreement_box
                await page.check('input[name="agreement_box"]')
                logger.debug("已勾选协议复选框")

                # 4. 点击提交按钮（"预报订单"）
                # 根据 HTML 分析，按钮 id 为 submit_website
                submit_button = page.locator('#submit_website')
                await submit_button.click()
                logger.debug("已点击提交按钮")

                # 5. 等待提交结果
                # 监听 AJAX 响应
                response = await page.wait_for_response(
                    lambda r: "order_purchase_manual_post" in r.url,
                    timeout=self.timeout
                )

                result = await response.json()

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
                logger.error(f"提交物流单号异常: {e}")
                return {
                    "success": False,
                    "message": f"提交异常: {str(e)}"
                }

            finally:
                await browser.close()
