#!/usr/bin/env python3
"""检查数据库中的追踪号码数据"""
import asyncio
import sys
from pathlib import Path

# 添加项目根目录到Python路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select, func
from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models import OzonPosting, OzonShipmentPackage

async def check_tracking():
    db_manager = get_db_manager()

    async with db_manager.get_session() as db:
        # 1. 统计包裹总数
        result = await db.execute(select(func.count(OzonShipmentPackage.id)))
        total_packages = result.scalar()
        print(f"📦 包裹总数: {total_packages}")

        # 2. 统计有追踪号的包裹
        result = await db.execute(
            select(func.count(OzonShipmentPackage.id))
            .where(OzonShipmentPackage.tracking_number.isnot(None))
            .where(OzonShipmentPackage.tracking_number != '')
        )
        tracked_packages = result.scalar()
        print(f"✅ 有追踪号的包裹: {tracked_packages}")

        # 3. 如果有追踪号，显示示例
        if tracked_packages > 0:
            print("\n=== 追踪号码示例 ===")
            result = await db.execute(
                select(OzonShipmentPackage, OzonPosting.posting_number, OzonPosting.status)
                .join(OzonPosting, OzonShipmentPackage.posting_id == OzonPosting.id)
                .where(OzonShipmentPackage.tracking_number.isnot(None))
                .where(OzonShipmentPackage.tracking_number != '')
                .limit(10)
            )
            samples = result.all()

            for pkg, posting_number, status in samples:
                print(f"\nPosting: {posting_number} (状态: {status})")
                print(f"  └─ 追踪号: {pkg.tracking_number}")
                print(f"     承运商: {pkg.carrier_name or 'N/A'}")
                print(f"     包裹号: {pkg.package_number}")

        # 4. 统计应该有追踪号的订单（待发运、运输中、已签收）
        result = await db.execute(
            select(func.count(OzonPosting.id))
            .where(OzonPosting.status.in_(['awaiting_deliver', 'delivering', 'delivered']))
        )
        should_have_tracking = result.scalar()
        print(f"\n📊 应该有追踪号的订单数: {should_have_tracking}")

        # 5. 统计实际有包裹的订单数
        result = await db.execute(
            select(func.count(func.distinct(OzonShipmentPackage.posting_id)))
        )
        postings_with_packages = result.scalar()
        print(f"📦 已有包裹数据的订单数: {postings_with_packages}")

        # 6. 缺失包裹数据的订单
        missing_count = should_have_tracking - postings_with_packages
        print(f"⚠️  缺失包裹数据的订单数: {missing_count}")

        # 7. 显示几个缺失包裹数据的订单示例
        if missing_count > 0:
            print("\n=== 缺失包裹数据的订单示例 ===")
            result = await db.execute(
                select(OzonPosting.posting_number, OzonPosting.status)
                .outerjoin(OzonShipmentPackage, OzonPosting.id == OzonShipmentPackage.posting_id)
                .where(OzonPosting.status.in_(['awaiting_deliver', 'delivering', 'delivered']))
                .where(OzonShipmentPackage.id.is_(None))
                .limit(5)
            )
            missing_samples = result.all()

            for posting_number, status in missing_samples:
                print(f"  • {posting_number} (状态: {status}) - 缺少包裹数据")

if __name__ == "__main__":
    asyncio.run(check_tracking())
