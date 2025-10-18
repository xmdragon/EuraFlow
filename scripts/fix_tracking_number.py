#!/usr/bin/env python3
"""
临时脚本:修复 tracking_number 被错误填入 posting_number 的数据
- 清理 raw_payload 中 tracking_number = posting_number 的错误数据
- 清理 packages 表中 tracking_number = posting_number 的错误数据
"""
import sys
import os
from pathlib import Path

# 添加项目根目录到 Python 路径
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

import asyncio
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_db_manager
from plugins.ef.channels.ozon.models.orders import OzonPosting, OzonShipmentPackage


async def fix_tracking_number():
    """修复 tracking_number 错误数据"""
    db_manager = get_db_manager()

    async with db_manager.get_session() as session:
        # 统计需要修复的数据
        print("=" * 60)
        print("开始统计需要修复的数据...")
        print("=" * 60)

        # 1. 统计 raw_payload 中的错误数据
        stmt = select(OzonPosting)
        result = await session.execute(stmt)
        postings = result.scalars().all()

        raw_payload_errors = []
        for p in postings:
            raw_tn = p.raw_payload.get('tracking_number') if p.raw_payload else None
            if raw_tn and raw_tn == p.posting_number:
                raw_payload_errors.append(p)

        print(f"\n1. raw_payload 中错误的数量: {len(raw_payload_errors)}")
        if raw_payload_errors[:5]:
            print("   示例:")
            for p in raw_payload_errors[:5]:
                print(f"     posting: {p.posting_number}, 错误tracking: {p.raw_payload.get('tracking_number')}")

        # 2. 统计 packages 表中的错误数据
        pkg_stmt = select(OzonShipmentPackage)
        pkg_result = await session.execute(pkg_stmt)
        packages = pkg_result.scalars().all()

        package_errors = []
        for pkg in packages:
            # 获取对应的posting
            posting_stmt = select(OzonPosting).where(OzonPosting.id == pkg.posting_id)
            posting_result = await session.execute(posting_stmt)
            posting = posting_result.scalar_one_or_none()

            if posting and pkg.tracking_number == posting.posting_number:
                package_errors.append((pkg, posting))

        print(f"2. packages 表中错误的数量: {len(package_errors)}")
        if package_errors[:5]:
            print("   示例:")
            for pkg, posting in package_errors[:5]:
                print(f"     package_id: {pkg.id}, posting: {posting.posting_number}, 错误tracking: {pkg.tracking_number}")

        # 确认是否继续
        print("\n" + "=" * 60)
        print("是否继续修复?")
        print(f"  - 将修复 {len(raw_payload_errors)} 个 raw_payload 错误")
        print(f"  - 将修复 {len(package_errors)} 个 package 错误")
        print("=" * 60)

        # 自动执行(脚本模式)
        print("\n开始修复...")

        # 3. 修复 raw_payload 中的错误数据
        fixed_raw_payload = 0
        for posting in raw_payload_errors:
            if posting.raw_payload:
                # 删除错误的 tracking_number 字段
                if 'tracking_number' in posting.raw_payload:
                    del posting.raw_payload['tracking_number']
                    fixed_raw_payload += 1

        if fixed_raw_payload > 0:
            # 标记为修改,以便SQLAlchemy检测到JSON字段的变化
            await session.flush()
            print(f"\n✓ 已修复 raw_payload 中的错误数据: {fixed_raw_payload} 条")
        else:
            print("\n✓ 无需修复 raw_payload 数据")

        # 4. 修复 packages 表中的错误数据
        fixed_packages = 0
        for pkg, posting in package_errors:
            pkg.tracking_number = None
            fixed_packages += 1

        if fixed_packages > 0:
            print(f"✓ 已修复 packages 表中的错误数据: {fixed_packages} 条")
        else:
            print("✓ 无需修复 packages 数据")

        # 5. 提交事务
        await session.commit()

        # 6. 验证修复结果
        print("\n" + "=" * 60)
        print("验证修复结果...")
        print("=" * 60)

        # 重新统计
        stmt = select(OzonPosting)
        result = await session.execute(stmt)
        postings = result.scalars().all()

        remaining_raw_errors = 0
        for p in postings:
            raw_tn = p.raw_payload.get('tracking_number') if p.raw_payload else None
            if raw_tn and raw_tn == p.posting_number:
                remaining_raw_errors += 1

        print(f"\n剩余 raw_payload 错误: {remaining_raw_errors}")

        # 重新统计packages
        pkg_stmt = select(OzonShipmentPackage)
        pkg_result = await session.execute(pkg_stmt)
        packages = pkg_result.scalars().all()

        remaining_pkg_errors = 0
        for pkg in packages:
            posting_stmt = select(OzonPosting).where(OzonPosting.id == pkg.posting_id)
            posting_result = await session.execute(posting_stmt)
            posting = posting_result.scalar_one_or_none()

            if posting and pkg.tracking_number == posting.posting_number:
                remaining_pkg_errors += 1

        print(f"剩余 packages 错误: {remaining_pkg_errors}")

        print("\n" + "=" * 60)
        print("✓ 修复完成!")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(fix_tracking_number())
