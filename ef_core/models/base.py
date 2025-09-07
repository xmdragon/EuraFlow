"""
EuraFlow 数据库基础模型
遵循约束：UTC 时间、Decimal 金额、统一命名规范
"""
from datetime import datetime
from decimal import Decimal
from typing import Any, Dict

from sqlalchemy import DateTime, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    """数据库模型基类"""
    
    # 统一类型映射
    type_annotation_map = {
        datetime: DateTime(timezone=True),  # 强制使用 timezone-aware datetime
    }
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        result = {}
        for column in self.__table__.columns:
            value = getattr(self, column.name)
            
            # 处理特殊类型
            if isinstance(value, Decimal):
                result[column.name] = str(value)
            elif isinstance(value, datetime):
                result[column.name] = value.isoformat()
            else:
                result[column.name] = value
                
        return result