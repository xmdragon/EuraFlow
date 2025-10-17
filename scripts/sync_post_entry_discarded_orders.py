#!/usr/bin/env python3
"""
临时脚本：同步录单后废弃订单
从跨境84平台拉取录单后废弃的订单，更新本地状态为"已取消"

API接口：POST https://www.kuajing84.com/index/Accountorder/order_list_submit/order_type/10
参数：page={page}&limit=50

使用方式：
    python3 scripts/sync_post_entry_discarded_orders.py
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import httpx
from sqlalchemy import select
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting
from plugins.ef.channels.ozon.models.kuajing84_global_config import Kuajing84GlobalConfig
from plugins.ef.channels.ozon.services.kuajing84_client import Kuajing84Client
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# 跨境84 API配置
KUAJING84_API = "https://www.kuajing84.com/index/Accountorder/order_list_submit/order_type/10"
REQUEST_TIMEOUT = 30  # 30秒超时


async def get_kuajing84_cookies():
    """从数据库获取跨境84配置并登录获取cookies"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 查询跨境84配置
        result = await db.execute(
            select(Kuajing84GlobalConfig).where(Kuajing84GlobalConfig.id == 1)
        )
        config = result.scalar_one_or_none()

        if not config or not config.enabled:
            logger.error("❌ 跨境84配置未启用或不存在")
            return None, None

        if not config.username or not config.password:
            logger.error("❌ 跨境84用户名或密码未配置")
            return None, None

        logger.info(f"使用用户名 {config.username} 登录跨境84...")

        # 使用 Kuajing84Client 登录
        try:
            async with Kuajing84Client(base_url=config.base_url) as client:
                login_result = await client.login(config.username, config.password)

                cookies_list = login_result.get("cookies", [])
                if not cookies_list:
                    logger.error("❌ 登录失败，未获取到cookies")
                    return None, None

                # 将cookies列表转换为字典格式
                cookies_dict = {c["name"]: c["value"] for c in cookies_list}
                logger.info(f"✅ 登录成功，获取到 {len(cookies_dict)} 个cookies")

                return cookies_dict, config.base_url
        except Exception as e:
            logger.error(f"❌ 登录失败: {e}")
            return None, None


async def fetch_discarded_orders(cookies_dict: dict, base_url: str):
    """分页获取所有录单后废弃订单"""
    all_orders = []
    page = 1

    logger.info("开始从跨境84拉取录单后废弃订单...")

    async with httpx.AsyncClient(
        timeout=REQUEST_TIMEOUT,
        cookies=cookies_dict
    ) as client:
        while True:
            try:
                logger.info(f"正在拉取第 {page} 页...")

                response = await client.post(
                    KUAJING84_API,
                    data={
                        "page": page,
                        "limit": 50
                    },
                    headers={
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                    }
                )

                # 检查HTTP状态
                response.raise_for_status()

                data = response.json()

                # 检查业务状态
                if data.get("code") != 0:
                    logger.error(f"❌ API返回错误: {data}")
                    break

                orders = data.get("data", [])
                total_count = data.get("count", 0)

                all_orders.extend(orders)
                logger.info(f"   已获取 {len(orders)} 条，累计 {len(all_orders)}/{total_count}")

                # 检查是否还有更多数据
                if len(all_orders) >= total_count:
                    logger.info(f"✅ 所有数据已拉取完成，共 {len(all_orders)} 条")
                    break

                page += 1

            except httpx.HTTPError as e:
                logger.error(f"❌ HTTP请求失败 (页 {page}): {e}")
                break
            except Exception as e:
                logger.error(f"❌ 拉取失败 (页 {page}): {e}", exc_info=True)
                break

    return all_orders


async def update_local_orders(orders):
    """更新本地订单状态"""
    db_manager = get_db_manager()
    updated_count = 0
    not_found_count = 0
    total_order_numbers = 0

    logger.info(f"开始更新本地订单状态...")

    async with db_manager.get_session() as db:
        for order in orders:
            # 从 sheets 数组中提取 order_number
            sheets = order.get("sheets", [])

            if not sheets:
                logger.warning(f"⚠️  订单 ID {order.get('id')} 缺少 sheets 数据，跳过")
                continue

            for sheet in sheets:
                order_number = sheet.get("order_number")
                if not order_number:
                    logger.warning(f"⚠️  sheet 缺少 order_number，跳过")
                    continue

                total_order_numbers += 1

                # 查找本地订单
                result = await db.execute(
                    select(OzonPosting)
                    .where(OzonPosting.posting_number == order_number)
                )
                posting = result.scalar_one_or_none()

                if posting:
                    # 只更新未标记为已取消的订单
                    if posting.operation_status != 'cancelled':
                        posting.operation_status = 'cancelled'
                        posting.kuajing84_sync_error = '已取消'
                        updated_count += 1
                        logger.info(f"   ✓ 更新订单 {order_number} 状态为'已取消'")
                    else:
                        logger.debug(f"   - 订单 {order_number} 已是'已取消'状态，跳过")
                else:
                    not_found_count += 1
                    logger.debug(f"   - 本地未找到订单 {order_number}")

        # 提交事务
        if updated_count > 0:
            await db.commit()
            logger.info(f"✅ 已提交更新，共 {updated_count} 条")

    return updated_count, not_found_count, total_order_numbers


async def main():
    """主函数"""
    logger.info("=" * 60)
    logger.info("临时脚本：同步录单后废弃订单")
    logger.info("=" * 60)

    # 1. 登录跨境84获取cookies
    cookies_dict, base_url = await get_kuajing84_cookies()

    if not cookies_dict:
        logger.error("❌ 无法获取跨境84登录凭证，脚本终止")
        return

    # 2. 从跨境84拉取废弃订单
    orders = await fetch_discarded_orders(cookies_dict, base_url)

    if not orders:
        logger.info("✅ 没有找到录单后废弃订单")
        return

    logger.info(f"\n📦 从跨境84获取到 {len(orders)} 条录单后废弃订单记录")

    # 2. 更新本地订单
    updated_count, not_found_count, total_order_numbers = await update_local_orders(orders)

    # 3. 显示汇总
    logger.info("\n" + "=" * 60)
    logger.info("执行完成")
    logger.info("=" * 60)
    logger.info(f"📊 统计信息：")
    logger.info(f"   - 跨境84废弃订单记录：{len(orders)} 条")
    logger.info(f"   - 包含的order_number总数：{total_order_numbers} 个")
    logger.info(f"   - 本地已更新：{updated_count} 条")
    logger.info(f"   - 本地未找到：{not_found_count} 条")

    if updated_count > 0:
        logger.info(f"\n✅ 成功更新 {updated_count} 条本地订单状态为'已取消'")
    else:
        logger.info("\n⚠️  没有订单需要更新")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("\n❌ 操作被用户中断")
        sys.exit(1)
    except Exception as e:
        logger.error(f"\n❌ 执行失败: {e}", exc_info=True)
        sys.exit(1)
