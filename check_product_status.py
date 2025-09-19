#!/usr/bin/env python
"""
查询指定商品ID的状态信息
"""

import asyncio
from sqlalchemy import select, text
from ef_core.database import get_async_session
from plugins.ef.channels.ozon.models.ozon_products import OzonProduct
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def check_product_status():
    """检查指定商品ID的状态"""

    # 用户提供的商品ID
    normal_ids = [2377928033, 2800638824]  # 正常商品ID
    archived_ids = [2799948965, 2810987619]  # 下架商品ID
    all_ids = normal_ids + archived_ids

    logger.info("=== 检查商品状态 ===")
    logger.info(f"正常商品ID: {normal_ids}")
    logger.info(f"下架商品ID: {archived_ids}")

    async for session in get_async_session():
        try:
            # 查询这些商品的状态信息
            query = select(
                OzonProduct.ozon_product_id,
                OzonProduct.sku,
                OzonProduct.title,
                OzonProduct.status,
                OzonProduct.is_archived,
                OzonProduct.ozon_archived,
                OzonProduct.visibility,
                OzonProduct.ozon_has_fbo_stocks,
                OzonProduct.ozon_has_fbs_stocks,
                OzonProduct.ozon_visibility_status
            ).where(
                OzonProduct.ozon_product_id.in_(all_ids)
            )

            result = await session.execute(query)
            products = result.fetchall()

            if not products:
                logger.info("在数据库中没有找到这些商品ID")

                # 尝试直接查询数据库看看有哪些商品
                logger.info("\n=== 查看数据库中的商品样本 ===")
                sample_query = select(
                    OzonProduct.ozon_product_id,
                    OzonProduct.sku,
                    OzonProduct.status,
                    OzonProduct.is_archived,
                    OzonProduct.ozon_archived
                ).limit(10)

                sample_result = await session.execute(sample_query)
                sample_products = sample_result.fetchall()

                for product in sample_products:
                    logger.info(f"样本商品: ID={product.ozon_product_id}, SKU={product.sku}, "
                              f"status={product.status}, is_archived={product.is_archived}, "
                              f"ozon_archived={product.ozon_archived}")
                return

            logger.info(f"\n=== 找到 {len(products)} 个商品 ===")

            # 分析每个商品的状态
            for product in products:
                product_id = product.ozon_product_id
                category = "正常" if product_id in normal_ids else "下架"

                logger.info(f"\n商品ID: {product_id} ({category})")
                logger.info(f"  SKU: {product.sku}")
                logger.info(f"  标题: {product.title}")
                logger.info(f"  状态: {product.status}")
                logger.info(f"  本地归档状态 (is_archived): {product.is_archived}")
                logger.info(f"  OZON归档状态 (ozon_archived): {product.ozon_archived}")
                logger.info(f"  可见性 (visibility): {product.visibility}")
                logger.info(f"  有FBO库存: {product.ozon_has_fbo_stocks}")
                logger.info(f"  有FBS库存: {product.ozon_has_fbs_stocks}")
                logger.info(f"  OZON可见性状态: {product.ozon_visibility_status}")

            # 统计分析
            logger.info("\n=== 状态统计分析 ===")

            normal_products = [p for p in products if p.ozon_product_id in normal_ids]
            archived_products = [p for p in products if p.ozon_product_id in archived_ids]

            if normal_products:
                logger.info("正常商品的状态特征:")
                for p in normal_products:
                    logger.info(f"  ID {p.ozon_product_id}: ozon_archived={p.ozon_archived}, "
                              f"is_archived={p.is_archived}, status={p.status}")

            if archived_products:
                logger.info("下架商品的状态特征:")
                for p in archived_products:
                    logger.info(f"  ID {p.ozon_product_id}: ozon_archived={p.ozon_archived}, "
                              f"is_archived={p.is_archived}, status={p.status}")

            # 验证假设
            logger.info("\n=== 验证下架判断规则 ===")
            archived_have_ozon_archived_true = all(p.ozon_archived for p in archived_products)
            normal_have_ozon_archived_false = all(not p.ozon_archived for p in normal_products)

            logger.info(f"所有下架商品的ozon_archived都为True: {archived_have_ozon_archived_true}")
            logger.info(f"所有正常商品的ozon_archived都为False: {normal_have_ozon_archived_false}")

            if archived_have_ozon_archived_true and normal_have_ozon_archived_false:
                logger.info("✅ 判断规则验证成功：商品下架状态与ozon_archived字段一致")
            else:
                logger.info("❌ 判断规则需要进一步分析")

        except Exception as e:
            logger.error(f"查询失败: {e}")

        break

if __name__ == "__main__":
    asyncio.run(check_product_status())