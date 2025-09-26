"""
选品助手服务层
"""
import re
import logging
import pandas as pd
from typing import Dict, Any, List, Optional, Tuple
from datetime import datetime
from decimal import Decimal
from pathlib import Path
import time

from sqlalchemy import select, and_, or_, func, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from ..models.product_selection import ProductSelectionItem, ImportHistory

logger = logging.getLogger(__name__)


class ProductSelectionService:
    """选品助手服务"""

    # CSV/Excel列名映射
    COLUMN_MAPPING = {
        '商品名称': 'product_name_ru',
        '商品名称（中文）': 'product_name_cn',
        '商品ID': 'product_id',
        '商品链接': 'ozon_link',
        '商品图片': 'image_url',
        '类目链接': 'category_link',
        '品牌': 'brand',
        '销售价格': 'current_price',
        '原价': 'original_price',
        'RFBS <= 1500卢布佣金（%）': 'rfbs_commission_low',
        'RFBS在 1501卢布~5000卢布佣金（%）': 'rfbs_commission_mid',
        'RFBS > 5000卢布佣金（%）': 'rfbs_commission_high',
        'FBP <= 1500卢布佣金（%）': 'fbp_commission_low',
        'FBP在 1501卢布~5000卢布佣金（%）': 'fbp_commission_mid',
        'FBP > 5000卢布佣金（%）': 'fbp_commission_high',
        '30天内的销量(件)': 'monthly_sales_volume',
        '30天内的销售额(卢布)': 'monthly_sales_revenue',
        '平均日销售额(卢布)': 'daily_sales_revenue',
        '平均日销量(件)': 'daily_sales_volume',
        '销售动态(%)': 'sales_dynamic_percent',
        '成交率（%）': 'conversion_rate',
        '包装重量(g)': 'package_weight',
        '商品体积（升）': 'package_volume',
        '包装长(mm)': 'package_length',
        '包装宽(mm)': 'package_width',
        '包装高(mm)': 'package_height',
        '商品评分': 'rating',
        '评价次数': 'review_count',
        '卖家类型': 'seller_type',
        '配送时间（天）': 'delivery_days',
        '商品可用性(%)': 'availability_percent',
        '广告费用份额（%）': 'ad_cost_share',
        '商品创建日期': 'product_created_date',
    }

    @staticmethod
    def clean_price(value: Any) -> Optional[Decimal]:
        """清洗价格数据"""
        if pd.isna(value) or value == '':
            return None

        # 转换为字符串
        value_str = str(value)

        # 移除货币符号、空格、千分符
        value_str = re.sub(r'[¥₽\s,]', '', value_str)

        try:
            # 尝试转换为Decimal
            return Decimal(value_str)
        except:
            logger.warning(f"无法转换价格值: {value}")
            return None

    @staticmethod
    def clean_percentage(value: Any) -> Optional[Decimal]:
        """清洗百分比数据"""
        if pd.isna(value) or value == '':
            return None

        value_str = str(value)
        # 移除百分号和空格
        value_str = re.sub(r'[%\s]', '', value_str)

        try:
            return Decimal(value_str)
        except:
            return None

    @staticmethod
    def clean_integer(value: Any) -> Optional[int]:
        """清洗整数数据"""
        if pd.isna(value) or value == '':
            return None

        try:
            # 先转为float再转int，处理带小数点的字符串
            return int(float(str(value).replace(',', '')))
        except:
            return None

    @staticmethod
    def normalize_brand(brand: str) -> str:
        """标准化品牌名称"""
        if not brand or brand == 'без бренда':
            return 'NO_BRAND'

        # 转换为大写，移除首尾空格
        normalized = brand.upper().strip()
        # 移除多余空格
        normalized = re.sub(r'\s+', ' ', normalized)

        return normalized

    @staticmethod
    def parse_date(value: Any) -> Optional[datetime]:
        """解析日期"""
        if pd.isna(value) or value == '':
            return None

        try:
            if isinstance(value, datetime):
                return value
            # 尝试解析日期字符串
            return pd.to_datetime(value, errors='coerce').to_pydatetime()
        except:
            return None

    async def import_file(
        self,
        db: AsyncSession,
        file_path: Path,
        file_type: str,
        import_strategy: str = 'update',
        user_id: int = 1,
        validate_only: bool = False
    ) -> Dict[str, Any]:
        """导入文件"""
        start_time = time.time()

        # 创建导入历史记录
        import_history = ImportHistory(
            file_name=file_path.name,
            file_type=file_type,
            file_size=file_path.stat().st_size if file_path.exists() else 0,
            imported_by=user_id,
            import_strategy=import_strategy,
            total_rows=0,
            success_rows=0,
            failed_rows=0,
            updated_rows=0,
            skipped_rows=0,
            import_log={},
            error_details=[]
        )

        try:
            # 读取文件
            if file_type == 'csv':
                df = pd.read_csv(file_path, encoding='utf-8-sig')
            else:  # xlsx
                df = pd.read_excel(file_path, engine='openpyxl')

            import_history.total_rows = len(df)

            # 检查必需列
            missing_columns = []
            for csv_col in self.COLUMN_MAPPING.keys():
                if csv_col not in df.columns:
                    # 尝试模糊匹配
                    found = False
                    for col in df.columns:
                        if csv_col.lower() in col.lower():
                            df.rename(columns={col: csv_col}, inplace=True)
                            found = True
                            break
                    if not found and csv_col in ['商品ID', '商品名称']:  # 必需字段
                        missing_columns.append(csv_col)

            if missing_columns:
                error_msg = f"缺少必需列: {', '.join(missing_columns)}"
                import_history.error_details.append(error_msg)
                if not validate_only:
                    db.add(import_history)
                    await db.commit()
                return {
                    'success': False,
                    'error': error_msg,
                    'missing_columns': missing_columns
                }

            # 如果只是验证，返回预览数据
            if validate_only:
                preview_data = []
                for idx, row in df.head(5).iterrows():
                    cleaned_row = self._clean_row(row)
                    preview_data.append(cleaned_row)

                return {
                    'success': True,
                    'total_rows': len(df),
                    'columns': list(df.columns),
                    'preview': preview_data,
                    'column_mapping': self.COLUMN_MAPPING
                }

            # 批量处理数据
            batch_size = 100
            success_count = 0
            failed_count = 0
            updated_count = 0
            skipped_count = 0
            error_details = []

            for i in range(0, len(df), batch_size):
                batch = df.iloc[i:i+batch_size]
                batch_items = []

                for idx, row in batch.iterrows():
                    try:
                        cleaned_data = self._clean_row(row)
                        if cleaned_data:
                            batch_items.append(cleaned_data)
                    except Exception as e:
                        failed_count += 1
                        error_details.append({
                            'row': idx + 2,  # Excel行号从1开始，加上表头
                            'error': str(e)
                        })

                if batch_items:
                    # 执行批量插入/更新
                    result = await self._batch_upsert(
                        db, batch_items, import_strategy
                    )
                    success_count += result['success']
                    updated_count += result['updated']
                    skipped_count += result['skipped']

            # 更新导入历史
            import_history.success_rows = success_count
            import_history.failed_rows = failed_count
            import_history.updated_rows = updated_count
            import_history.skipped_rows = skipped_count
            import_history.error_details = error_details[:100]  # 只保留前100个错误
            import_history.process_duration = int(time.time() - start_time)

            db.add(import_history)
            await db.commit()

            return {
                'success': True,
                'import_id': import_history.id,
                'total_rows': import_history.total_rows,
                'success_rows': success_count,
                'failed_rows': failed_count,
                'updated_rows': updated_count,
                'skipped_rows': skipped_count,
                'duration': import_history.process_duration,
                'errors': error_details[:10]  # 返回前10个错误供显示
            }

        except Exception as e:
            logger.error(f"文件导入失败: {e}")
            import_history.error_details = [{'error': str(e)}]
            import_history.process_duration = int(time.time() - start_time)

            if not validate_only:
                db.add(import_history)
                await db.commit()

            return {
                'success': False,
                'error': str(e)
            }

    def _clean_row(self, row: pd.Series) -> Dict[str, Any]:
        """清洗单行数据"""
        cleaned = {}

        for csv_col, db_col in self.COLUMN_MAPPING.items():
            if csv_col not in row.index:
                continue

            value = row[csv_col]

            # 根据字段类型进行清洗
            if db_col == 'product_id':
                # 商品ID必需且唯一
                if pd.isna(value):
                    raise ValueError(f"商品ID不能为空")
                cleaned[db_col] = str(value).strip()

            elif db_col == 'brand':
                brand = str(value) if not pd.isna(value) else 'без бренда'
                cleaned[db_col] = brand
                cleaned['brand_normalized'] = self.normalize_brand(brand)

            elif 'price' in db_col or 'revenue' in db_col:
                cleaned[db_col] = self.clean_price(value)

            elif 'commission' in db_col or 'percent' in db_col or 'rate' in db_col:
                cleaned[db_col] = self.clean_percentage(value)

            elif 'volume' in db_col or 'count' in db_col or 'weight' in db_col or \
                 'length' in db_col or 'width' in db_col or 'height' in db_col or 'days' in db_col:
                cleaned[db_col] = self.clean_integer(value)

            elif db_col == 'rating':
                cleaned[db_col] = self.clean_percentage(value)

            elif db_col == 'product_created_date':
                cleaned[db_col] = self.parse_date(value)

            else:
                # 文本字段
                if not pd.isna(value):
                    cleaned[db_col] = str(value).strip()

        return cleaned

    async def _batch_upsert(
        self,
        db: AsyncSession,
        items: List[Dict[str, Any]],
        strategy: str
    ) -> Dict[str, int]:
        """批量插入或更新"""
        success = 0
        updated = 0
        skipped = 0

        for item in items:
            try:
                product_id = item['product_id']

                # 检查是否存在
                existing = await db.execute(
                    select(ProductSelectionItem).where(
                        ProductSelectionItem.product_id == product_id
                    )
                )
                existing_item = existing.scalar_one_or_none()

                if existing_item:
                    if strategy == 'skip':
                        skipped += 1
                        continue
                    elif strategy == 'update':
                        # 更新现有记录
                        for key, value in item.items():
                            setattr(existing_item, key, value)
                        existing_item.updated_at = datetime.now()
                        updated += 1
                    else:  # append
                        # append策略下跳过已存在的记录（因为product_id是唯一的）
                        skipped += 1
                        continue
                else:
                    # 创建新记录
                    new_item = ProductSelectionItem(**item)
                    db.add(new_item)
                    success += 1

                # 每处理一条就flush，避免批量失败
                await db.flush()

            except Exception as e:
                # 如果出错，回滚当前事务并继续处理下一条
                await db.rollback()
                logger.warning(f"Failed to process product {item.get('product_id')}: {e}")
                skipped += 1
                continue

        return {
            'success': success,
            'updated': updated,
            'skipped': skipped
        }

    async def search_products(
        self,
        db: AsyncSession,
        filters: Dict[str, Any],
        sort_by: str = 'sales_desc',
        page: int = 1,
        page_size: int = 20
    ) -> Dict[str, Any]:
        """搜索商品"""
        query = select(ProductSelectionItem)

        # 应用筛选条件
        conditions = []

        if filters.get('brand'):
            conditions.append(
                ProductSelectionItem.brand_normalized == self.normalize_brand(filters['brand'])
            )

        if filters.get('rfbs_low_max'):
            conditions.append(
                ProductSelectionItem.rfbs_commission_low <= Decimal(str(filters['rfbs_low_max']))
            )

        if filters.get('rfbs_mid_max'):
            conditions.append(
                ProductSelectionItem.rfbs_commission_mid <= Decimal(str(filters['rfbs_mid_max']))
            )

        if filters.get('fbp_low_max'):
            conditions.append(
                ProductSelectionItem.fbp_commission_low <= Decimal(str(filters['fbp_low_max']))
            )

        if filters.get('fbp_mid_max'):
            conditions.append(
                ProductSelectionItem.fbp_commission_mid <= Decimal(str(filters['fbp_mid_max']))
            )

        if filters.get('monthly_sales_min'):
            conditions.append(
                ProductSelectionItem.monthly_sales_volume >= filters['monthly_sales_min']
            )

        if filters.get('monthly_sales_max'):
            conditions.append(
                ProductSelectionItem.monthly_sales_volume <= filters['monthly_sales_max']
            )

        if filters.get('weight_max'):
            conditions.append(
                ProductSelectionItem.package_weight <= filters['weight_max']
            )

        if conditions:
            query = query.where(and_(*conditions))

        # 获取总数
        count_query = select(func.count()).select_from(ProductSelectionItem)
        if conditions:
            count_query = count_query.where(and_(*conditions))
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # 应用排序
        if sort_by == 'sales_desc':
            query = query.order_by(ProductSelectionItem.monthly_sales_volume.desc().nullslast())
        elif sort_by == 'sales_asc':
            query = query.order_by(ProductSelectionItem.monthly_sales_volume.asc().nullsfirst())
        elif sort_by == 'weight_asc':
            query = query.order_by(ProductSelectionItem.package_weight.asc().nullsfirst())
        elif sort_by == 'price_asc':
            query = query.order_by(ProductSelectionItem.current_price.asc().nullsfirst())
        elif sort_by == 'price_desc':
            query = query.order_by(ProductSelectionItem.current_price.desc().nullslast())
        else:
            query = query.order_by(ProductSelectionItem.created_at.desc())

        # 分页
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        # 执行查询
        result = await db.execute(query)
        items = result.scalars().all()

        return {
            'items': [item.to_dict() for item in items],
            'total': total,
            'page': page,
            'page_size': page_size,
            'total_pages': (total + page_size - 1) // page_size if total > 0 else 0
        }

    async def get_brands(self, db: AsyncSession) -> List[str]:
        """获取所有品牌列表"""
        query = select(ProductSelectionItem.brand).distinct().where(
            ProductSelectionItem.brand.isnot(None)
        ).order_by(ProductSelectionItem.brand)

        result = await db.execute(query)
        brands = [row[0] for row in result if row[0] and row[0] != 'без бренда']

        return brands

    async def get_import_history(
        self,
        db: AsyncSession,
        page: int = 1,
        page_size: int = 10
    ) -> Dict[str, Any]:
        """获取导入历史"""
        query = select(ImportHistory).order_by(ImportHistory.import_time.desc())

        # 获取总数
        count_query = select(func.count()).select_from(ImportHistory)
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # 分页
        offset = (page - 1) * page_size
        query = query.offset(offset).limit(page_size)

        result = await db.execute(query)
        items = result.scalars().all()

        return {
            'items': [item.to_dict() for item in items],
            'total': total,
            'page': page,
            'page_size': page_size
        }