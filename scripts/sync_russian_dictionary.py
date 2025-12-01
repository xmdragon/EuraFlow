"""
手动同步字典俄文翻译脚本

在后台运行：nohup ./venv/bin/python scripts/sync_russian_dictionary.py > logs/sync_russian.log 2>&1 &
"""
import asyncio
import logging
import sys
from pathlib import Path

# 添加项目根目录到 Python 路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

from ef_core.config import get_settings
from plugins.ef.channels.ozon.models.listing import OzonCategoryAttribute, OzonAttributeDictionaryValue
from plugins.ef.channels.ozon.models import OzonShop
from plugins.ef.channels.ozon.api.client import OzonAPIClient

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)


async def sync_russian_translations():
    """同步缺少俄文翻译的字典值"""
    settings = get_settings()

    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    AsyncSession = async_sessionmaker(engine, expire_on_commit=False)

    async with AsyncSession() as db:
        # 1. 获取第一个活跃店铺（用于 API 调用）
        shop_result = await db.execute(
            select(OzonShop).where(OzonShop.status == "active").limit(1)
        )
        shop = shop_result.scalar_one_or_none()

        if not shop:
            logger.error("没有找到活跃店铺")
            return

        logger.info(f"使用店铺: {shop.shop_name} (ID: {shop.id})")

        # 2. 查找缺少俄文翻译的字典（从 OzonCategoryAttribute 获取 category_id 和 attribute_id）
        missing_ru_query = (
            select(
                OzonCategoryAttribute.dictionary_id,
                OzonCategoryAttribute.category_id,
                OzonCategoryAttribute.attribute_id,
                func.count().label('missing_count')
            )
            .join(
                OzonAttributeDictionaryValue,
                OzonAttributeDictionaryValue.dictionary_id == OzonCategoryAttribute.dictionary_id
            )
            .where(
                and_(
                    OzonCategoryAttribute.dictionary_id.isnot(None),
                    or_(
                        OzonAttributeDictionaryValue.value_ru.is_(None),
                        OzonAttributeDictionaryValue.value_ru == ""
                    )
                )
            )
            .group_by(
                OzonCategoryAttribute.dictionary_id,
                OzonCategoryAttribute.category_id,
                OzonCategoryAttribute.attribute_id
            )
            .order_by(func.count().desc())
        )

        result = await db.execute(missing_ru_query)
        dictionaries = result.fetchall()

        logger.info(f"找到 {len(dictionaries)} 个字典需要同步俄文翻译")

        if not dictionaries:
            logger.info("所有字典都已有俄文翻译")
            return

        # 3. 创建 API 客户端
        client = OzonAPIClient(
            client_id=shop.client_id,
            api_key=shop.api_key_enc,
            shop_id=shop.id
        )

        # 4. 逐个字典同步俄文
        synced_count = 0
        failed_count = 0

        for idx, row in enumerate(dictionaries):
            dictionary_id = row.dictionary_id
            category_id = row.category_id
            attribute_id = row.attribute_id
            missing_count = row.missing_count

            logger.info(f"[{idx+1}/{len(dictionaries)}] 同步字典 {dictionary_id} (类目={category_id}, 特征={attribute_id}, 缺失俄文={missing_count})")

            try:
                # 调用 OZON API 获取俄文字典值
                all_values = []
                last_value_id = 0

                while True:
                    response = await client.get_category_attribute_values(
                        category_id=category_id,
                        attribute_id=attribute_id,
                        limit=5000,
                        last_value_id=last_value_id,
                        language="DEFAULT"  # 俄文
                    )

                    values = response.get("result", [])
                    if not values:
                        break

                    all_values.extend(values)

                    if not response.get("has_next", False):
                        break

                    last_value_id = values[-1].get("id", 0)

                logger.info(f"  从 API 获取到 {len(all_values)} 个俄文值")

                # 更新数据库中的俄文翻译
                updated = 0
                for val in all_values:
                    value_id = val.get("id")
                    value_text = val.get("value", "")
                    info_text = val.get("info", "")

                    if value_id and value_text:
                        # 更新俄文字段
                        existing = await db.execute(
                            select(OzonAttributeDictionaryValue).where(
                                and_(
                                    OzonAttributeDictionaryValue.dictionary_id == dictionary_id,
                                    OzonAttributeDictionaryValue.value_id == value_id
                                )
                            )
                        )
                        existing_record = existing.scalar_one_or_none()

                        if existing_record and (not existing_record.value_ru or existing_record.value_ru == ""):
                            existing_record.value_ru = value_text
                            existing_record.info_ru = info_text
                            updated += 1

                await db.commit()

                logger.info(f"  更新了 {updated} 条俄文翻译")
                synced_count += 1

                # 每 100 个字典休息一下
                if synced_count % 100 == 0:
                    logger.info(f"已同步 {synced_count}/{len(dictionaries)} 个字典，休息 5 秒...")
                    await asyncio.sleep(5)
                else:
                    await asyncio.sleep(0.5)  # 每个字典之间短暂延迟

            except Exception as e:
                logger.error(f"  同步失败: {e}")
                failed_count += 1
                await asyncio.sleep(1)  # 失败后多等一会儿
                continue

        # 关闭客户端
        await client.close()

        logger.info(f"同步完成！成功: {synced_count}, 失败: {failed_count}")

        # 检查剩余缺失数量
        remaining = await db.execute(
            select(func.count()).select_from(OzonAttributeDictionaryValue).where(
                or_(
                    OzonAttributeDictionaryValue.value_ru.is_(None),
                    OzonAttributeDictionaryValue.value_ru == ""
                )
            )
        )
        remaining_count = remaining.scalar()
        logger.info(f"剩余缺少俄文翻译的记录: {remaining_count}")


if __name__ == "__main__":
    asyncio.run(sync_russian_translations())
