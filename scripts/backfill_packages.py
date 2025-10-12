#!/usr/bin/env python3
"""
一次性脚本：为已存在的posting补充包裹追踪号码
从OZON API获取详情并保存到数据库
"""

import asyncio
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, and_
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonShop, OzonPosting, OzonShipmentPackage
from plugins.ef.channels.ozon.api.client import OzonAPIClient
from plugins.ef.channels.ozon.utils.datetime_utils import parse_datetime
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def backfill_packages():
    """为所有需要追踪号码的posting补充包裹数据"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 查找所有需要追踪号码但没有packages的posting
        # 只处理最近30天的订单，避免处理太老的已删除订单
        from datetime import timedelta
        from plugins.ef.channels.ozon.utils.datetime_utils import utcnow
        cutoff_date = utcnow() - timedelta(days=30)

        result = await db.execute(
            select(OzonPosting)
            .outerjoin(OzonShipmentPackage, OzonPosting.id == OzonShipmentPackage.posting_id)
            .where(
                and_(
                    OzonPosting.status.in_(['awaiting_deliver', 'delivering', 'delivered']),
                    OzonShipmentPackage.id == None,  # 没有关联的packages
                    OzonPosting.created_at >= cutoff_date  # 最近30天
                )
            )
            .distinct()
            .limit(100)  # 先处理100个进行测试
        )
        postings = result.scalars().all()

        total = len(postings)
        logger.info(f"找到 {total} 个posting需要补充包裹数据")

        if total == 0:
            logger.info("没有需要处理的posting")
            return

        # 获取shop信息以创建API客户端
        shops = {}
        processed = 0
        errors = 0

        for idx, posting in enumerate(postings, 1):
            try:
                # 获取shop（缓存）
                if posting.shop_id not in shops:
                    shop_result = await db.execute(select(OzonShop).where(OzonShop.id == posting.shop_id))
                    shop = shop_result.scalar_one_or_none()
                    if not shop:
                        logger.error(f"Shop {posting.shop_id} not found")
                        errors += 1
                        continue
                    shops[posting.shop_id] = shop

                shop = shops[posting.shop_id]

                logger.info(f"[{idx}/{total}] 正在获取 {posting.posting_number} 的包裹信息...")

                # 创建API客户端并获取数据
                async with OzonAPIClient(shop.client_id, shop.api_key_enc) as client:
                    # 调用详情接口
                    detail_response = await client.get_posting_details(posting.posting_number)

                # 客户端已关闭，现在可以安全地进行数据库操作
                detail_data = detail_response.get("result", {})

                # 处理包裹信息
                packages_list = detail_data.get("packages", [])

                if not packages_list:
                    logger.warning(f"  └─ {posting.posting_number}: API未返回包裹数据")
                    continue

                logger.info(f"  └─ 找到 {len(packages_list)} 个包裹")

                for package_data in packages_list:
                    package_number = package_data.get("package_number") or package_data.get("id")
                    if not package_number:
                        logger.warning(f"  └─ 包裹缺少package_number，跳过")
                        continue

                    # 查找或创建包裹
                    existing_pkg_result = await db.execute(
                        select(OzonShipmentPackage).where(
                            and_(
                                OzonShipmentPackage.posting_id == posting.id,
                                OzonShipmentPackage.package_number == package_number
                            )
                        )
                    )
                    package = existing_pkg_result.scalar_one_or_none()

                    if not package:
                        package = OzonShipmentPackage(
                            posting_id=posting.id,
                            package_number=package_number
                        )
                        db.add(package)

                    # 更新包裹信息
                    package.tracking_number = package_data.get("tracking_number")
                    package.carrier_name = package_data.get("carrier_name")
                    package.carrier_code = package_data.get("carrier_code")
                    package.status = package_data.get("status")

                    if package_data.get("status_updated_at"):
                        package.status_updated_at = parse_datetime(package_data["status_updated_at"])

                    logger.info(f"     └─ 包裹 {package_number}: {package.tracking_number or '无追踪号'}")

                # 提交这个posting的packages
                await db.commit()
                processed += 1

                # 避免请求过快，休息一下
                if idx % 10 == 0:
                    await asyncio.sleep(1)

            except Exception as e:
                error_msg = str(e)
                # 404错误表示posting在OZON已不存在（可能是很旧的订单）
                if "404" in error_msg:
                    logger.warning(f"  └─ Posting不存在于OZON (404)，跳过")
                else:
                    logger.error(f"  └─ 错误: {e}")
                errors += 1
                await db.rollback()
                continue

        logger.info(f"\n完成！成功处理: {processed}, 错误: {errors}")


if __name__ == "__main__":
    asyncio.run(backfill_packages())
