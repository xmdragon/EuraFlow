"""
数据库备份服务
每天北京时间1点和13点自动备份PostgreSQL数据库
支持本地备份 + S3 云备份（可选）
"""
import os
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
import subprocess
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)


class DatabaseBackupService:
    """数据库备份服务"""

    def __init__(self):
        """初始化备份服务"""
        # 直接使用项目配置类，确保配置一致性
        from ef_core.config import get_settings
        settings = get_settings()

        self.settings = settings
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
        self.max_backups = int(os.getenv("EF__BACKUP__MAX_BACKUPS", str(self.retention_days * 2)))

        # 检查是否启用 S3 备份
        self.s3_enabled = self._check_s3_config()
        self.s3_client = None

        if self.s3_enabled:
            try:
                import boto3
                from botocore.exceptions import BotoCoreError, ClientError

                self.s3_client = boto3.client(
                    's3',
                    aws_access_key_id=settings.aws_access_key_id,
                    aws_secret_access_key=settings.aws_secret_access_key,
                    region_name=settings.aws_region,
                )
                self.s3_bucket = settings.aws_s3_backup_bucket
                self.s3_retention_days = settings.backup_retention_days
                logger.info(f"✓ S3 备份已启用: bucket={self.s3_bucket}, retention={self.s3_retention_days}天")
            except Exception as e:
                logger.warning(f"S3 客户端初始化失败，将仅使用本地备份: {e}")
                self.s3_enabled = False

    def _check_s3_config(self) -> bool:
        """检查 S3 配置是否完整"""
        required = [
            self.settings.aws_access_key_id,
            self.settings.aws_secret_access_key,
            self.settings.aws_s3_backup_bucket,
        ]
        return all(required)

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
                f"本地数据库备份成功: {backup_filename} "
                f"({file_size_mb:.2f} MB)"
            )

            # 上传到 S3（如果启用）
            s3_uploaded = False
            s3_error = None
            if self.s3_enabled:
                try:
                    logger.info(f"开始上传到 S3: s3://{self.s3_bucket}/{backup_filename}")
                    self._upload_to_s3(str(backup_path), backup_filename)
                    s3_uploaded = True
                    logger.info(f"✓ S3 上传成功: {backup_filename}")
                except Exception as e:
                    s3_error = str(e)
                    logger.error(f"S3 上传失败（本地备份已成功）: {e}")

            # 清理旧备份
            self._cleanup_old_backups()

            # 清理 S3 旧备份（如果启用）
            if self.s3_enabled and s3_uploaded:
                try:
                    self._cleanup_s3_backups()
                except Exception as e:
                    logger.warning(f"S3 旧备份清理失败: {e}")

            return {
                "success": True,
                "message": f"数据库备份成功{'（含S3）' if s3_uploaded else ''}",
                "data": {
                    "backup_file": backup_filename,
                    "backup_path": str(backup_path),
                    "file_size_bytes": file_size,
                    "file_size_mb": round(file_size_mb, 2),
                    "timestamp": timestamp,
                    "s3_uploaded": s3_uploaded,
                    "s3_error": s3_error
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
                    logger.info(f"删除超过{self.retention_days}天的本地备份: {file_path.name}")
                    file_path.unlink()
                    deleted_count += 1

            if deleted_count > 0:
                logger.info(f"本地备份清理完成，删除了 {deleted_count} 个超过{self.retention_days}天的旧备份")
            else:
                logger.debug(f"无需清理本地备份，所有备份都在{self.retention_days}天内")

        except Exception as e:
            logger.error(f"清理旧备份失败: {str(e)}", exc_info=True)

    def _upload_to_s3(self, local_file: str, s3_key: str) -> None:
        """上传文件到 S3"""
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            self.s3_client.upload_file(
                local_file,
                self.s3_bucket,
                s3_key,
                ExtraArgs={
                    'ServerSideEncryption': 'AES256',  # 服务端加密
                    'StorageClass': 'STANDARD_IA',  # 标准-不频繁访问（节省成本）
                }
            )
        except (BotoCoreError, ClientError) as e:
            raise RuntimeError(f"S3 上传失败: {e}")

    def _cleanup_s3_backups(self) -> None:
        """删除 S3 中超过保留期限的旧备份"""
        from botocore.exceptions import BotoCoreError, ClientError

        try:
            # 计算截止日期
            cutoff_date = datetime.now(timezone.utc) - timedelta(days=self.s3_retention_days)

            # 列出所有备份文件
            response = self.s3_client.list_objects_v2(
                Bucket=self.s3_bucket,
                Prefix="euraflow_backup_"
            )

            if 'Contents' not in response:
                logger.debug("S3 中没有找到备份文件")
                return

            # 查找需要删除的文件
            to_delete = []
            for obj in response['Contents']:
                # 将 LastModified 转换为 offset-aware datetime
                last_modified = obj['LastModified']
                if last_modified.tzinfo is None:
                    last_modified = last_modified.replace(tzinfo=timezone.utc)

                if last_modified < cutoff_date:
                    to_delete.append({'Key': obj['Key']})

            # 批量删除
            if to_delete:
                logger.info(f"开始删除 S3 中 {len(to_delete)} 个超过{self.s3_retention_days}天的旧备份...")
                self.s3_client.delete_objects(
                    Bucket=self.s3_bucket,
                    Delete={'Objects': to_delete}
                )
                logger.info(f"✓ S3 备份清理完成，删除了 {len(to_delete)} 个旧备份")
            else:
                logger.debug(f"S3 无需清理，所有备份都在{self.s3_retention_days}天内")

        except (BotoCoreError, ClientError) as e:
            logger.error(f"S3 备份清理失败: {e}")
            # 清理失败不影响备份流程
            raise
