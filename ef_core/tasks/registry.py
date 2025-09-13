"""
任务注册表 - 管理插件任务的注册和调度
"""
import asyncio
from typing import Dict, List, Callable, Awaitable, Optional
from celery.schedules import crontab
from croniter import croniter

from ef_core.utils.logger import get_logger
from .celery_app import celery_app
from .base import BaseTask

logger = get_logger(__name__)


class TaskRegistry:
    """任务注册表"""
    
    def __init__(self):
        self.registered_tasks: Dict[str, Dict] = {}
        self.cron_tasks: Dict[str, Dict] = {}
    
    async def register_cron(
        self,
        name: str,
        cron: str,
        task_func: Callable[..., Awaitable],
        plugin_name: Optional[str] = None
    ) -> None:
        """注册定时任务"""
        if not name.startswith("ef."):
            raise ValueError(f"Task name must start with 'ef.': {name}")
        
        # 验证 cron 表达式
        if not self._validate_cron(cron):
            raise ValueError(f"Invalid cron expression: {cron}")
        
        logger.info(f"Registering cron task: {name}", cron=cron, plugin=plugin_name)
        
        # 包装异步函数为 Celery 任务
        celery_task = self._create_celery_task(name, task_func, plugin_name)
        
        # 注册任务信息
        self.registered_tasks[name] = {
            "name": name,
            "cron": cron,
            "task_func": task_func,
            "celery_task": celery_task,
            "plugin": plugin_name,
            "enabled": True
        }
        
        # 添加到 Celery Beat 调度
        self._add_to_beat_schedule(name, cron)
    
    def _validate_cron(self, cron: str) -> bool:
        """验证 cron 表达式"""
        try:
            croniter(cron)
            return True
        except (ValueError, TypeError):
            return False
    
    def _create_celery_task(
        self,
        name: str,
        async_func: Callable[..., Awaitable],
        plugin_name: Optional[str]
    ) -> Callable:
        """将异步函数包装为 Celery 任务"""
        
        class PluginTask(BaseTask):
            def __call__(self, *args, **kwargs):
                # 设置插件上下文
                if plugin_name:
                    kwargs["_plugin"] = plugin_name
                
                # 运行异步函数
                result = asyncio.run(async_func(*args, **kwargs))
                return result
        
        # 注册到 Celery
        task = celery_app.task(
            bind=True,
            base=PluginTask,
            name=name
        )(lambda self, *args, **kwargs: PluginTask.__call__(self, *args, **kwargs))
        
        return task
    
    def _add_to_beat_schedule(self, name: str, cron: str) -> None:
        """添加任务到 Celery Beat 调度"""
        # 解析 cron 表达式
        cron_parts = cron.split()
        if len(cron_parts) != 5:
            raise ValueError(f"Invalid cron format: {cron}")
        
        minute, hour, day, month, day_of_week = cron_parts
        
        # 创建 crontab 对象
        schedule = crontab(
            minute=minute,
            hour=hour,
            day_of_month=day,
            month_of_year=month,
            day_of_week=day_of_week
        )
        
        # 添加到调度表
        celery_app.conf.beat_schedule[name] = {
            "task": name,
            "schedule": schedule,
            "options": {
                "queue": self._get_task_queue(name)
            }
        }
        
        logger.info(f"Added task to beat schedule: {name}")
    
    def _get_task_queue(self, task_name: str) -> str:
        """根据任务名称确定队列"""
        if "pull_orders" in task_name:
            return "ef_pull"
        elif "push_" in task_name:
            return "ef_push"
        elif ".ozon." in task_name:
            return "ef_ozon"
        elif ".core." in task_name:
            return "ef_core"
        else:
            return "default"
    
    def get_registered_tasks(self) -> List[Dict]:
        """获取所有注册的任务"""
        return list(self.registered_tasks.values())
    
    def enable_task(self, name: str) -> bool:
        """启用任务"""
        if name in self.registered_tasks:
            self.registered_tasks[name]["enabled"] = True
            logger.info(f"Task enabled: {name}")
            return True
        return False
    
    def disable_task(self, name: str) -> bool:
        """禁用任务"""
        if name in self.registered_tasks:
            self.registered_tasks[name]["enabled"] = False
            logger.info(f"Task disabled: {name}")
            return True
        return False
    
    def is_task_enabled(self, name: str) -> bool:
        """检查任务是否启用"""
        task = self.registered_tasks.get(name)
        return task["enabled"] if task else False
    
    async def trigger_task_now(
        self,
        name: str,
        *args,
        **kwargs
    ) -> str:
        """立即触发任务执行"""
        if name not in self.registered_tasks:
            raise ValueError(f"Task not registered: {name}")
        
        task_info = self.registered_tasks[name]
        if not task_info["enabled"]:
            raise ValueError(f"Task is disabled: {name}")
        
        logger.info(f"Triggering task immediately: {name}")
        
        # 异步执行任务
        celery_task = task_info["celery_task"]
        result = celery_task.delay(*args, **kwargs)
        
        return result.id
    
    def get_task_stats(self, name: str) -> Optional[Dict]:
        """获取任务统计信息"""
        if name not in self.registered_tasks:
            return None
        
        # TODO: 从 Celery 获取任务统计
        # - 执行次数
        # - 成功/失败次数
        # - 平均执行时间
        # - 最后执行时间
        
        return {
            "name": name,
            "total_runs": 0,
            "success_runs": 0,
            "failed_runs": 0,
            "avg_duration_ms": 0,
            "last_run": None,
            "next_run": None
        }
    
    async def cleanup_completed_tasks(self, older_than_hours: int = 24) -> int:
        """清理已完成的任务结果"""
        # TODO: 实现清理逻辑
        # - 清理 Redis 中的过期结果
        # - 清理失败任务的详细信息
        logger.info(f"Cleaning up completed tasks older than {older_than_hours} hours")
        return 0


# 全局任务注册表实例
_task_registry: Optional[TaskRegistry] = None


def get_task_registry() -> TaskRegistry:
    """获取任务注册表单例"""
    global _task_registry
    if _task_registry is None:
        _task_registry = TaskRegistry()
    return _task_registry