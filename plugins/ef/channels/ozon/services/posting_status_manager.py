"""
Posting状态管理器
统一管理OZON posting的operation_status计算和更新逻辑
被以下模块复用：全量同步、增量同步、Webhook、单个posting同步
"""
from typing import Tuple, Dict, Any, Optional
from datetime import datetime
import logging

from sqlalchemy.ext.asyncio import AsyncSession

from ..models import OzonPosting
from ..utils.datetime_utils import utcnow

logger = logging.getLogger(__name__)


class PostingStatusManager:
    """
    Posting状态管理器（单一职责）

    职责：
    1. 根据OZON状态 + 字段存在性计算operation_status
    2. 处理特殊规则（printed状态保留、状态互斥）
    3. 记录状态变化时间戳
    4. 统一日志输出
    """

    # OZON状态到operation_status的基础映射
    # 注意：awaiting_deliver需要特殊处理（根据字段存在性判断）
    SIMPLE_STATUS_MAP = {
        "awaiting_packaging": "awaiting_stock",
        "delivering": "shipping",
        "delivered": "delivered",
        "cancelled": "cancelled"
    }

    # 状态优先级定义（用于防止状态回退）
    # 数字越大表示状态越靠后，状态只能前进不能后退
    STATUS_PRIORITY = {
        "awaiting_stock": 0,         # 等待备货
        "allocating": 1,             # 分配中（手动"备货"）
        "allocated": 2,              # 已分配（有tracking但无domestic）
        "tracking_confirmed": 3,     # 单号确认（有tracking和domestic）
        "printed": 4,                # 已打印
        "shipping": 5,               # 运输中
        "delivered": 6,              # 已送达
        "cancelled": 99,             # 已取消（终态，最高优先级，不可被覆盖）
    }

    @staticmethod
    def calculate_operation_status(
        posting: OzonPosting,
        ozon_status: str,
        preserve_manual: bool = True
    ) -> Tuple[str, bool]:
        """
        计算新的operation_status（核心算法）

        Args:
            posting: Posting对象（需要有packages和domestic_tracking_number）
            ozon_status: OZON原生状态
            preserve_manual: 是否保留手动标记的状态（printed）

        Returns:
            (new_operation_status, changed): 新状态和是否有变化
        """
        old_operation_status = posting.operation_status

        # ========== 状态优先级保护（防止状态回退） ==========
        if preserve_manual and old_operation_status:
            # cancelled 是终态，不允许任何改变
            if old_operation_status == "cancelled":
                logger.debug(
                    f"Posting {posting.posting_number} is cancelled (terminal state), "
                    f"ignoring status change to {ozon_status}"
                )
                return old_operation_status, False

        # 简单映射（不需要判断字段）
        if ozon_status in PostingStatusManager.SIMPLE_STATUS_MAP:
            new_status = PostingStatusManager.SIMPLE_STATUS_MAP[ozon_status]

            # cancelled状态特殊处理：作为终态，应该能覆盖任何状态
            if new_status == "cancelled":
                logger.info(
                    f"Posting {posting.posting_number}: OZON status changed to cancelled, "
                    f"updating operation_status from {old_operation_status} to cancelled"
                )
                return new_status, new_status != old_operation_status

            # 检查优先级：防止状态回退
            if preserve_manual and old_operation_status:
                old_priority = PostingStatusManager.STATUS_PRIORITY.get(old_operation_status, -999)
                new_priority = PostingStatusManager.STATUS_PRIORITY.get(new_status, -999)

                # 如果新状态优先级 <= 旧状态优先级，保留旧状态（不允许回退）
                if new_priority <= old_priority:
                    logger.debug(
                        f"Posting {posting.posting_number}: preventing status rollback "
                        f"({old_operation_status}[{old_priority}] → {new_status}[{new_priority}])"
                    )
                    return old_operation_status, False

            return new_status, new_status != old_operation_status

        # 复杂逻辑：awaiting_deliver 根据字段存在性判断
        if ozon_status == "awaiting_deliver":
            # 使用反范式化字段（避免 JSONB 查询和 EXISTS 子查询）
            has_tracking = posting.has_tracking_number
            has_domestic = posting.has_domestic_tracking

            if not has_tracking:
                new_status = "allocating"  # 无追踪号码 → 分配中
            elif has_tracking and not has_domestic:
                new_status = "allocated"  # 有追踪号码，无国内单号 → 已分配
            else:
                new_status = "tracking_confirmed"  # 都有 → 单号确认

            # 检查优先级：防止状态回退
            if preserve_manual and old_operation_status:
                old_priority = PostingStatusManager.STATUS_PRIORITY.get(old_operation_status, -999)
                new_priority = PostingStatusManager.STATUS_PRIORITY.get(new_status, -999)

                # 如果新状态优先级 <= 旧状态优先级，保留旧状态（不允许回退）
                if new_priority <= old_priority:
                    logger.debug(
                        f"Posting {posting.posting_number}: preventing status rollback "
                        f"({old_operation_status}[{old_priority}] → {new_status}[{new_priority}]), "
                        f"has_tracking={has_tracking}, has_domestic={has_domestic}"
                    )
                    return old_operation_status, False

            return new_status, new_status != old_operation_status

        # 未知状态：保持原状态，记录警告
        logger.warning(
            f"Unknown OZON status '{ozon_status}' for posting {posting.posting_number}, "
            f"keeping operation_status as '{old_operation_status}'"
        )
        return old_operation_status, False

    @staticmethod
    async def update_posting_status(
        posting: OzonPosting,
        ozon_status: str,
        db: AsyncSession,
        source: str = "sync",
        preserve_manual: bool = True
    ) -> Dict[str, Any]:
        """
        更新posting的operation_status（高层接口）

        Args:
            posting: Posting对象
            ozon_status: OZON原生状态
            db: 数据库会话（用于flush，不会commit）
            source: 更新来源 (sync/webhook/manual)，用于日志
            preserve_manual: 是否保留手动标记的状态（printed）

        Returns:
            {
                "changed": bool,
                "old_status": str,
                "new_status": str,
                "timestamp": datetime,
                "source": str
            }
        """
        # 确保packages已加载（用于has_tracking_number判断）
        # 如果调用方已经用selectinload预加载，这里flush不会产生额外查询
        await db.flush()

        old_status = posting.operation_status

        # 计算新状态
        new_status, changed = PostingStatusManager.calculate_operation_status(
            posting=posting,
            ozon_status=ozon_status,
            preserve_manual=preserve_manual
        )

        # 更新状态
        posting.operation_status = new_status

        # 记录状态变化时间
        timestamp = None
        if changed:
            timestamp = utcnow()
            posting.operation_time = timestamp

        # 统一日志输出
        if changed:
            logger.info(
                f"[{source}] Posting operation_status updated: {old_status} → {new_status}",
                extra={
                    "posting_number": posting.posting_number,
                    "ozon_status": ozon_status,
                    "old_operation_status": old_status,
                    "new_operation_status": new_status,
                    "source": source,
                    "has_tracking": posting.has_tracking_number,
                    "has_domestic": posting.has_domestic_tracking
                }
            )
        else:
            logger.debug(
                f"[{source}] Posting operation_status unchanged: {old_status}",
                extra={
                    "posting_number": posting.posting_number,
                    "ozon_status": ozon_status,
                    "operation_status": old_status,
                    "source": source
                }
            )

        return {
            "changed": changed,
            "old_status": old_status,
            "new_status": new_status,
            "timestamp": timestamp,
            "source": source
        }

    @staticmethod
    def validate_status_transition(
        old_status: str,
        new_status: str
    ) -> Tuple[bool, Optional[str]]:
        """
        验证状态转换是否合法（可选的高级功能）

        Args:
            old_status: 旧状态
            new_status: 新状态

        Returns:
            (is_valid, error_message)
        """
        # 互斥状态检查：printed 和 tracking_confirmed 互斥
        if old_status == "printed" and new_status == "tracking_confirmed":
            return False, "Cannot transition from 'printed' to 'tracking_confirmed' (mutually exclusive)"

        if old_status == "tracking_confirmed" and new_status == "printed":
            return False, "Cannot transition from 'tracking_confirmed' to 'printed' (mutually exclusive)"

        # 其他转换都允许（业务逻辑由calculate_operation_status保证）
        return True, None
