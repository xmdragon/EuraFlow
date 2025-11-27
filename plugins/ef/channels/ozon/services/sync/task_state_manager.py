"""
任务状态管理器

替代原有的 SYNC_TASKS 全局字典，提供：
- 类型安全（dataclass）
- 线程安全（threading.Lock）
- 统一的任务生命周期管理
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import threading
import logging

from ...utils.datetime_utils import parse_datetime, utcnow

logger = logging.getLogger(__name__)


@dataclass
class SyncTaskState:
    """同步任务状态"""
    task_id: str
    task_type: str  # "products" | "orders"
    status: str  # "running" | "completed" | "failed"
    progress: int = 0
    message: str = ""
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    failed_at: Optional[datetime] = None
    error: Optional[str] = None
    result: Optional[Dict[str, Any]] = None
    mode: Optional[str] = None  # "incremental" | "full"

    def to_dict(self) -> Dict[str, Any]:
        """转换为字典格式（兼容旧接口）"""
        data = {
            "task_id": self.task_id,
            "status": self.status,
            "progress": self.progress,
            "message": self.message,
            "type": self.task_type,
        }

        if self.started_at:
            data["started_at"] = self.started_at.isoformat()
        if self.completed_at:
            data["completed_at"] = self.completed_at.isoformat()
        if self.failed_at:
            data["failed_at"] = self.failed_at.isoformat()
        if self.error:
            data["error"] = self.error
        if self.result:
            data["result"] = self.result
        if self.mode:
            data["mode"] = self.mode

        return data


class TaskStateManager:
    """
    任务状态管理器（单例模式）

    提供线程安全的任务状态管理，支持：
    - 创建/更新/查询/删除任务
    - 进度跟踪
    - 超时清理
    """

    _instance: Optional["TaskStateManager"] = None
    _lock = threading.Lock()

    def __new__(cls) -> "TaskStateManager":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    instance = super().__new__(cls)
                    instance._tasks: Dict[str, SyncTaskState] = {}
                    instance._tasks_lock = threading.Lock()
                    cls._instance = instance
        return cls._instance

    def create_task(
        self,
        task_id: str,
        task_type: str,
        mode: Optional[str] = None,
        message: str = ""
    ) -> SyncTaskState:
        """创建新任务"""
        task = SyncTaskState(
            task_id=task_id,
            task_type=task_type,
            status="running",
            progress=0,
            message=message,
            started_at=utcnow(),
            mode=mode,
        )

        with self._tasks_lock:
            self._tasks[task_id] = task

        logger.debug(f"Created task {task_id} (type={task_type}, mode={mode})")
        return task

    def update_progress(
        self,
        task_id: str,
        progress: int,
        message: str = ""
    ) -> Optional[SyncTaskState]:
        """更新任务进度"""
        with self._tasks_lock:
            task = self._tasks.get(task_id)
            if task:
                task.progress = min(progress, 100)
                if message:
                    task.message = message
                return task
        return None

    def complete_task(
        self,
        task_id: str,
        result: Optional[Dict[str, Any]] = None,
        message: str = ""
    ) -> Optional[SyncTaskState]:
        """标记任务完成"""
        with self._tasks_lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = "completed"
                task.progress = 100
                task.completed_at = utcnow()
                task.result = result
                if message:
                    task.message = message
                logger.info(f"Task {task_id} completed: {message}")
                return task
        return None

    def fail_task(
        self,
        task_id: str,
        error: str,
        message: str = ""
    ) -> Optional[SyncTaskState]:
        """标记任务失败"""
        with self._tasks_lock:
            task = self._tasks.get(task_id)
            if task:
                task.status = "failed"
                task.failed_at = utcnow()
                task.error = error
                if message:
                    task.message = message
                else:
                    task.message = f"同步失败: {error}"
                logger.error(f"Task {task_id} failed: {error}")
                return task
        return None

    def get_task(self, task_id: str) -> Optional[SyncTaskState]:
        """获取任务状态对象"""
        with self._tasks_lock:
            return self._tasks.get(task_id)

    def get_task_dict(self, task_id: str) -> Optional[Dict[str, Any]]:
        """获取任务状态字典（兼容旧接口）"""
        task = self.get_task(task_id)
        return task.to_dict() if task else None

    def set_task_dict(self, task_id: str, data: Dict[str, Any]) -> None:
        """
        直接设置任务状态字典（兼容旧接口）

        这个方法用于向后兼容，允许直接设置字典数据。
        新代码应该使用 create_task/update_progress/complete_task 等方法。
        """
        with self._tasks_lock:
            # 如果任务已存在，更新它
            existing = self._tasks.get(task_id)
            if existing:
                existing.status = data.get("status", existing.status)
                existing.progress = data.get("progress", existing.progress)
                existing.message = data.get("message", existing.message)
                if data.get("error"):
                    existing.error = data["error"]
                if data.get("result"):
                    existing.result = data["result"]
                if data.get("completed_at"):
                    existing.completed_at = parse_datetime(data["completed_at"])
                if data.get("failed_at"):
                    existing.failed_at = parse_datetime(data["failed_at"])
            else:
                # 创建新任务
                task = SyncTaskState(
                    task_id=task_id,
                    task_type=data.get("type", "unknown"),
                    status=data.get("status", "running"),
                    progress=data.get("progress", 0),
                    message=data.get("message", ""),
                    mode=data.get("mode"),
                )
                if data.get("started_at"):
                    task.started_at = parse_datetime(data["started_at"])
                if data.get("completed_at"):
                    task.completed_at = parse_datetime(data["completed_at"])
                if data.get("failed_at"):
                    task.failed_at = parse_datetime(data["failed_at"])
                if data.get("error"):
                    task.error = data["error"]
                if data.get("result"):
                    task.result = data["result"]
                self._tasks[task_id] = task

    def delete_task(self, task_id: str) -> bool:
        """删除任务"""
        with self._tasks_lock:
            if task_id in self._tasks:
                del self._tasks[task_id]
                return True
        return False

    def clear_expired_tasks(self, max_age_hours: int = 1) -> int:
        """清理过期任务

        Args:
            max_age_hours: 已完成任务的最大保留时间（小时）

        Returns:
            清理的任务数量
        """
        now = utcnow()
        to_remove = []

        with self._tasks_lock:
            for task_id, task in self._tasks.items():
                # 已完成的任务：1小时后清理
                if task.completed_at:
                    if now - task.completed_at > timedelta(hours=max_age_hours):
                        to_remove.append(task_id)
                # 已失败的任务：1小时后清理
                elif task.failed_at:
                    if now - task.failed_at > timedelta(hours=max_age_hours):
                        to_remove.append(task_id)
                # 运行中的任务：2小时后清理（可能卡住）
                elif task.started_at:
                    if now - task.started_at > timedelta(hours=max_age_hours * 2):
                        to_remove.append(task_id)

            for task_id in to_remove:
                del self._tasks[task_id]

        if to_remove:
            logger.info(f"Cleared {len(to_remove)} expired tasks")

        return len(to_remove)

    def get_all_tasks(self) -> Dict[str, Dict[str, Any]]:
        """获取所有任务状态（字典格式）"""
        with self._tasks_lock:
            return {
                task_id: task.to_dict()
                for task_id, task in self._tasks.items()
            }

    @property
    def _tasks_compat(self) -> Dict[str, Dict[str, Any]]:
        """
        兼容层：返回任务字典视图

        警告：这个属性仅用于向后兼容，新代码不应使用。
        """
        return _TasksDictProxy(self)


class _TasksDictProxy:
    """
    任务字典代理类

    实现类似 dict 的接口，用于向后兼容 SYNC_TASKS[task_id] = {...} 的用法。
    """

    def __init__(self, manager: TaskStateManager):
        self._manager = manager

    def __getitem__(self, task_id: str) -> Dict[str, Any]:
        result = self._manager.get_task_dict(task_id)
        if result is None:
            raise KeyError(task_id)
        return result

    def __setitem__(self, task_id: str, value: Dict[str, Any]) -> None:
        self._manager.set_task_dict(task_id, value)

    def __contains__(self, task_id: str) -> bool:
        return self._manager.get_task(task_id) is not None

    def get(self, task_id: str, default: Any = None) -> Optional[Dict[str, Any]]:
        result = self._manager.get_task_dict(task_id)
        return result if result is not None else default

    def items(self):
        return self._manager.get_all_tasks().items()

    def keys(self):
        return self._manager.get_all_tasks().keys()

    def values(self):
        return self._manager.get_all_tasks().values()

    def __delitem__(self, task_id: str) -> None:
        if not self._manager.delete_task(task_id):
            raise KeyError(task_id)


# 全局实例获取函数
def get_task_state_manager() -> TaskStateManager:
    """获取任务状态管理器实例"""
    return TaskStateManager()
