#!/usr/bin/env python3
"""
导入类目佣金CSV数据脚本
"""
import asyncio
import csv
import sys
from pathlib import Path
from decimal import Decimal

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import select

from ef_core.config import get_settings
from plugins.ef.channels.ozon.models.category_commissions import OzonCategoryCommission


async def import_csv_data(csv_file_path: str):
    """导入CSV数据到数据库"""

    # 创建数据库引擎
    settings = get_settings()
    engine = create_async_engine(settings.database_url, echo=False)
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    imported_count = 0
    updated_count = 0
    skipped_count = 0
    errors = []

    async with async_session() as session:
        try:
            # 读取CSV文件
            with open(csv_file_path, 'r', encoding='utf-8-sig') as f:
                csv_reader = csv.reader(f)

                # 跳过表头
                next(csv_reader, None)

                # 用于记住上一个非空的类目模块
                last_module = None

                for row_num, row in enumerate(csv_reader, start=2):
                    try:
                        if len(row) < 8:
                            errors.append(f"第{row_num}行：列数不足（需要8列）")
                            skipped_count += 1
                            continue

                        # 解析数据
                        category_module = row[0].strip()
                        category_name = row[1].strip()

                        # 如果类目模块为空，使用上一个
                        if not category_module:
                            if last_module:
                                category_module = last_module
                            else:
                                errors.append(f"第{row_num}行：类目模块为空且无法继承")
                                skipped_count += 1
                                continue
                        else:
                            last_module = category_module

                        if not category_name:
                            errors.append(f"第{row_num}行：类目模块或类目名称为空")
                            skipped_count += 1
                            continue

                        # 解析佣金比例（去除%符号）
                        def parse_percentage(value: str) -> Decimal:
                            value = value.strip().replace('%', '').replace(',', '.')
                            return Decimal(value)

                        rfbs_tier1 = parse_percentage(row[2])
                        fbp_tier1 = parse_percentage(row[3])
                        rfbs_tier2 = parse_percentage(row[4])
                        fbp_tier2 = parse_percentage(row[5])
                        rfbs_tier3 = parse_percentage(row[6])
                        fbp_tier3 = parse_percentage(row[7])

                        # 检查是否已存在相同的记录
                        result = await session.execute(
                            select(OzonCategoryCommission).where(
                                OzonCategoryCommission.category_module == category_module,
                                OzonCategoryCommission.category_name == category_name
                            )
                        )
                        existing_record = result.scalar_one_or_none()

                        if existing_record:
                            # 更新现有记录
                            existing_record.rfbs_tier1 = rfbs_tier1
                            existing_record.rfbs_tier2 = rfbs_tier2
                            existing_record.rfbs_tier3 = rfbs_tier3
                            existing_record.fbp_tier1 = fbp_tier1
                            existing_record.fbp_tier2 = fbp_tier2
                            existing_record.fbp_tier3 = fbp_tier3
                            updated_count += 1
                        else:
                            # 创建新记录
                            new_commission = OzonCategoryCommission(
                                category_module=category_module,
                                category_name=category_name,
                                rfbs_tier1=rfbs_tier1,
                                rfbs_tier2=rfbs_tier2,
                                rfbs_tier3=rfbs_tier3,
                                fbp_tier1=fbp_tier1,
                                fbp_tier2=fbp_tier2,
                                fbp_tier3=fbp_tier3,
                            )
                            session.add(new_commission)
                            imported_count += 1

                        print(f"✓ 处理: {category_module} / {category_name}")

                    except Exception as e:
                        error_msg = f"第{row_num}行：{str(e)}"
                        errors.append(error_msg)
                        print(f"✗ {error_msg}")
                        skipped_count += 1

            # 提交事务
            await session.commit()

            print(f"\n" + "="*50)
            print(f"导入完成!")
            print(f"新增: {imported_count} 条")
            print(f"更新: {updated_count} 条")
            print(f"跳过: {skipped_count} 条")
            if errors:
                print(f"错误: {len(errors)} 条")
                for error in errors[:5]:  # 只显示前5个错误
                    print(f"  - {error}")
            print("="*50)

        except Exception as e:
            await session.rollback()
            print(f"导入失败: {e}")
            raise

    await engine.dispose()


if __name__ == "__main__":
    csv_file = "/mnt/e/pics/佣金.csv"

    if not Path(csv_file).exists():
        print(f"错误: CSV文件不存在: {csv_file}")
        sys.exit(1)

    print(f"开始导入 {csv_file}...")
    asyncio.run(import_csv_data(csv_file))
