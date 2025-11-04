#!/usr/bin/env python3
"""
导入 Posting 数据脚本
从 CSV 文件导入进货价格、采购平台、国内单号
支持多个采购平台和多个国内单号
"""
import sys
import csv
import logging
from pathlib import Path
from decimal import Decimal
from datetime import datetime, timezone

# 添加项目根目录到 sys.path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlalchemy import select
from sqlalchemy.orm import Session
from ef_core.database import get_sync_session
from plugins.ef.channels.ozon.models.orders import OzonPosting, OzonDomesticTracking

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


def import_posting_data(csv_path: str, dry_run: bool = False):
    """
    导入 Posting 数据

    Args:
        csv_path: CSV 文件路径
        dry_run: 是否为试运行模式（不实际写入数据库）
    """
    logger.info(f"开始导入数据，文件: {csv_path}")
    logger.info(f"试运行模式: {'是' if dry_run else '否'}")

    stats = {
        'total': 0,
        'updated': 0,
        'not_found': 0,
        'error': 0,
        'platforms_added': 0,
        'tracking_numbers_added': 0
    }

    session: Session = next(get_sync_session())

    try:
        with open(csv_path, 'r', encoding='utf-8') as f:
            reader = csv.reader(f)

            for row in reader:
                stats['total'] += 1

                if len(row) != 4:
                    logger.warning(f"第 {stats['total']} 行数据格式错误，跳过: {row}")
                    stats['error'] += 1
                    continue

                posting_number, purchase_price_str, source_platform, domestic_tracking = row
                posting_number = posting_number.strip()
                purchase_price_str = purchase_price_str.strip()
                source_platform = source_platform.strip()
                domestic_tracking = domestic_tracking.strip()

                logger.info(f"\n处理 Posting: {posting_number}")

                # 查找 Posting
                stmt = select(OzonPosting).where(OzonPosting.posting_number == posting_number)
                posting = session.execute(stmt).scalar_one_or_none()

                if not posting:
                    logger.warning(f"  未找到 Posting: {posting_number}")
                    stats['not_found'] += 1
                    continue

                try:
                    # 1. 更新进货价格
                    if purchase_price_str:
                        purchase_price = Decimal(purchase_price_str)
                        if posting.purchase_price != purchase_price:
                            logger.info(f"  更新进货价格: {posting.purchase_price} -> {purchase_price}")
                            posting.purchase_price = purchase_price
                            posting.purchase_price_updated_at = utcnow()

                    # 2. 追加采购平台（支持多个）
                    if source_platform:
                        # 获取现有平台列表
                        existing_platforms = posting.source_platform if posting.source_platform else []
                        if not isinstance(existing_platforms, list):
                            existing_platforms = []

                        # 添加新平台（去重）
                        if source_platform not in existing_platforms:
                            existing_platforms.append(source_platform)
                            posting.source_platform = existing_platforms
                            stats['platforms_added'] += 1
                            logger.info(f"  添加采购平台: {source_platform} (总计: {existing_platforms})")
                        else:
                            logger.info(f"  采购平台已存在: {source_platform}")

                    # 3. 追加国内单号（支持多个）
                    if domestic_tracking:
                        # 检查是否已存在
                        existing_stmt = select(OzonDomesticTracking).where(
                            OzonDomesticTracking.posting_id == posting.id,
                            OzonDomesticTracking.tracking_number == domestic_tracking
                        )
                        existing_tracking = session.execute(existing_stmt).scalar_one_or_none()

                        if not existing_tracking:
                            # 创建新的国内单号记录
                            new_tracking = OzonDomesticTracking(
                                posting_id=posting.id,
                                tracking_number=domestic_tracking
                            )
                            session.add(new_tracking)
                            stats['tracking_numbers_added'] += 1
                            logger.info(f"  添加国内单号: {domestic_tracking}")
                        else:
                            logger.info(f"  国内单号已存在: {domestic_tracking}")

                    stats['updated'] += 1

                except Exception as e:
                    logger.error(f"  处理 Posting {posting_number} 时出错: {e}")
                    stats['error'] += 1
                    continue

        # 提交或回滚
        if dry_run:
            logger.info("\n试运行模式，回滚所有更改")
            session.rollback()
        else:
            logger.info("\n提交更改到数据库")
            session.commit()

        # 打印统计信息
        logger.info("\n" + "="*60)
        logger.info("导入完成！统计信息：")
        logger.info(f"  总行数: {stats['total']}")
        logger.info(f"  成功更新: {stats['updated']}")
        logger.info(f"  未找到: {stats['not_found']}")
        logger.info(f"  错误: {stats['error']}")
        logger.info(f"  添加采购平台: {stats['platforms_added']}")
        logger.info(f"  添加国内单号: {stats['tracking_numbers_added']}")
        logger.info("="*60)

    except Exception as e:
        logger.error(f"导入过程出错: {e}")
        session.rollback()
        raise
    finally:
        session.close()


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("用法: python import_posting_data.py <csv_path> [--dry-run]")
        print("示例: python import_posting_data.py /mnt/e/pics/2.csv")
        print("试运行: python import_posting_data.py /mnt/e/pics/2.csv --dry-run")
        sys.exit(1)

    csv_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv

    import_posting_data(csv_path, dry_run)
