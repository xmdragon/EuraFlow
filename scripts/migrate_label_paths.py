#!/usr/bin/env python3
"""
迁移标签PDF路径脚本
将数据库中的标签路径从 web/public/downloads/labels/{shop_id}/{posting_number}.pdf
修改为 web/public/downloads/labels/{posting_number}.pdf
"""
import asyncio
import sys
import os

# 添加项目根目录到路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update, text
from ef_core.database import get_async_session
from plugins.ef.channels.ozon.models.orders import OzonPosting


async def migrate_label_paths():
    """迁移标签路径"""

    async for db in get_async_session():
        try:
            # 查询所有有标签路径的posting
            result = await db.execute(
                select(OzonPosting).where(OzonPosting.label_pdf_path.isnot(None))
            )
            postings = result.scalars().all()

            print(f"找到 {len(postings)} 个有标签路径的posting")

            updated_count = 0
            for posting in postings:
                old_path = posting.label_pdf_path

                # 检查是否是旧格式的路径（包含店铺ID子目录）
                if '/labels/' in old_path and old_path.count('/') > 4:
                    # 提取posting_number.pdf部分
                    filename = os.path.basename(old_path)
                    new_path = f"web/public/downloads/labels/{filename}"

                    # 更新路径
                    await db.execute(
                        update(OzonPosting)
                        .where(OzonPosting.id == posting.id)
                        .values(label_pdf_path=new_path)
                    )

                    print(f"✓ {posting.posting_number}: {old_path} -> {new_path}")
                    updated_count += 1

            # 提交事务
            await db.commit()

            print(f"\n✅ 完成！共更新了 {updated_count} 条记录")

        except Exception as e:
            print(f"❌ 错误: {e}")
            await db.rollback()
            raise
        finally:
            await db.close()
            break


if __name__ == "__main__":
    asyncio.run(migrate_label_paths())
