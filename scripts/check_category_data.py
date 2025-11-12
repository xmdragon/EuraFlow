#!/usr/bin/env python3
"""检查数据库中的类目数据"""
import asyncio
import sys
from pathlib import Path

project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker
from ef_core.database import DatabaseManager
from plugins.ef.channels.ozon.models.listing import OzonCategory

async def main():
    db_manager = DatabaseManager()
    engine = db_manager.create_async_engine()
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        # 查找"手机支架"类目（ID=98636）
        stmt = select(OzonCategory).where(
            OzonCategory.category_id == 98636
        )
        result = await db.execute(stmt)
        category = result.scalar_one_or_none()

        if not category:
            print("❌ 未找到手机支架类目（ID=98636）")
            return

        print(f"\n✅ 找到类目: {category.name}")
        print(f"   category_id: {category.category_id}")
        print(f"   parent_id: {category.parent_id}")
        print(f"   is_leaf: {category.is_leaf}")

        # 查找父类目
        if category.parent_id:
            stmt_parent = select(OzonCategory).where(
                OzonCategory.category_id == category.parent_id
            )
            result_parent = await db.execute(stmt_parent)
            parent = result_parent.scalar_one_or_none()

            if parent:
                print(f"\n父类目:")
                print(f"   name: {parent.name}")
                print(f"   category_id: {parent.category_id}")
                print(f"   parent_id: {parent.parent_id}")
                print(f"   is_leaf: {parent.is_leaf}")

                # 查找爷爷类目
                if parent.parent_id:
                    stmt_grandparent = select(OzonCategory).where(
                        OzonCategory.category_id == parent.parent_id
                    )
                    result_grandparent = await db.execute(stmt_grandparent)
                    grandparent = result_grandparent.scalar_one_or_none()

                    if grandparent:
                        print(f"\n爷爷类目:")
                        print(f"   name: {grandparent.name}")
                        print(f"   category_id: {grandparent.category_id}")
                        print(f"   parent_id: {grandparent.parent_id}")
                        print(f"   is_leaf: {grandparent.is_leaf}")

        # 查找该类目的所有兄弟类目（同一个父类目下的其他叶子类目）
        if category.parent_id:
            stmt_siblings = select(OzonCategory).where(
                OzonCategory.parent_id == category.parent_id,
                OzonCategory.is_leaf == True,
                OzonCategory.category_id != category.category_id
            ).limit(10)
            result_siblings = await db.execute(stmt_siblings)
            siblings = result_siblings.scalars().all()

            if siblings:
                print(f"\n同父类目下的其他叶子类目（前10个）:")
                for sib in siblings:
                    print(f"   - {sib.name} (ID: {sib.category_id})")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(main())
