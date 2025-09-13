"""
基础服务类
"""
from typing import TypeVar, Generic, Optional, Dict, Any, List, Union
from dataclasses import dataclass
from abc import ABC, abstractmethod
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.utils.logger import get_logger
from ef_core.utils.errors import EuraFlowException, InternalServerError
from ef_core.database import get_db_manager

T = TypeVar('T')

logger = get_logger(__name__)


@dataclass
class ServiceResult(Generic[T]):
    """服务执行结果"""
    success: bool
    data: Optional[T] = None
    error: Optional[str] = None
    error_code: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    
    @classmethod
    def ok(cls, data: T, metadata: Optional[Dict[str, Any]] = None) -> "ServiceResult[T]":
        """成功结果"""
        return cls(success=True, data=data, metadata=metadata)
    
    @classmethod 
    def error(cls, error: str, error_code: Optional[str] = None) -> "ServiceResult[T]":
        """失败结果"""
        return cls(success=False, error=error, error_code=error_code)


class BaseService(ABC):
    """基础服务类"""
    
    def __init__(self):
        self.db_manager = get_db_manager()
        self.logger = get_logger(self.__class__.__name__)
    
    async def execute_with_transaction(
        self,
        operation,
        *args,
        **kwargs
    ) -> Any:
        """在事务中执行操作"""
        try:
            async with self.db_manager.get_transaction() as session:
                result = await operation(session, *args, **kwargs)
                await session.commit()
                return result
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Transaction operation failed", exc_info=True)
            raise InternalServerError(
                code="TRANSACTION_FAILED",
                detail=f"Database transaction failed: {str(e)}"
            )
    
    async def execute_with_session(
        self,
        operation,
        *args,
        **kwargs
    ) -> Any:
        """使用数据库会话执行操作"""
        try:
            async with self.db_manager.get_session() as session:
                return await operation(session, *args, **kwargs)
        except EuraFlowException:
            raise
        except Exception as e:
            self.logger.error("Session operation failed", exc_info=True)
            raise InternalServerError(
                code="SESSION_OPERATION_FAILED",
                detail=f"Database operation failed: {str(e)}"
            )
    
    def validate_required_fields(self, data: Dict[str, Any], required_fields: List[str]) -> None:
        """验证必填字段"""
        missing_fields = []
        for field in required_fields:
            if field not in data or data[field] is None:
                missing_fields.append(field)
        
        if missing_fields:
            raise ValidationError(
                code="MISSING_REQUIRED_FIELDS",
                detail=f"Missing required fields: {', '.join(missing_fields)}"
            )
    
    def sanitize_input(self, data: Dict[str, Any], allowed_fields: List[str]) -> Dict[str, Any]:
        """清理输入数据，只保留允许的字段"""
        return {k: v for k, v in data.items() if k in allowed_fields}


class RepositoryMixin:
    """仓储混入类 - 提供常用的数据库操作"""
    
    async def get_by_id(
        self,
        session: AsyncSession,
        model_class,
        record_id: int
    ) -> Optional[Any]:
        """根据ID获取记录"""
        result = await session.get(model_class, record_id)
        return result
    
    async def get_by_field(
        self,
        session: AsyncSession,
        model_class,
        field_name: str,
        field_value: Any
    ) -> Optional[Any]:
        """根据字段获取记录"""
        stmt = select(model_class).where(getattr(model_class, field_name) == field_value)
        result = await session.execute(stmt)
        return result.scalar_one_or_none()
    
    async def get_many_by_field(
        self,
        session: AsyncSession,
        model_class,
        field_name: str,
        field_value: Any,
        limit: Optional[int] = None,
        offset: Optional[int] = None
    ) -> List[Any]:
        """根据字段获取多个记录"""
        stmt = select(model_class).where(getattr(model_class, field_name) == field_value)
        
        if offset:
            stmt = stmt.offset(offset)
        if limit:
            stmt = stmt.limit(limit)
        
        result = await session.execute(stmt)
        return list(result.scalars().all())
    
    async def create(
        self,
        session: AsyncSession,
        model_class,
        data: Dict[str, Any]
    ) -> Any:
        """创建记录"""
        instance = model_class(**data)
        session.add(instance)
        await session.flush()  # 获取生成的ID
        return instance
    
    async def update(
        self,
        session: AsyncSession,
        instance: Any,
        data: Dict[str, Any]
    ) -> Any:
        """更新记录"""
        for key, value in data.items():
            if hasattr(instance, key):
                setattr(instance, key, value)
        
        await session.flush()
        return instance
    
    async def delete(
        self,
        session: AsyncSession,
        instance: Any
    ) -> bool:
        """删除记录"""
        await session.delete(instance)
        await session.flush()
        return True
    
    async def exists(
        self,
        session: AsyncSession,
        model_class,
        **filters
    ) -> bool:
        """检查记录是否存在"""
        stmt = select(model_class)
        for field, value in filters.items():
            stmt = stmt.where(getattr(model_class, field) == value)
        
        stmt = stmt.limit(1)
        result = await session.execute(stmt)
        return result.scalar_one_or_none() is not None


# 导入必要的模块
from sqlalchemy import select
from ef_core.utils.errors import ValidationError