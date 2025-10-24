"""
数据库备份服务
每天北京时间1点和13点自动备份PostgreSQL数据库
"""
import os
import logging
from datetime import datetime
from pathlib import Path
import subprocess
from typing import Dict, Any

logger = logging.getLogger(__name__)


class DatabaseBackupService:
    """数据库备份服务"""

    def __init__(self):
        """初始化备份服务"""
        # 直接使用项目配置类，确保配置一致性
        from ef_core.config import get_settings
        settings = get_settings()

        self.db_host = settings.db_host
        self.db_port = settings.db_port
        self.db_name = settings.db_name
        self.db_user = settings.db_user
        self.db_password = settings.db_password

        # 备份目录（项目根目录/backups）
        project_root = Path(__file__).parent.parent.parent.parent.parent.parent
        self.backup_dir = project_root / "backups"

        # 确保备份目录存在
        self.backup_dir.mkdir(exist_ok=True)

        # 保留最近7天的备份（默认每天2次，7天=14个备份文件）
        self.retention_days = 7
        self.max_backups = int(os.getenv("EF__BACKUP__MAX_BACKUPS", str(self.retention_days * 2)))

    async def backup_database(self, config: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        执行数据库备份

        Args:
            config: 配置参数（预留，当前未使用）

        Returns:
            备份结果字典
        """
        try:
            # 生成备份文件名（包含时间戳）
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"euraflow_backup_{timestamp}.sql.gz"
            backup_path = self.backup_dir / backup_filename

            logger.info(f"开始备份数据库到: {backup_path}")

            # 构建 pg_dump 命令
            # 使用 gzip 压缩以节省空间
            pg_dump_cmd = [
                "pg_dump",
                "-h", str(self.db_host),
                "-p", str(self.db_port),  # 转换为字符串
                "-U", str(self.db_user),
                "-d", str(self.db_name),
                "--format=custom",  # 使用自定义格式（支持压缩和并行恢复）
                "--compress=9",      # 最高压缩级别
                "-f", str(backup_path)
            ]

            # 设置环境变量（密码）
            env = os.environ.copy()
            if self.db_password:
                env["PGPASSWORD"] = self.db_password

            # 执行备份命令
            result = subprocess.run(
                pg_dump_cmd,
                env=env,
                capture_output=True,
                text=True,
                timeout=3600  # 超时1小时
            )

            if result.returncode != 0:
                error_msg = f"pg_dump 执行失败: {result.stderr}"
                logger.error(error_msg)
                return {
                    "success": False,
                    "error": "BACKUP_FAILED",
                    "message": error_msg
                }

            # 检查备份文件是否存在
            if not backup_path.exists():
                error_msg = "备份文件未创建"
                logger.error(error_msg)
                return {
                    "success": False,
                    "error": "FILE_NOT_CREATED",
                    "message": error_msg
                }

            # 获取备份文件大小
            file_size = backup_path.stat().st_size
            file_size_mb = file_size / (1024 * 1024)

            logger.info(
                f"数据库备份成功: {backup_filename} "
                f"({file_size_mb:.2f} MB)"
            )

            # 清理旧备份
            self._cleanup_old_backups()

            return {
                "success": True,
                "message": f"数据库备份成功",
                "data": {
                    "backup_file": backup_filename,
                    "backup_path": str(backup_path),
                    "file_size_bytes": file_size,
                    "file_size_mb": round(file_size_mb, 2),
                    "timestamp": timestamp
                }
            }

        except subprocess.TimeoutExpired:
            error_msg = "备份超时（超过1小时）"
            logger.error(error_msg)
            return {
                "success": False,
                "error": "BACKUP_TIMEOUT",
                "message": error_msg
            }

        except Exception as e:
            error_msg = f"备份失败: {str(e)}"
            logger.error(error_msg, exc_info=True)
            return {
                "success": False,
                "error": "BACKUP_ERROR",
                "message": error_msg
            }

    def _cleanup_old_backups(self):
        """清理超过7天的旧备份文件"""
        try:
            import time

            # 计算7天前的时间戳
            cutoff_time = time.time() - (self.retention_days * 24 * 60 * 60)

            # 获取所有备份文件
            backup_files = list(self.backup_dir.glob("euraflow_backup_*.sql.gz"))

            # 找出超过7天的文件
            deleted_count = 0
            for file_path in backup_files:
                file_mtime = file_path.stat().st_mtime
                if file_mtime < cutoff_time:
                    logger.info(f"删除超过{self.retention_days}天的备份: {file_path.name}")
                    file_path.unlink()
                    deleted_count += 1

            if deleted_count > 0:
                logger.info(f"清理完成，删除了 {deleted_count} 个超过{self.retention_days}天的旧备份")
            else:
                logger.debug(f"无需清理，所有备份都在{self.retention_days}天内")

        except Exception as e:
            logger.error(f"清理旧备份失败: {str(e)}", exc_info=True)
