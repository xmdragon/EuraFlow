#!/usr/bin/env python3
"""
数据迁移脚本：从raw_payload提取追踪号码到ozon_shipment_packages表
安全迁移：只使用INSERT操作，不包含任何DROP/TRUNCATE/DELETE等破坏性操作
"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, and_
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonPosting, OzonShipmentPackage
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


async def migrate_tracking_numbers():
    """从posting的raw_payload中提取追踪号码并创建package记录"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 1. 统计需要迁移的数据
        result = await db.execute(
            select(OzonPosting.id)
            .outerjoin(OzonShipmentPackage, OzonPosting.id == OzonShipmentPackage.posting_id)
            .where(OzonPosting.raw_payload['tracking_number'].astext.isnot(None))
            .where(OzonPosting.raw_payload['tracking_number'].astext != '')
            .where(OzonShipmentPackage.id.is_(None))  # 还没有package记录的
        )
        postings_to_migrate = result.scalars().all()

        total = len(postings_to_migrate)
        logger.info(f"📦 找到 {total} 个posting需要迁移追踪号码")

        if total == 0:
            logger.info("✅ 没有需要迁移的数据")
            return

        # 2. 批量处理
        processed = 0
        errors = 0

        for idx, posting_id in enumerate(postings_to_migrate, 1):
            try:
                # 获取posting详情
                result = await db.execute(
                    select(OzonPosting).where(OzonPosting.id == posting_id)
                )
                posting = result.scalar_one_or_none()

                if not posting:
                    logger.warning(f"  [{idx}/{total}] Posting ID {posting_id} 不存在，跳过")
                    errors += 1
                    continue

                # 从raw_payload提取数据
                raw_data = posting.raw_payload or {}
                tracking_number = raw_data.get('tracking_number')

                if not tracking_number:
                    logger.warning(f"  [{idx}/{total}] {posting.posting_number}: raw_payload中没有tracking_number，跳过")
                    errors += 1
                    continue

                # 检查是否已存在package（避免重复创建）
                existing_check = await db.execute(
                    select(OzonShipmentPackage).where(
                        OzonShipmentPackage.posting_id == posting.id
                    )
                )
                existing_package = existing_check.scalar_one_or_none()

                if existing_package:
                    logger.info(f"  [{idx}/{total}] {posting.posting_number}: 已有package记录，跳过")
                    continue

                # 创建package记录
                # 使用posting_number作为package_number（因为OZON列表API不返回单独的package_number）
                package = OzonShipmentPackage(
                    posting_id=posting.id,
                    package_number=posting.posting_number,  # 使用posting_number作为默认值
                    tracking_number=tracking_number,
                    carrier_name=raw_data.get('carrier_name'),
                    carrier_code=raw_data.get('carrier_code'),
                    status=posting.status  # 继承posting状态
                )

                db.add(package)

                # 每100条提交一次
                if (idx % 100) == 0:
                    await db.commit()
                    logger.info(f"  [{idx}/{total}] 已处理 {idx} 条记录...")

                processed += 1

            except Exception as e:
                logger.error(f"  [{idx}/{total}] 处理 posting ID {posting_id} 时出错: {e}")
                errors += 1
                await db.rollback()
                continue

        # 最终提交
        await db.commit()

        logger.info(f"\n✅ 迁移完成！")
        logger.info(f"   成功: {processed} 条")
        logger.info(f"   失败: {errors} 条")
        logger.info(f"   总计: {total} 条")

        # 3. 验证结果
        result = await db.execute(
            select(OzonShipmentPackage.id)
        )
        final_count = len(result.scalars().all())

        logger.info(f"\n📊 验证: 数据库中现在有 {final_count} 条package记录")


if __name__ == "__main__":
    asyncio.run(migrate_tracking_numbers())
