"""
数据库备份服务
每天北京时间1点和13点自动备份PostgreSQL数据库

备份策略：
- 常规备份：排除类目、特征、字典三个大表（约843MB）
- 类目表备份：每周一类目/特征同步后1小时执行，仅备份这三个表
"""
import os
import logging
from datetime import datetime
from pathlib import Path
import subprocess
from typing import Dict, Any

logger = logging.getLogger(__name__)

# 类目相关表（数据量大且仅每周同步一次）
CATALOG_TABLES = [
    "ozon_categories",
    "ozon_category_attributes",
    "ozon_attribute_dictionary_values",
]


class DatabaseBackupService:
    """数据库备份服务"""

    def __init__(self):
        """初始化备份服务"""
        from ef_core.config import get_settings
        settings = get_settings()

        self.db_host = settings.db_host
        self.db_port = settings.db_port
        self.db_name = settings.db_name
        self.db_user = settings.db_user
        self.db_password = settings.db_password

        # 备份目录（项目根目录/backups）
        project_root = Path(__file__).parent.parent.parent.parent.parent
        self.backup_dir = project_root / "backups"

        # 确保备份目录存在
        self.backup_dir.mkdir(exist_ok=True)

        # 保留最近7天的备份（默认每天2次，7天=14个备份文件）
        self.retention_days = 7

    async def backup_database(
        self,
        config: Dict[str, Any] = None,
        exclude_catalog_tables: bool = True
    ) -> Dict[str, Any]:
        """
        执行数据库备份

        Args:
            config: 配置参数（预留，当前未使用）
            exclude_catalog_tables: 是否排除类目相关大表（默认True）

        Returns:
            备份结果字典
        """
        try:
            # 生成备份文件名（包含时间戳）
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            suffix = "_main" if exclude_catalog_tables else "_full"
            backup_filename = f"euraflow_backup_{timestamp}{suffix}.sql.gz"
            backup_path = self.backup_dir / backup_filename

            excluded_info = ""
            if exclude_catalog_tables:
                excluded_info = f"（排除类目表: {', '.join(CATALOG_TABLES)}）"
            logger.info(f"开始备份数据库到: {backup_path}{excluded_info}")

            # 构建 pg_dump 命令
            pg_dump_cmd = [
                "pg_dump",
                "-h", str(self.db_host),
                "-p", str(self.db_port),
                "-U", str(self.db_user),
                "-d", str(self.db_name),
                "--format=custom",
                "--compress=9",
            ]

            # 排除类目相关大表
            if exclude_catalog_tables:
                for table in CATALOG_TABLES:
                    pg_dump_cmd.extend(["--exclude-table", table])

            pg_dump_cmd.extend(["-f", str(backup_path)])

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
                timeout=3600
            )

            if result.returncode != 0:
                error_msg = f"pg_dump 执行失败: {result.stderr}"
                logger.error(error_msg)
                return {
                    "success": False,
                    "error": "BACKUP_FAILED",
                    "message": error_msg
                }

            if not backup_path.exists():
                return {
                    "success": False,
                    "error": "FILE_NOT_CREATED",
                    "message": "备份文件未创建"
                }

            file_size = backup_path.stat().st_size
            file_size_mb = file_size / (1024 * 1024)

            logger.info(f"✓ 数据库备份成功: {backup_filename} ({file_size_mb:.2f} MB)")

            # 清理旧备份
            self._cleanup_old_backups()

            return {
                "success": True,
                "message": "数据库备份成功",
                "data": {
                    "backup_file": backup_filename,
                    "backup_path": str(backup_path),
                    "file_size_bytes": file_size,
                    "file_size_mb": round(file_size_mb, 2),
                    "timestamp": timestamp,
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

    async def backup_catalog_tables(self, config: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        仅备份类目相关表（类目、特征、字典）

        在类目/特征同步后执行，每周一次
        - 类目同步: 每周一 21:00 UTC
        - 特征同步: 每周一 21:30 UTC
        - 此备份: 每周一 22:30 UTC（同步后约1小时）

        Args:
            config: 配置参数（预留）

        Returns:
            备份结果字典
        """
        try:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup_filename = f"euraflow_backup_{timestamp}_catalog.sql.gz"
            backup_path = self.backup_dir / backup_filename

            logger.info(f"开始备份类目表到: {backup_path}")
            logger.info(f"备份表: {', '.join(CATALOG_TABLES)}")

            # 构建 pg_dump 命令 - 仅备份指定表
            pg_dump_cmd = [
                "pg_dump",
                "-h", str(self.db_host),
                "-p", str(self.db_port),
                "-U", str(self.db_user),
                "-d", str(self.db_name),
                "--format=custom",
                "--compress=9",
            ]

            # 只备份类目相关表
            for table in CATALOG_TABLES:
                pg_dump_cmd.extend(["-t", table])

            pg_dump_cmd.extend(["-f", str(backup_path)])

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
                timeout=3600
            )

            if result.returncode != 0:
                error_msg = f"pg_dump 执行失败: {result.stderr}"
                logger.error(error_msg)
                return {
                    "success": False,
                    "error": "BACKUP_FAILED",
                    "message": error_msg
                }

            if not backup_path.exists():
                return {
                    "success": False,
                    "error": "FILE_NOT_CREATED",
                    "message": "备份文件未创建"
                }

            file_size = backup_path.stat().st_size
            file_size_mb = file_size / (1024 * 1024)

            logger.info(f"✓ 类目表备份成功: {backup_filename} ({file_size_mb:.2f} MB)")

            # 清理旧的类目备份（保留最近4个，约1个月）
            self._cleanup_old_catalog_backups()

            return {
                "success": True,
                "message": "类目表备份成功",
                "data": {
                    "backup_file": backup_filename,
                    "backup_path": str(backup_path),
                    "file_size_bytes": file_size,
                    "file_size_mb": round(file_size_mb, 2),
                    "timestamp": timestamp,
                    "tables": CATALOG_TABLES,
                }
            }

        except subprocess.TimeoutExpired:
            return {
                "success": False,
                "error": "BACKUP_TIMEOUT",
                "message": "类目表备份超时"
            }
        except Exception as e:
            logger.error(f"类目表备份失败: {e}", exc_info=True)
            return {
                "success": False,
                "error": "BACKUP_ERROR",
                "message": str(e)
            }

    def _cleanup_old_catalog_backups(self):
        """清理旧的类目备份文件，保留最近4个（约1个月）"""
        try:
            catalog_backups = sorted(
                self.backup_dir.glob("euraflow_backup_*_catalog.sql.gz"),
                key=lambda p: p.stat().st_mtime,
                reverse=True
            )

            max_catalog_backups = 4
            if len(catalog_backups) > max_catalog_backups:
                for old_backup in catalog_backups[max_catalog_backups:]:
                    logger.info(f"删除旧的类目备份: {old_backup.name}")
                    old_backup.unlink()

        except Exception as e:
            logger.error(f"清理类目备份失败: {e}")

    def _cleanup_old_backups(self):
        """清理超过7天的旧备份文件"""
        try:
            import time

            cutoff_time = time.time() - (self.retention_days * 24 * 60 * 60)

            # 获取常规备份文件（排除类目备份）
            backup_files = [
                f for f in self.backup_dir.glob("euraflow_backup_*_main.sql.gz")
            ]

            deleted_count = 0
            for file_path in backup_files:
                if file_path.stat().st_mtime < cutoff_time:
                    logger.info(f"删除超过{self.retention_days}天的备份: {file_path.name}")
                    file_path.unlink()
                    deleted_count += 1

            if deleted_count > 0:
                logger.info(f"备份清理完成，删除了 {deleted_count} 个旧备份")

        except Exception as e:
            logger.error(f"清理旧备份失败: {e}", exc_info=True)
