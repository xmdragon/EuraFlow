#!/usr/bin/env python
"""
比较正常商品和下架商品的数据库记录差异
"""

import asyncio
from sqlalchemy import select, or_, and_
from ef_core.database import get_async_session
from plugins.ef.channels.ozon.models.ozon_products import OzonProduct
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def compare_product_status():
    """比较正常和下架商品的记录差异"""

    # 用户提供的商品ID
    normal_ids = [2377928033, 2800638824]  # 正常商品ID
    archived_ids = [2799948965, 2810987619]  # 下架商品ID
    all_ids = normal_ids + archived_ids

    logger.info("=== 比较商品状态差异 ===")
    logger.info(f"正常商品ID: {normal_ids}")
    logger.info(f"下架商品ID: {archived_ids}")

    async for session in get_async_session():
        try:
            # 首先查询用户指定的ID
            query = select(OzonProduct).where(
                OzonProduct.ozon_product_id.in_(all_ids)
            )
            result = await session.execute(query)
            target_products = result.scalars().all()

            if target_products:
                logger.info(f"\n=== 找到 {len(target_products)} 个目标商品 ===")

                # 分类显示
                for product in target_products:
                    category = "正常" if product.ozon_product_id in normal_ids else "下架"
                    logger.info(f"\n【{category}商品】 ID: {product.ozon_product_id}")
                    logger.info(f"  SKU: {product.sku}")
                    logger.info(f"  标题: {product.title}")
                    logger.info(f"  status: {product.status}")
                    logger.info(f"  is_archived: {product.is_archived}")
                    logger.info(f"  ozon_archived: {product.ozon_archived}")
                    logger.info(f"  visibility: {product.visibility}")
                    logger.info(f"  ozon_has_fbo_stocks: {product.ozon_has_fbo_stocks}")
                    logger.info(f"  ozon_has_fbs_stocks: {product.ozon_has_fbs_stocks}")
                    logger.info(f"  ozon_visibility_status: {product.ozon_visibility_status}")
                    logger.info(f"  price: {product.price}")
                    logger.info(f"  stock: {product.stock}")
                    logger.info(f"  available: {product.available}")
            else:
                logger.info("目标商品ID在数据库中未找到")

            # 既然目标ID可能不在数据库中，让我们查看现有的下架商品样本
            logger.info("\n=== 查看数据库中的下架商品样本 ===")

            # 查询明确标记为下架的商品
            archived_query = select(OzonProduct).where(
                or_(
                    OzonProduct.ozon_archived == True,
                    OzonProduct.is_archived == True,
                    OzonProduct.status == "archived"
                )
            ).limit(5)

            archived_result = await session.execute(archived_query)
            archived_samples = archived_result.scalars().all()

            logger.info(f"找到 {len(archived_samples)} 个下架商品样本:")
            for product in archived_samples:
                logger.info(f"\n【下架样本】 ID: {product.ozon_product_id}")
                logger.info(f"  status: {product.status}")
                logger.info(f"  is_archived: {product.is_archived}")
                logger.info(f"  ozon_archived: {product.ozon_archived}")
                logger.info(f"  visibility: {product.visibility}")
                logger.info(f"  ozon_has_fbo_stocks: {product.ozon_has_fbo_stocks}")
                logger.info(f"  ozon_has_fbs_stocks: {product.ozon_has_fbs_stocks}")

            # 查询正常商品样本进行对比
            logger.info("\n=== 查看数据库中的正常商品样本 ===")

            normal_query = select(OzonProduct).where(
                and_(
                    OzonProduct.ozon_archived == False,
                    OzonProduct.is_archived == False,
                    OzonProduct.status == "active"
                )
            ).limit(5)

            normal_result = await session.execute(normal_query)
            normal_samples = normal_result.scalars().all()

            logger.info(f"找到 {len(normal_samples)} 个正常商品样本:")
            for product in normal_samples:
                logger.info(f"\n【正常样本】 ID: {product.ozon_product_id}")
                logger.info(f"  status: {product.status}")
                logger.info(f"  is_archived: {product.is_archived}")
                logger.info(f"  ozon_archived: {product.ozon_archived}")
                logger.info(f"  visibility: {product.visibility}")
                logger.info(f"  ozon_has_fbo_stocks: {product.ozon_has_fbo_stocks}")
                logger.info(f"  ozon_has_fbs_stocks: {product.ozon_has_fbs_stocks}")

            # 总结差异
            logger.info("\n=== 总结：下架商品的判断规则 ===")

            if archived_samples and normal_samples:
                # 分析下架商品的共同特征
                archived_features = {
                    'ozon_archived_true': sum(1 for p in archived_samples if p.ozon_archived),
                    'is_archived_true': sum(1 for p in archived_samples if p.is_archived),
                    'status_archived': sum(1 for p in archived_samples if p.status == "archived"),
                    'visibility_false': sum(1 for p in archived_samples if not p.visibility),
                    'no_fbo_stocks': sum(1 for p in archived_samples if not p.ozon_has_fbo_stocks),
                    'no_fbs_stocks': sum(1 for p in archived_samples if not p.ozon_has_fbs_stocks),
                }

                # 分析正常商品的共同特征
                normal_features = {
                    'ozon_archived_false': sum(1 for p in normal_samples if not p.ozon_archived),
                    'is_archived_false': sum(1 for p in normal_samples if not p.is_archived),
                    'status_active': sum(1 for p in normal_samples if p.status == "active"),
                    'visibility_true': sum(1 for p in normal_samples if p.visibility),
                }

                logger.info("下架商品特征统计:")
                for feature, count in archived_features.items():
                    percentage = (count / len(archived_samples)) * 100
                    logger.info(f"  {feature}: {count}/{len(archived_samples)} ({percentage:.1f}%)")

                logger.info("正常商品特征统计:")
                for feature, count in normal_features.items():
                    percentage = (count / len(normal_samples)) * 100
                    logger.info(f"  {feature}: {count}/{len(normal_samples)} ({percentage:.1f}%)")

                # 得出结论
                logger.info("\n✅ 结论：商品下架判断规则")
                logger.info("根据代码逻辑和数据分析，商品被判定为'下架'的条件是:")
                logger.info("1. ozon_archived = true (OZON平台归档)")
                logger.info("2. 或 is_archived = true (本地归档)")
                logger.info("3. 满足任一条件时，status 会被设置为 'archived'")

        except Exception as e:
            logger.error(f"查询失败: {e}")
            import traceback
            traceback.print_exc()

        break

if __name__ == "__main__":
    asyncio.run(compare_product_status())