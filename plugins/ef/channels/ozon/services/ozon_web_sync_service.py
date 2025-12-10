"""
OZON Web 同步服务

使用浏览器 Cookie 执行促销清理、账单同步、余额同步任务
"""
import logging
from decimal import Decimal, InvalidOperation
from typing import Optional, List, Dict, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OzonShop, OzonWebSyncLog, OzonInvoicePayment
from ..utils.datetime_utils import utcnow
from .ozon_web_client import (
    create_client_from_session,
    CookieExpiredError,
    CompanyIdMismatchError,
)

logger = logging.getLogger(__name__)


class OzonWebSyncService:
    """OZON Web 同步服务"""

    def __init__(self, db: AsyncSession, user_id: int):
        self.db = db
        self.user_id = user_id

    async def _create_log(self, task_type: str) -> OzonWebSyncLog:
        """创建同步日志"""
        log = OzonWebSyncLog(
            task_type=task_type,
            source="backend",
            user_id=self.user_id,
            status="running",
            started_at=utcnow(),
        )
        self.db.add(log)
        await self.db.flush()
        return log

    async def _complete_log(
        self,
        log: OzonWebSyncLog,
        status: str,
        shops_processed: int = 0,
        shops_success: int = 0,
        shops_failed: int = 0,
        error_message: Optional[str] = None,
        details: Optional[Dict] = None,
    ):
        """完成同步日志"""
        log.status = status
        log.completed_at = utcnow()
        log.shops_processed = shops_processed
        log.shops_success = shops_success
        log.shops_failed = shops_failed
        log.error_message = error_message
        log.details = details
        await self.db.commit()

    async def _get_user_session(self) -> Optional[str]:
        """获取用户的 OZON Session Cookie"""
        from ef_core.models.users import User

        user_result = await self.db.execute(
            select(User).where(User.id == self.user_id)
        )
        user = user_result.scalar_one_or_none()

        if not user or not user.ozon_session_enc:
            return None

        return user.ozon_session_enc

    async def _get_shops_for_user(self) -> List[OzonShop]:
        """获取用户关联的店铺列表"""
        from ef_core.models.users import user_shops as user_shops_table, User

        # 获取用户信息
        user_result = await self.db.execute(
            select(User).where(User.id == self.user_id)
        )
        user = user_result.scalar_one_or_none()

        if not user:
            return []

        # 根据用户角色获取店铺
        if user.role == "admin":
            stmt = select(OzonShop).where(OzonShop.status == "active")
        else:
            stmt = select(OzonShop).join(
                user_shops_table, OzonShop.id == user_shops_table.c.shop_id
            ).where(
                user_shops_table.c.user_id == self.user_id,
                OzonShop.status == "active",
            )

        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    # ============================================================
    # 促销清理
    # ============================================================

    async def sync_promo_cleaner(self) -> Dict[str, Any]:
        """
        执行促销清理任务

        清理所有店铺的促销活动中待自动拉入的商品
        """
        log = await self._create_log("promo_cleaner")

        # 检查用户是否有 Cookie
        session_json = await self._get_user_session()
        if not session_json:
            await self._complete_log(log, "skipped", error_message="用户没有上传 OZON Cookie")
            return {"success": False, "message": "用户没有上传 OZON Cookie"}

        # 获取用户关联的店铺
        shops = await self._get_shops_for_user()
        if not shops:
            await self._complete_log(log, "skipped", error_message="没有关联的店铺")
            return {"success": False, "message": "没有关联的店铺"}

        results = []
        success_count = 0
        failed_count = 0

        for shop in shops:
            shop_result = await self._sync_promo_cleaner_for_shop(shop, session_json)
            results.append(shop_result)

            if shop_result["success"]:
                success_count += 1
            else:
                failed_count += 1

        await self._complete_log(
            log,
            status="success" if failed_count == 0 else "partial",
            shops_processed=len(shops),
            shops_success=success_count,
            shops_failed=failed_count,
            details={"results": results},
        )

        return {
            "success": failed_count == 0,
            "shops_processed": len(shops),
            "shops_success": success_count,
            "shops_failed": failed_count,
            "results": results,
        }

    async def _sync_promo_cleaner_for_shop(
        self, shop: OzonShop, session_json: str
    ) -> Dict[str, Any]:
        """为单个店铺执行促销清理"""
        client = await create_client_from_session(session_json, shop.client_id)
        if not client:
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": "无法创建客户端",
            }

        try:
            async with client:
                # 获取促销列表
                promotions = await client.get_promotion_list()
                logger.info(f"店铺 {shop.shop_name} 获取到 {len(promotions)} 个促销活动")

                total_deleted = 0

                for promo in promotions:
                    promo_id = promo.get("id")
                    next_auto_add_date = promo.get("dateToNextAutoAdd")
                    auto_add_count = promo.get("nextAutoAddProductAutoCount", 0)

                    if not promo_id or not next_auto_add_date:
                        continue

                    # 尝试转换为整数
                    try:
                        auto_add_count = int(auto_add_count) if auto_add_count else 0
                    except (ValueError, TypeError):
                        auto_add_count = 0

                    if auto_add_count <= 0:
                        continue

                    logger.info(
                        f"促销活动 {promo_id} 有 {auto_add_count} 个待拉入商品，日期: {next_auto_add_date}"
                    )

                    # 分页获取并删除商品
                    offset = 0
                    while True:
                        products = await client.get_promo_auto_add_products(
                            highlight_id=promo_id,
                            auto_add_date=next_auto_add_date,
                            offset=offset,
                            limit=100,
                        )

                        if not products:
                            break

                        product_ids = [p.get("id") for p in products if p.get("id")]
                        if product_ids:
                            await client.delete_promo_auto_add_products(
                                highlight_id=promo_id,
                                product_ids=product_ids,
                                auto_add_date=next_auto_add_date,
                            )
                            total_deleted += len(product_ids)
                            logger.info(f"删除了 {len(product_ids)} 个商品")

                        if len(products) < 100:
                            break

                        offset += 100

                return {
                    "shop_id": shop.id,
                    "shop_name": shop.shop_name,
                    "success": True,
                    "promotions_processed": len(promotions),
                    "products_deleted": total_deleted,
                }

        except CookieExpiredError as e:
            logger.warning(f"店铺 {shop.shop_name} Cookie 已过期: {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": "Cookie 已过期",
            }
        except CompanyIdMismatchError as e:
            logger.warning(f"店铺 {shop.shop_name} company_id 不匹配: {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"店铺 {shop.shop_name} 促销清理失败: {e}", exc_info=True)
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": str(e),
            }

    # ============================================================
    # 账单同步
    # ============================================================

    async def sync_invoice_payments(self) -> Dict[str, Any]:
        """
        执行账单同步任务

        同步所有店铺的账单付款数据
        """
        log = await self._create_log("invoice_sync")

        # 检查用户是否有 Cookie
        session_json = await self._get_user_session()
        if not session_json:
            await self._complete_log(log, "skipped", error_message="用户没有上传 OZON Cookie")
            return {"success": False, "message": "用户没有上传 OZON Cookie"}

        # 获取用户关联的店铺
        shops = await self._get_shops_for_user()
        if not shops:
            await self._complete_log(log, "skipped", error_message="没有关联的店铺")
            return {"success": False, "message": "没有关联的店铺"}

        results = []
        success_count = 0
        failed_count = 0

        for shop in shops:
            shop_result = await self._sync_invoice_payments_for_shop(shop, session_json)
            results.append(shop_result)

            if shop_result["success"]:
                success_count += 1
            else:
                failed_count += 1

        await self._complete_log(
            log,
            status="success" if failed_count == 0 else "partial",
            shops_processed=len(shops),
            shops_success=success_count,
            shops_failed=failed_count,
            details={"results": results},
        )

        return {
            "success": failed_count == 0,
            "shops_processed": len(shops),
            "shops_success": success_count,
            "shops_failed": failed_count,
            "results": results,
        }

    async def _sync_invoice_payments_for_shop(
        self, shop: OzonShop, session_json: str
    ) -> Dict[str, Any]:
        """为单个店铺同步账单"""
        client = await create_client_from_session(session_json, shop.client_id)
        if not client:
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": "无法创建客户端",
            }

        try:
            async with client:
                payments = await client.get_invoice_payments()
                logger.info(f"店铺 {shop.shop_name} 获取到 {len(payments)} 条账单记录")

                created_count = 0
                updated_count = 0

                for payment_data in payments:
                    # 解析数据并存储
                    result = await self._save_invoice_payment(shop, payment_data)
                    if result == "created":
                        created_count += 1
                    elif result == "updated":
                        updated_count += 1

                await self.db.commit()

                return {
                    "shop_id": shop.id,
                    "shop_name": shop.shop_name,
                    "success": True,
                    "total": len(payments),
                    "created": created_count,
                    "updated": updated_count,
                }

        except CookieExpiredError as e:
            logger.warning(f"店铺 {shop.shop_name} Cookie 已过期: {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": "Cookie 已过期",
            }
        except CompanyIdMismatchError as e:
            logger.warning(f"店铺 {shop.shop_name} company_id 不匹配: {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"店铺 {shop.shop_name} 账单同步失败: {e}", exc_info=True)
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": str(e),
            }

    async def _save_invoice_payment(
        self, shop: OzonShop, payment_data: Dict[str, Any]
    ) -> str:
        """保存账单付款记录"""
        from datetime import date
        import re

        # 解析金额
        amount_str = payment_data.get("amount_cny", "0")
        amount_str = re.sub(r'[^\d.,]', '', amount_str)
        amount_str = amount_str.replace(',', '.').replace(' ', '')
        try:
            amount = Decimal(amount_str)
        except (ValueError, InvalidOperation):
            amount = Decimal(0)

        # 解析日期（格式：DD.MM.YYYY）
        def parse_date(date_str: Optional[str]) -> Optional[date]:
            if not date_str:
                return None
            try:
                parts = date_str.strip().split('.')
                if len(parts) == 3:
                    return date(int(parts[2]), int(parts[1]), int(parts[0]))
            except (ValueError, IndexError):
                pass
            return None

        scheduled_date = parse_date(payment_data.get("scheduled_payment_date"))
        actual_date = parse_date(payment_data.get("actual_payment_date"))

        if not scheduled_date:
            return "skipped"

        # 计算账单周期
        period_start, period_end = self._calculate_period(scheduled_date)

        # 状态映射
        status_map = {
            "ожидание": "waiting",
            "оплачено": "paid",
            "waiting": "waiting",
            "paid": "paid",
        }
        status = payment_data.get("payment_status", "").lower()
        status = status_map.get(status, status)

        # 查找现有记录
        stmt = select(OzonInvoicePayment).where(
            OzonInvoicePayment.shop_id == shop.id,
            OzonInvoicePayment.period_start == period_start,
            OzonInvoicePayment.period_end == period_end,
            OzonInvoicePayment.payment_type == payment_data.get("payment_type", ""),
        )
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()

        if existing:
            # 更新
            existing.amount_cny = amount
            existing.payment_status = status
            existing.scheduled_payment_date = scheduled_date
            existing.actual_payment_date = actual_date
            existing.payment_method = payment_data.get("payment_method")
            existing.payment_file_number = payment_data.get("payment_file_number")
            existing.period_text = payment_data.get("period_text")
            existing.raw_data = payment_data
            return "updated"
        else:
            # 创建
            new_payment = OzonInvoicePayment(
                shop_id=shop.id,
                payment_type=payment_data.get("payment_type", ""),
                amount_cny=amount,
                payment_status=status,
                scheduled_payment_date=scheduled_date,
                actual_payment_date=actual_date,
                period_start=period_start,
                period_end=period_end,
                payment_method=payment_data.get("payment_method"),
                payment_file_number=payment_data.get("payment_file_number"),
                period_text=payment_data.get("period_text"),
                raw_data=payment_data,
            )
            self.db.add(new_payment)
            return "created"

    def _calculate_period(self, scheduled_date) -> tuple:
        """根据计划付款日期计算账单周期"""
        from datetime import date
        import calendar

        day = scheduled_date.day
        year = scheduled_date.year
        month = scheduled_date.month

        if 1 <= day <= 15:
            # 付款日 1-15 号 → 对应上月 16-月末
            if month == 1:
                prev_month = 12
                prev_year = year - 1
            else:
                prev_month = month - 1
                prev_year = year

            last_day = calendar.monthrange(prev_year, prev_month)[1]
            period_start = date(prev_year, prev_month, 16)
            period_end = date(prev_year, prev_month, last_day)
        else:
            # 付款日 16-月末 → 对应当月 1-15
            period_start = date(year, month, 1)
            period_end = date(year, month, 15)

        return period_start, period_end

    # ============================================================
    # 余额同步
    # ============================================================

    async def sync_balance(self) -> Dict[str, Any]:
        """
        执行余额同步任务

        同步所有店铺的账户余额
        """
        log = await self._create_log("balance_sync")

        # 检查用户是否有 Cookie
        session_json = await self._get_user_session()
        if not session_json:
            await self._complete_log(log, "skipped", error_message="用户没有上传 OZON Cookie")
            return {"success": False, "message": "用户没有上传 OZON Cookie"}

        # 获取用户关联的店铺
        shops = await self._get_shops_for_user()
        if not shops:
            await self._complete_log(log, "skipped", error_message="没有关联的店铺")
            return {"success": False, "message": "没有关联的店铺"}

        results = []
        success_count = 0
        failed_count = 0

        for shop in shops:
            shop_result = await self._sync_balance_for_shop(shop, session_json)
            results.append(shop_result)

            if shop_result["success"]:
                success_count += 1
            else:
                failed_count += 1

        await self._complete_log(
            log,
            status="success" if failed_count == 0 else "partial",
            shops_processed=len(shops),
            shops_success=success_count,
            shops_failed=failed_count,
            details={"results": results},
        )

        return {
            "success": failed_count == 0,
            "shops_processed": len(shops),
            "shops_success": success_count,
            "shops_failed": failed_count,
            "results": results,
        }

    async def _sync_balance_for_shop(
        self, shop: OzonShop, session_json: str
    ) -> Dict[str, Any]:
        """为单个店铺同步余额"""
        client = await create_client_from_session(session_json, shop.client_id)
        if not client:
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": "无法创建客户端",
            }

        try:
            async with client:
                balance = await client.get_balance()

                if balance is None:
                    return {
                        "shop_id": shop.id,
                        "shop_name": shop.shop_name,
                        "success": False,
                        "error": "无法获取余额",
                    }

                # 更新店铺余额
                shop.current_balance_rub = Decimal(str(balance))
                shop.balance_updated_at = utcnow()
                await self.db.commit()

                logger.info(f"店铺 {shop.shop_name} 余额更新为 {balance} 卢布")

                return {
                    "shop_id": shop.id,
                    "shop_name": shop.shop_name,
                    "success": True,
                    "balance_rub": balance,
                }

        except CookieExpiredError as e:
            logger.warning(f"店铺 {shop.shop_name} Cookie 已过期: {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": "Cookie 已过期",
            }
        except CompanyIdMismatchError as e:
            logger.warning(f"店铺 {shop.shop_name} company_id 不匹配: {e}")
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": str(e),
            }
        except Exception as e:
            logger.error(f"店铺 {shop.shop_name} 余额同步失败: {e}", exc_info=True)
            return {
                "shop_id": shop.id,
                "shop_name": shop.shop_name,
                "success": False,
                "error": str(e),
            }
