"""
全局审计日志服务
用于记录所有模块的数据修改操作
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any
from decimal import Decimal

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.models.audit_log import AuditLog, AuditLogArchive

logger = logging.getLogger(__name__)


def utcnow():
    """返回UTC时区的当前时间"""
    return datetime.now(timezone.utc)


class AuditService:
    """
    审计日志服务

    功能：
    1. 记录用户操作日志（打印、修改价格、订单操作、删除数据等）
    2. 字段级变更追踪
    3. 记录请求上下文（IP、User Agent、Trace ID）
    4. 定期归档旧日志

    使用示例：
        # 记录打印标签
        await AuditService.log_print(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            posting_number="0126328087-0112-1",
            print_count=1,
            ip_address=request.client.host,
            user_agent=request.headers.get("user-agent"),
            request_id=request.state.request_id
        )

        # 记录价格修改
        await AuditService.log_price_change(
            db=db,
            user_id=current_user.id,
            username=current_user.username,
            product_id="123456",
            old_price=Decimal("100.00"),
            new_price=Decimal("120.00"),
            ip_address=request.client.host
        )
    """

    @staticmethod
    async def log_action(
        db: AsyncSession,
        user_id: int,
        username: str,
        module: str,
        action: str,
        action_display: str,
        table_name: str,
        record_id: str,
        changes: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> AuditLog:
        """
        通用操作日志记录

        Args:
            db: 数据库会话
            user_id: 用户ID
            username: 用户名
            module: 模块名（ozon/finance/user/system）
            action: 操作类型（create/update/delete/print）
            action_display: 操作显示名称（打印标签/修改价格/删除商品）
            table_name: 表名
            record_id: 记录ID（posting_number或主键ID）
            changes: 变更详情（字段级）
            ip_address: 客户端IP地址
            user_agent: User Agent
            request_id: 请求ID（trace_id）
            notes: 备注信息

        Returns:
            AuditLog: 审计日志记录
        """
        try:
            audit_log = AuditLog(
                user_id=user_id,
                username=username,
                module=module,
                action=action,
                action_display=action_display,
                table_name=table_name,
                record_id=record_id,
                changes=changes,
                ip_address=ip_address,
                user_agent=user_agent,
                request_id=request_id,
                notes=notes,
                created_at=utcnow(),
            )
            db.add(audit_log)
            await db.commit()
            await db.refresh(audit_log)

            logger.info(
                f"审计日志已记录: user={username}, module={module}, action={action_display}, record={record_id}",
                extra={
                    "audit_log_id": audit_log.id,
                    "user_id": user_id,
                    "audit_module": module,  # 重命名避免与 logging.LogRecord.module 冲突
                    "audit_action": action,  # 重命名保持一致性
                    "table_name": table_name,
                    "record_id": record_id,
                }
            )

            return audit_log

        except Exception as e:
            logger.error(
                f"审计日志记录失败: {str(e)}",
                extra={
                    "user_id": user_id,
                    "audit_module": module,  # 重命名避免与 logging.LogRecord.module 冲突
                    "audit_action": action,
                    "error_message": str(e),
                },
                exc_info=True,
            )
            # 审计日志失败不应阻塞主流程，仅记录错误
            await db.rollback()
            raise

    @staticmethod
    async def log_print(
        db: AsyncSession,
        user_id: int,
        username: str,
        posting_number: str,
        print_count: int,
        is_reprint: bool = False,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> AuditLog:
        """
        记录打印标签操作

        Args:
            db: 数据库会话
            user_id: 用户ID
            username: 用户名
            posting_number: posting number
            print_count: 当前打印次数
            is_reprint: 是否是补打
            ip_address: 客户端IP
            user_agent: User Agent
            request_id: 请求ID
            notes: 备注

        Returns:
            AuditLog: 审计日志记录
        """
        action_display = "补打标签" if is_reprint else "打印标签"

        changes = {
            "print_count": {
                "old": print_count - 1,
                "new": print_count,
            },
            "is_reprint": is_reprint,
        }

        return await AuditService.log_action(
            db=db,
            user_id=user_id,
            username=username,
            module="ozon",
            action="print",
            action_display=action_display,
            table_name="ozon_postings",
            record_id=posting_number,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            notes=notes,
        )

    @staticmethod
    async def log_price_change(
        db: AsyncSession,
        user_id: int,
        username: str,
        product_id: str,
        old_price: Decimal,
        new_price: Decimal,
        currency: str = "RUB",
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> AuditLog:
        """
        记录价格修改操作

        Args:
            db: 数据库会话
            user_id: 用户ID
            username: 用户名
            product_id: 商品ID
            old_price: 旧价格
            new_price: 新价格
            currency: 货币
            ip_address: 客户端IP
            user_agent: User Agent
            request_id: 请求ID
            notes: 备注

        Returns:
            AuditLog: 审计日志记录
        """
        changes = {
            "price": {
                "old": str(old_price),
                "new": str(new_price),
                "currency": currency,
                "change_amount": str(new_price - old_price),
                "change_percent": str(round((new_price - old_price) / old_price * 100, 2)) if old_price > 0 else "N/A",
            }
        }

        return await AuditService.log_action(
            db=db,
            user_id=user_id,
            username=username,
            module="ozon",
            action="update",
            action_display="修改价格",
            table_name="ozon_products",
            record_id=product_id,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            notes=notes,
        )

    @staticmethod
    async def log_stock_change(
        db: AsyncSession,
        user_id: int,
        username: str,
        product_id: str,
        old_stock: int,
        new_stock: int,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> AuditLog:
        """
        记录库存修改操作

        Args:
            db: 数据库会话
            user_id: 用户ID
            username: 用户名
            product_id: 商品ID
            old_stock: 旧库存
            new_stock: 新库存
            ip_address: 客户端IP
            user_agent: User Agent
            request_id: 请求ID
            notes: 备注

        Returns:
            AuditLog: 审计日志记录
        """
        changes = {
            "stock": {
                "old": old_stock,
                "new": new_stock,
                "change": new_stock - old_stock,
            }
        }

        return await AuditService.log_action(
            db=db,
            user_id=user_id,
            username=username,
            module="ozon",
            action="update",
            action_display="修改库存",
            table_name="ozon_products",
            record_id=product_id,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            notes=notes,
        )

    @staticmethod
    async def log_delete(
        db: AsyncSession,
        user_id: int,
        username: str,
        module: str,
        table_name: str,
        record_id: str,
        deleted_data: Optional[Dict[str, Any]] = None,
        ip_address: Optional[str] = None,
        user_agent: Optional[str] = None,
        request_id: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> AuditLog:
        """
        记录删除操作

        Args:
            db: 数据库会话
            user_id: 用户ID
            username: 用户名
            module: 模块名
            table_name: 表名
            record_id: 记录ID
            deleted_data: 被删除的数据（关键字段）
            ip_address: 客户端IP
            user_agent: User Agent
            request_id: 请求ID
            notes: 备注

        Returns:
            AuditLog: 审计日志记录
        """
        changes = {
            "deleted_data": deleted_data,
        }

        return await AuditService.log_action(
            db=db,
            user_id=user_id,
            username=username,
            module=module,
            action="delete",
            action_display="删除数据",
            table_name=table_name,
            record_id=record_id,
            changes=changes,
            ip_address=ip_address,
            user_agent=user_agent,
            request_id=request_id,
            notes=notes,
        )

    @staticmethod
    async def archive_old_logs(
        db: AsyncSession,
        days: int = 180,
        batch_size: int = 1000,
    ) -> int:
        """
        归档旧日志（超过指定天数的日志移动到归档表）

        Args:
            db: 数据库会话
            days: 归档天数阈值（默认180天，即6个月）
            batch_size: 每批次处理的记录数

        Returns:
            int: 归档的记录数
        """
        try:
            cutoff_date = utcnow() - timedelta(days=days)

            # 查询需要归档的日志
            stmt = select(AuditLog).where(
                AuditLog.created_at < cutoff_date
            ).limit(batch_size)

            result = await db.execute(stmt)
            old_logs = result.scalars().all()

            if not old_logs:
                logger.info("没有需要归档的审计日志")
                return 0

            archived_count = 0

            for log in old_logs:
                # 创建归档记录
                archive_log = AuditLogArchive(
                    id=log.id,
                    user_id=log.user_id,
                    username=log.username,
                    module=log.module,
                    action=log.action,
                    action_display=log.action_display,
                    table_name=log.table_name,
                    record_id=log.record_id,
                    changes=log.changes,
                    ip_address=log.ip_address,
                    user_agent=log.user_agent,
                    request_id=log.request_id,
                    notes=log.notes,
                    created_at=log.created_at,
                )
                db.add(archive_log)

                # 删除原记录
                await db.delete(log)
                archived_count += 1

            await db.commit()

            logger.info(
                f"审计日志归档完成: 归档了 {archived_count} 条记录（{days}天前）",
                extra={
                    "archived_count": archived_count,
                    "cutoff_date": cutoff_date.isoformat(),
                    "batch_size": batch_size,
                }
            )

            return archived_count

        except Exception as e:
            logger.error(
                f"审计日志归档失败: {str(e)}",
                extra={"error": str(e)},
                exc_info=True,
            )
            await db.rollback()
            raise

    @staticmethod
    async def query_logs(
        db: AsyncSession,
        user_id: Optional[int] = None,
        module: Optional[str] = None,
        action: Optional[str] = None,
        table_name: Optional[str] = None,
        record_id: Optional[str] = None,
        start_date: Optional[datetime] = None,
        end_date: Optional[datetime] = None,
        limit: int = 100,
    ) -> list[AuditLog]:
        """
        查询审计日志

        Args:
            db: 数据库会话
            user_id: 用户ID
            module: 模块名
            action: 操作类型
            table_name: 表名
            record_id: 记录ID
            start_date: 起始时间
            end_date: 结束时间
            limit: 返回记录数限制

        Returns:
            list[AuditLog]: 审计日志列表
        """
        conditions = []

        if user_id is not None:
            conditions.append(AuditLog.user_id == user_id)
        if module is not None:
            conditions.append(AuditLog.module == module)
        if action is not None:
            conditions.append(AuditLog.action == action)
        if table_name is not None:
            conditions.append(AuditLog.table_name == table_name)
        if record_id is not None:
            conditions.append(AuditLog.record_id == record_id)
        if start_date is not None:
            conditions.append(AuditLog.created_at >= start_date)
        if end_date is not None:
            conditions.append(AuditLog.created_at <= end_date)

        stmt = select(AuditLog)
        if conditions:
            stmt = stmt.where(and_(*conditions))

        stmt = stmt.order_by(AuditLog.created_at.desc()).limit(limit)

        result = await db.execute(stmt)
        logs = result.scalars().all()

        return list(logs)
