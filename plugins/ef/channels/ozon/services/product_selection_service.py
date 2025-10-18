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
        # 基础字段
        '商品名称': 'product_name_ru',
        '商品名称（中文）': 'product_name_cn',
        '商品ID': 'product_id',
        '商品链接': 'ozon_link',
        '商品图片': 'image_url',
        '类目链接': 'category_link',
        '品牌': 'brand',
        '销售价格': 'current_price',
        '原价': 'original_price',

        # RFBS佣金字段 - 支持多种格式
        'RFBS <= 1500卢布佣金（%）': 'rfbs_commission_low',
        'RFBS <= 1500佣金（%）': 'rfbs_commission_low',  # 新增：不带卢布单位
        'RFBS≤1500': 'rfbs_commission_low',  # 新增：简化格式
        'RFBS在 1501卢布~5000卢布佣金（%）': 'rfbs_commission_mid',
        'RFBS在 1501~5000佣金（%）': 'rfbs_commission_mid',  # 新增：不带卢布单位
        'RFBS 1501-5000': 'rfbs_commission_mid',  # 新增：连字符格式
        'RFBS > 5000卢布佣金（%）': 'rfbs_commission_high',
        'RFBS > 5000佣金（%）': 'rfbs_commission_high',  # 新增：不带卢布单位

        # FBP佣金字段 - 支持多种格式
        'FBP <= 1500卢布佣金（%）': 'fbp_commission_low',
        'FBP <= 1500佣金（%）': 'fbp_commission_low',  # 新增：不带卢布单位
        'FBP≤1500': 'fbp_commission_low',  # 新增：简化格式
        'FBP在 1501卢布~5000卢布佣金（%）': 'fbp_commission_mid',
        'FBP在 1501~5000佣金（%）': 'fbp_commission_mid',  # 新增：不带卢布单位
        'FBP 1501-5000': 'fbp_commission_mid',  # 新增：连字符格式
        'FBP > 5000卢布佣金（%）': 'fbp_commission_high',
        'FBP > 5000佣金（%）': 'fbp_commission_high',  # 新增：不带卢布单位

        # 销量和销售额字段 - 支持多种格式
        '30天内的销量(件)': 'monthly_sales_volume',
        '30天内的销量（件）': 'monthly_sales_volume',  # 新增：中文括号
        '月销量': 'monthly_sales_volume',  # 新增：简化格式
        '30天内的销售额(卢布)': 'monthly_sales_revenue',
        '30天内的销售额': 'monthly_sales_revenue',  # 新增：不带单位
        '月销售额': 'monthly_sales_revenue',  # 新增：简化格式
        '平均日销售额(卢布)': 'daily_sales_revenue',
        '平均日销售额': 'daily_sales_revenue',  # 新增：不带单位
        '平均日销量(件)': 'daily_sales_volume',
        '平均日销量（件）': 'daily_sales_volume',  # 新增：中文括号

        # 其他业务字段
        '销售动态(%)': 'sales_dynamic_percent',
        '销售动态（%）': 'sales_dynamic_percent',  # 新增：中文括号
        '成交率（%）': 'conversion_rate',
        '成交率(%)': 'conversion_rate',  # 新增：英文括号

        # 包装信息字段
        '包装重量(g)': 'package_weight',
        '包装重量（g）': 'package_weight',  # 新增：中文括号
        '重量': 'package_weight',  # 新增：简化格式
        '商品体积（升）': 'package_volume',
        '商品体积(升)': 'package_volume',  # 新增：英文括号
        '体积': 'package_volume',  # 新增：简化格式
        '包装长(mm)': 'package_length',
        '包装长（mm）': 'package_length',  # 新增：中文括号
        '包装宽(mm)': 'package_width',
        '包装宽（mm）': 'package_width',  # 新增：中文括号
        '包装高(mm)': 'package_height',
        '包装高（mm）': 'package_height',  # 新增：中文括号

        # 评价和服务字段
        '商品评分': 'rating',
        '评分': 'rating',  # 新增：简化格式
        '评价次数': 'review_count',
        '评价数': 'review_count',  # 新增：变体格式
        '卖家类型': 'seller_type',
        '配送时间（天）': 'delivery_days',
        '配送时间(天)': 'delivery_days',  # 新增：英文括号
        '商品可用性(%)': 'availability_percent',
        '商品可用性（%）': 'availability_percent',  # 新增：中文括号
        '广告费用份额（%）': 'ad_cost_share',
        '广告费用份额(%)': 'ad_cost_share',  # 新增：英文括号

        # 时间和竞争字段
        '商品创建日期': 'product_created_date',
        '创建日期': 'product_created_date',  # 新增：简化格式
        '跟卖者数量': 'competitor_count',
        '竞争者数量': 'competitor_count',  # 新增：同义词
        '最低跟卖价': 'competitor_min_price',
        '最低竞争价': 'competitor_min_price',  # 新增：同义词
    }

    @staticmethod
    def clean_price(value: Any) -> Optional[Decimal]:
        """清洗价格数据"""
        if pd.isna(value) or value == '' or value == '-':
            return None

        # 转换为字符串
        value_str = str(value).strip()

        # 处理特殊值
        if value_str in ['-', 'nan', 'NaN', 'null', 'NULL']:
            return None

        # 移除货币符号、空格、千分符（保留原始货币单位，不做转换）
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
        if pd.isna(value) or value == '' or value == '-':
            return None

        value_str = str(value).strip()

        # 处理特殊值
        if value_str in ['-', 'nan', 'NaN', 'null', 'NULL']:
            return None

        # 移除百分号和空格
        value_str = re.sub(r'[%\s]', '', value_str)

        try:
            return Decimal(value_str)
        except:
            logger.warning(f"无法转换百分比值: {value}")
            return None

    @staticmethod
    def clean_integer(value: Any) -> Optional[int]:
        """清洗整数数据"""
        if pd.isna(value) or value == '' or value == '-':
            return None

        value_str = str(value).strip()

        # 处理特殊值
        if value_str in ['-', 'nan', 'NaN', 'null', 'NULL']:
            return None

        try:
            # 先转为float再转int，处理带小数点的字符串
            return int(float(value_str.replace(',', '')))
        except:
            logger.warning(f"无法转换整数值: {value}")
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
        if pd.isna(value) or value == '' or value == '-':
            return None

        value_str = str(value).strip()

        # 处理特殊值
        if value_str in ['-', 'nan', 'NaN', 'null', 'NULL', 'NaT']:
            return None

        try:
            if isinstance(value, datetime):
                return value
            # 尝试解析日期字符串
            parsed = pd.to_datetime(value, errors='coerce')
            # 检查是否为NaT（Not a Time）
            if pd.isna(parsed):
                return None
            return parsed.to_pydatetime()
        except:
            logger.warning(f"无法转换日期值: {value}")
            return None

    def _find_best_column_match(self, target_col: str, available_cols: List[str]) -> Optional[str]:
        """智能模糊匹配列名"""
        import re
        from difflib import SequenceMatcher

        def normalize_text(text: str) -> str:
            """标准化文本，移除特殊符号和空格"""
            # 移除括号、空格、特殊符号
            text = re.sub(r'[（）()【】\[\]{}]', '', text)
            text = re.sub(r'[~\-_\s]', '', text)
            text = re.sub(r'[%％]', '百分比', text)
            text = re.sub(r'[卢布元]', '货币', text)
            return text.lower()

        def extract_keywords(text: str) -> set:
            """提取关键词"""
            keywords = set()
            # 基础关键词
            if 'rfbs' in text.lower():
                keywords.add('rfbs')
            if 'fbp' in text.lower():
                keywords.add('fbp')
            if '佣金' in text:
                keywords.add('佣金')
            if '1500' in text:
                keywords.add('1500')
            if '5000' in text:
                keywords.add('5000')
            if '销量' in text:
                keywords.add('销量')
            if '销售额' in text:
                keywords.add('销售额')
            if '30天' in text:
                keywords.add('30天')
            if '月' in text:
                keywords.add('月')
            if '重量' in text:
                keywords.add('重量')
            if '包装' in text:
                keywords.add('包装')
            if '品牌' in text:
                keywords.add('品牌')
            if '价格' in text:
                keywords.add('价格')
            if '商品' in text:
                keywords.add('商品')
            return keywords

        # 标准化目标列名
        target_normalized = normalize_text(target_col)
        target_keywords = extract_keywords(target_col)

        best_match = None
        best_score = 0.0

        for col in available_cols:
            col_normalized = normalize_text(col)
            col_keywords = extract_keywords(col)

            # 1. 完全匹配检查
            if target_normalized == col_normalized:
                return col

            # 2. 包含关系检查
            if target_normalized in col_normalized or col_normalized in target_normalized:
                # 计算包含度分数
                shorter = min(len(target_normalized), len(col_normalized))
                longer = max(len(target_normalized), len(col_normalized))
                contain_score = 0.8 + 0.2 * (shorter / longer)

                if contain_score > best_score:
                    best_score = contain_score
                    best_match = col

            # 3. 关键词匹配检查
            if target_keywords and col_keywords:
                common_keywords = target_keywords.intersection(col_keywords)
                if common_keywords:
                    keyword_score = len(common_keywords) / max(len(target_keywords), len(col_keywords))
                    # 如果关键词匹配度高，给予较高分数
                    if keyword_score >= 0.5:
                        keyword_bonus = 0.6 + 0.3 * keyword_score
                        if keyword_bonus > best_score:
                            best_score = keyword_bonus
                            best_match = col

            # 4. 字符串相似度检查（降级选项）
            similarity = SequenceMatcher(None, target_normalized, col_normalized).ratio()
            if similarity > 0.6 and similarity > best_score:
                best_score = similarity
                best_match = col

        # 只有当匹配分数足够高时才返回
        if best_score >= 0.5:
            logger.info(f"列名模糊匹配: '{target_col}' -> '{best_match}' (分数: {best_score:.2f})")
            return best_match

        return None

    def _format_error_message(self, error: Exception) -> str:
        """格式化错误信息为用户友好的提示"""
        error_str = str(error)

        # 常见错误类型映射
        error_mappings = {
            'product_id': '商品ID',
            'product_name': '商品名称',
            'brand': '品牌',
            'current_price': '销售价格',
            'original_price': '原价',
            'package_weight': '包装重量',
            'rfbs_commission': 'RFBS佣金',
            'fbp_commission': 'FBP佣金',
            'monthly_sales': '月销量',
            'constraint': '数据约束',
            'duplicate': '重复数据',
            'foreign key': '关联数据'
        }

        # 检查是否是数据库相关错误
        if 'IntegrityError' in error_str or 'constraint' in error_str.lower():
            if 'duplicate' in error_str.lower() or 'unique' in error_str.lower():
                return "数据重复：该商品ID已存在，请检查是否有重复行"
            elif 'foreign key' in error_str.lower():
                return "关联数据错误：请检查相关字段的有效性"
            else:
                return "数据约束错误：请检查数据格式和必填字段"

        # 检查是否是数据类型错误
        if 'ValueError' in error_str or 'TypeError' in error_str:
            for field, desc in error_mappings.items():
                if field in error_str.lower():
                    return f"{desc}格式错误：请检查该字段的数据类型和格式"
            return "数据格式错误：请检查数据类型是否正确"

        # 检查是否是必填字段错误
        if '不能为空' in error_str or 'required' in error_str.lower():
            return "必填字段缺失：请确保商品ID和商品名称不为空"

        # 检查是否是数值范围错误
        if '超出范围' in error_str or 'out of range' in error_str.lower():
            return "数值超出范围：请检查价格、重量、佣金等数值字段"

        # 默认返回简化的错误信息
        if len(error_str) > 100:
            return f"数据处理错误：{error_str[:100]}..."
        else:
            return f"数据处理错误：{error_str}"

    def _format_import_error(self, error: Exception, file_path: Path) -> str:
        """格式化导入错误信息为用户友好的提示"""
        error_str = str(error)
        error_type = type(error).__name__

        # 文件相关错误
        if 'PermissionError' in error_type:
            return f"文件访问权限错误：无法读取文件 {file_path.name}，请检查文件是否被其他程序占用"

        if 'FileNotFoundError' in error_type:
            return f"文件不存在：找不到文件 {file_path.name}，请确认文件路径正确"

        if 'UnicodeDecodeError' in error_type or 'encoding' in error_str.lower():
            return f"文件编码错误：无法解析文件 {file_path.name}，请确保文件使用UTF-8编码保存"

        # Excel/CSV 格式错误
        if 'BadZipFile' in error_str or 'xlrd' in error_str or 'openpyxl' in error_str:
            return f"Excel文件格式错误：文件 {file_path.name} 可能已损坏或格式不正确，请重新保存后再试"

        if 'ParserError' in error_type or 'csv' in error_str.lower():
            return f"CSV文件解析错误：文件 {file_path.name} 格式不正确，请检查分隔符和引号是否正确"

        # 内存相关错误
        if 'MemoryError' in error_type or 'memory' in error_str.lower():
            return f"内存不足：文件 {file_path.name} 过大，请尝试分批导入较小的文件"

        # 数据库连接错误
        if 'connection' in error_str.lower() or 'database' in error_str.lower():
            return "数据库连接错误：请稍后重试，或联系系统管理员"

        # 网络相关错误
        if 'timeout' in error_str.lower() or 'connection' in error_str.lower():
            return "网络超时：请检查网络连接后重试"

        # 默认错误信息
        if len(error_str) > 150:
            return f"文件导入错误：{error_str[:150]}... (请联系技术支持)"
        else:
            return f"文件导入错误：{error_str}"

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

            # 检查必需列并应用智能列名匹配
            missing_columns = []
            column_mapping_applied = {}

            for csv_col in self.COLUMN_MAPPING.keys():
                if csv_col not in df.columns:
                    # 尝试智能模糊匹配
                    matched_col = self._find_best_column_match(csv_col, df.columns.tolist())
                    if matched_col:
                        df.rename(columns={matched_col: csv_col}, inplace=True)
                        column_mapping_applied[matched_col] = csv_col
                        logger.info(f"列名映射: '{matched_col}' -> '{csv_col}'")
                    elif csv_col in ['商品ID', '商品名称']:  # 必需字段
                        missing_columns.append(csv_col)

            if missing_columns:
                # 生成友好的错误信息
                column_suggestions = []
                for missing_col in missing_columns:
                    # 尝试找到最相似的列名
                    suggestion = self._find_best_column_match(missing_col, df.columns.tolist())
                    if suggestion:
                        column_suggestions.append(f"'{missing_col}' (建议: '{suggestion}')")
                    else:
                        column_suggestions.append(f"'{missing_col}'")

                error_msg = f"缺少必需列: {', '.join(column_suggestions)}"
                detailed_msg = (
                    f"文件缺少以下必需列：{', '.join(missing_columns)}。"
                    f"请检查CSV/Excel文件的列标题是否正确。"
                    f"当前文件包含的列：{', '.join(df.columns.tolist()[:10])}..."
                    if len(df.columns) > 10 else f"当前文件包含的列：{', '.join(df.columns.tolist())}"
                )

                import_history.error_details.append(detailed_msg)
                if not validate_only:
                    db.add(import_history)
                    await db.commit()
                return {
                    'success': False,
                    'error': detailed_msg,
                    'missing_columns': missing_columns,
                    'available_columns': df.columns.tolist(),
                    'suggestions': column_suggestions
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

            # 先保存导入历史记录以获取batch_id
            db.add(import_history)
            await db.flush()  # 获取import_history.id但不提交事务
            batch_id = import_history.id

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
                        if cleaned_data and cleaned_data.get('product_id'):
                            # 添加user_id和batch_id到每个清洗后的数据项
                            cleaned_data['user_id'] = user_id
                            cleaned_data['batch_id'] = batch_id
                            batch_items.append(cleaned_data)
                        else:
                            failed_count += 1
                            error_details.append({
                                'row': idx + 2,  # Excel行号从1开始，加上表头
                                'error': '缺少必需字段(商品ID)或数据清洗失败',
                                'product_id': row.get('商品ID', '未知'),
                                'product_name': row.get('商品名称', '未知')
                            })
                    except Exception as e:
                        failed_count += 1
                        # 提供更友好的错误信息
                        error_msg = self._format_error_message(e)
                        error_details.append({
                            'row': idx + 2,  # Excel行号从1开始，加上表头
                            'error': error_msg,
                            'product_id': row.get('商品ID', '未知'),
                            'product_name': row.get('商品名称', '未知')
                        })

                if batch_items:
                    # 执行批量插入/更新
                    result = await self._batch_upsert(
                        db, batch_items, import_strategy, user_id
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

            # import_history已在前面添加，这里只需提交
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
            logger.error(f"文件导入失败: {e}", exc_info=True)
            # 生成友好的错误信息
            user_friendly_error = self._format_import_error(e, file_path)
            import_history.error_details = [{'error': user_friendly_error}]
            import_history.process_duration = int(time.time() - start_time)

            if not validate_only:
                try:
                    db.add(import_history)
                    await db.commit()
                except Exception as db_error:
                    logger.error(f"保存导入历史失败: {db_error}")
                    await db.rollback()

            return {
                'success': False,
                'error': user_friendly_error
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
                # 处理品牌字段，空值和"-"都设为默认值
                if pd.isna(value) or str(value).strip() in ['', '-', 'nan', 'NaN']:
                    brand = 'без бренда'
                else:
                    brand = str(value).strip()
                cleaned[db_col] = brand
                cleaned['brand_normalized'] = self.normalize_brand(brand)

            elif 'price' in db_col or 'revenue' in db_col:
                cleaned[db_col] = self.clean_price(value)

            elif 'commission' in db_col or 'percent' in db_col or 'rate' in db_col:
                cleaned[db_col] = self.clean_percentage(value)

            elif db_col == 'competitor_count':
                # 跟卖者数量处理
                cleaned[db_col] = self.clean_integer(value)

            elif db_col == 'competitor_min_price':
                # 最低跟卖价处理
                cleaned[db_col] = self.clean_price(value)

            elif 'volume' in db_col or 'count' in db_col or 'weight' in db_col or \
                 'length' in db_col or 'width' in db_col or 'height' in db_col or 'days' in db_col:
                cleaned[db_col] = self.clean_integer(value)

            elif db_col == 'rating':
                cleaned[db_col] = self.clean_percentage(value)

            elif db_col == 'product_created_date':
                cleaned[db_col] = self.parse_date(value)

            else:
                # 文本字段 - 处理"-"值
                if not pd.isna(value) and str(value).strip() not in ['-', '', 'nan', 'NaN']:
                    cleaned[db_col] = str(value).strip()
                else:
                    # 对于文本字段，"-"值设为None而不是空字符串
                    cleaned[db_col] = None

        return cleaned

    async def _batch_upsert(
        self,
        db: AsyncSession,
        items: List[Dict[str, Any]],
        strategy: str,
        user_id: int
    ) -> Dict[str, int]:
        """批量插入或更新

        使用"商品名称+商品ID"作为唯一标识：
        - 如果存在相同的商品ID和商品名称，则更新
        - 如果不存在，则追加新记录
        """
        success = 0
        updated = 0
        skipped = 0

        for item in items:
            # 使用保存点来处理单个项的失败
            savepoint = await db.begin_nested()
            try:
                product_id = item['product_id']
                product_name_ru = item.get('product_name_ru', '')
                product_name_cn = item.get('product_name_cn', '')

                # 为item添加user_id
                if 'user_id' not in item:
                    item['user_id'] = user_id

                # 使用用户ID+商品ID+商品名称作为唯一标识
                conditions = [
                    ProductSelectionItem.user_id == item['user_id'],
                    ProductSelectionItem.product_id == product_id
                ]

                if product_name_ru:
                    conditions.append(ProductSelectionItem.product_name_ru == product_name_ru)
                elif product_name_cn:
                    conditions.append(ProductSelectionItem.product_name_cn == product_name_cn)

                # 查询是否存在
                existing = await db.execute(
                    select(ProductSelectionItem).where(
                        and_(*conditions)
                    )
                )
                existing_item = existing.scalar_one_or_none()

                if existing_item:
                    # 存在则更新（默认策略）
                    for key, value in item.items():
                        setattr(existing_item, key, value)
                    existing_item.updated_at = datetime.now()
                    updated += 1
                else:
                    # 不存在则追加
                    new_item = ProductSelectionItem(**item)
                    db.add(new_item)
                    success += 1

                # 提交保存点
                await savepoint.commit()

            except Exception as e:
                # 只回滚当前保存点，不影响之前的数据
                await savepoint.rollback()
                product_id = item.get('product_id', '未知')
                product_name = item.get('product_name_ru', item.get('product_name_cn', '未知'))
                logger.warning(f"Failed to process product {product_id} ({product_name}): {e}")
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
        user_id: int,
        filters: Dict[str, Any],
        sort_by: str = 'sales_desc',
        page: int = 1,
        page_size: int = 20
    ) -> Dict[str, Any]:
        """搜索商品"""
        query = select(ProductSelectionItem)

        # 应用筛选条件
        conditions = [ProductSelectionItem.user_id == user_id]

        if filters.get('product_name'):
            # 商品名称搜索 - 同时搜索中文和俄文名称
            search_term = f"%{filters['product_name']}%"
            conditions.append(
                or_(
                    ProductSelectionItem.product_name_ru.ilike(search_term),
                    ProductSelectionItem.product_name_cn.ilike(search_term)
                )
            )

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

        if filters.get('competitor_count_min'):
            conditions.append(
                ProductSelectionItem.competitor_count >= filters['competitor_count_min']
            )

        if filters.get('competitor_count_max'):
            conditions.append(
                ProductSelectionItem.competitor_count <= filters['competitor_count_max']
            )

        if filters.get('competitor_min_price_min'):
            conditions.append(
                ProductSelectionItem.competitor_min_price >= Decimal(str(filters['competitor_min_price_min']))
            )

        if filters.get('competitor_min_price_max'):
            conditions.append(
                ProductSelectionItem.competitor_min_price <= Decimal(str(filters['competitor_min_price_max']))
            )

        # 批次过滤
        if filters.get('batch_id') is not None:
            conditions.append(
                ProductSelectionItem.batch_id == filters['batch_id']
            )

        # 已读状态过滤
        if filters.get('is_read') is not None:
            conditions.append(
                ProductSelectionItem.is_read == filters['is_read']
            )

        if conditions:
            query = query.where(and_(*conditions))

        # 获取总数
        count_query = select(func.count()).select_from(ProductSelectionItem)
        count_query = count_query.where(and_(*conditions))
        total_result = await db.execute(count_query)
        total = total_result.scalar()

        # 应用排序 - 默认按导入时间从新到旧
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
        elif sort_by == 'created_desc' or sort_by == '':
            query = query.order_by(ProductSelectionItem.created_at.desc())
        elif sort_by == 'created_asc':
            query = query.order_by(ProductSelectionItem.created_at.asc())
        else:
            # 默认按导入时间从新到旧排序
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

    async def get_brands(self, db: AsyncSession, user_id: int) -> List[str]:
        """获取指定用户的品牌列表"""
        query = select(ProductSelectionItem.brand).distinct().where(
            and_(
                ProductSelectionItem.user_id == user_id,
                ProductSelectionItem.brand.isnot(None)
            )
        ).order_by(ProductSelectionItem.brand)

        result = await db.execute(query)
        brands = [row[0] for row in result if row[0] and row[0] != 'без бренда']

        return brands

    async def get_import_history(
        self,
        db: AsyncSession,
        user_id: int,
        page: int = 1,
        page_size: int = 10
    ) -> Dict[str, Any]:
        """获取指定用户的导入历史"""
        query = select(ImportHistory).where(
            ImportHistory.imported_by == user_id
        ).order_by(ImportHistory.import_time.desc())

        # 获取总数
        count_query = select(func.count()).select_from(ImportHistory).where(
            ImportHistory.imported_by == user_id
        )
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

    async def clear_user_data(self, db: AsyncSession, user_id: int) -> Dict[str, Any]:
        """清空指定用户的所有选品数据"""
        try:
            # 统计要删除的数据
            count_result = await db.execute(
                select(func.count()).select_from(ProductSelectionItem).where(
                    ProductSelectionItem.user_id == user_id
                )
            )
            product_count = count_result.scalar()

            history_count_result = await db.execute(
                select(func.count()).select_from(ImportHistory).where(
                    ImportHistory.imported_by == user_id
                )
            )
            history_count = history_count_result.scalar()

            # 删除用户的选品数据
            await db.execute(
                ProductSelectionItem.__table__.delete().where(
                    ProductSelectionItem.user_id == user_id
                )
            )

            # 删除用户的导入历史
            await db.execute(
                ImportHistory.__table__.delete().where(
                    ImportHistory.imported_by == user_id
                )
            )

            await db.commit()

            logger.info(f"成功清空用户 {user_id} 的数据：{product_count} 个商品，{history_count} 条导入历史")

            return {
                'success': True,
                'deleted_products': product_count,
                'deleted_history': history_count,
                'message': f'成功清空 {product_count} 个商品和 {history_count} 条导入历史'
            }

        except Exception as e:
            await db.rollback()
            logger.error(f"清空用户 {user_id} 数据失败: {e}")
            return {
                'success': False,
                'error': str(e)
            }