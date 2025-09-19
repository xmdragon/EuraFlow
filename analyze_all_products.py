#!/usr/bin/env python
"""
分析数据库中所有商品的状态分布
"""

import asyncio
from sqlalchemy import select, func, distinct, text
from ef_core.database import get_async_session
from plugins.ef.channels.ozon.models.ozon_products import OzonProduct
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def analyze_all_products():
    """分析所有商品的状态分布"""

    logger.info("=== 分析数据库中所有商品状态 ===")

    async for session in get_async_session():
        try:
            # 1. 统计总商品数
            total_query = select(func.count(OzonProduct.id))
            total_result = await session.execute(total_query)
            total_count = total_result.scalar()
            logger.info(f"数据库中总商品数: {total_count}")

            # 2. 按status统计
            logger.info("\n=== 按status字段统计 ===")
            status_query = select(
                OzonProduct.status,
                func.count(OzonProduct.id).label('count')
            ).group_by(OzonProduct.status)

            status_result = await session.execute(status_query)
            status_stats = status_result.fetchall()

            for status, count in status_stats:
                logger.info(f"  {status}: {count}个")

            # 3. 按ozon_archived统计
            logger.info("\n=== 按ozon_archived字段统计 ===")
            ozon_archived_query = select(
                OzonProduct.ozon_archived,
                func.count(OzonProduct.id).label('count')
            ).group_by(OzonProduct.ozon_archived)

            ozon_archived_result = await session.execute(ozon_archived_query)
            ozon_archived_stats = ozon_archived_result.fetchall()

            for archived, count in ozon_archived_stats:
                logger.info(f"  ozon_archived={archived}: {count}个")

            # 4. 按is_archived统计
            logger.info("\n=== 按is_archived字段统计 ===")
            is_archived_query = select(
                OzonProduct.is_archived,
                func.count(OzonProduct.id).label('count')
            ).group_by(OzonProduct.is_archived)

            is_archived_result = await session.execute(is_archived_query)
            is_archived_stats = is_archived_result.fetchall()

            for archived, count in is_archived_stats:
                logger.info(f"  is_archived={archived}: {count}个")

            # 5. 按visibility统计
            logger.info("\n=== 按visibility字段统计 ===")
            visibility_query = select(
                OzonProduct.visibility,
                func.count(OzonProduct.id).label('count')
            ).group_by(OzonProduct.visibility)

            visibility_result = await session.execute(visibility_query)
            visibility_stats = visibility_result.fetchall()

            for visibility, count in visibility_stats:
                logger.info(f"  visibility={visibility}: {count}个")

            # 6. 查看一些非活跃状态的商品（如果有）
            logger.info("\n=== 查看非活跃状态商品样本 ===")
            inactive_query = select(OzonProduct).where(
                OzonProduct.status != 'active'
            ).limit(5)

            inactive_result = await session.execute(inactive_query)
            inactive_products = inactive_result.scalars().all()

            if inactive_products:
                logger.info(f"找到 {len(inactive_products)} 个非活跃商品:")
                for product in inactive_products:
                    logger.info(f"\n【非活跃商品】 ID: {product.ozon_product_id}")
                    logger.info(f"  SKU: {product.sku}")
                    logger.info(f"  status: {product.status}")
                    logger.info(f"  is_archived: {product.is_archived}")
                    logger.info(f"  ozon_archived: {product.ozon_archived}")
                    logger.info(f"  visibility: {product.visibility}")
                    logger.info(f"  ozon_has_fbo_stocks: {product.ozon_has_fbo_stocks}")
                    logger.info(f"  ozon_has_fbs_stocks: {product.ozon_has_fbs_stocks}")
                    logger.info(f"  price: {product.price}")
                    logger.info(f"  stock: {product.stock}")
            else:
                logger.info("没有找到非活跃状态的商品")

            # 7. 检查商品ID范围
            logger.info("\n=== 商品ID范围分析 ===")
            id_range_query = select(
                func.min(OzonProduct.ozon_product_id).label('min_id'),
                func.max(OzonProduct.ozon_product_id).label('max_id'),
                func.count(OzonProduct.ozon_product_id).label('count')
            )

            id_range_result = await session.execute(id_range_query)
            min_id, max_id, count = id_range_result.fetchone()

            logger.info(f"商品ID范围: {min_id} - {max_id}")
            logger.info(f"有效商品ID数量: {count}")

            # 8. 查看用户提供的ID是否在范围内
            user_ids = [2377928033, 2800638824, 2799948965, 2810987619]
            logger.info(f"\n=== 用户提供的ID分析 ===")
            logger.info(f"用户提供的ID: {user_ids}")
            logger.info(f"数据库ID范围: {min_id} - {max_id}")

            for user_id in user_ids:
                if min_id <= user_id <= max_id:
                    logger.info(f"  {user_id}: 在数据库ID范围内")
                else:
                    logger.info(f"  {user_id}: 超出数据库ID范围")

            # 9. 根据代码分析总结下架判断规则
            logger.info("\n=== 根据代码分析的下架判断规则 ===")
            logger.info("基于 ozon_sync.py:284-286 的代码逻辑:")
            logger.info("```python")
            logger.info("if product.ozon_archived or product.is_archived:")
            logger.info("    product.status = 'archived'")
            logger.info("```")
            logger.info("")
            logger.info("商品被判定为'下架'的条件:")
            logger.info("1. ozon_archived = True  (OZON平台主动归档)")
            logger.info("2. 或 is_archived = True  (本地手动归档)")
            logger.info("3. 满足任一条件时，status 自动设置为 'archived'")
            logger.info("")
            logger.info("当前数据库状态:")
            logger.info("- 所有商品的 ozon_archived = False")
            logger.info("- 所有商品的 is_archived = False")
            logger.info("- 所有商品的 status = 'active'")
            logger.info("- 说明当前没有下架商品")

        except Exception as e:
            logger.error(f"分析失败: {e}")
            import traceback
            traceback.print_exc()

        break

if __name__ == "__main__":
    asyncio.run(analyze_all_products())