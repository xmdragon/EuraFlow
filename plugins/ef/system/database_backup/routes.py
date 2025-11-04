"""
数据库备份 API 路由
"""
import logging
from typing import Dict, Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ef_core.dependencies import get_current_user
from ef_core.models.user import User

from .backup_service import DatabaseBackupService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/backup", tags=["Backup"])


class BackupResponse(BaseModel):
    """备份响应模型"""
    success: bool
    message: str
    data: Dict[str, Any] | None = None


@router.post("/manual", response_model=BackupResponse)
async def trigger_manual_backup(
    current_user: User = Depends(get_current_user),
) -> BackupResponse:
    """
    手动触发数据库备份
    需要管理员权限
    """
    # 检查权限
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="只有管理员可以执行手动备份"
        )

    logger.info(f"手动备份触发，用户: {current_user.username}")

    try:
        backup_service = DatabaseBackupService()
        result = await backup_service.backup_database()

        return BackupResponse(
            success=result.get("success", False),
            message=result.get("message", "备份执行完成"),
            data=result.get("data")
        )

    except Exception as e:
        logger.error(f"手动备份失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"备份失败: {str(e)}"
        )


@router.get("/status", response_model=Dict[str, Any])
async def get_backup_status(
    current_user: User = Depends(get_current_user),
) -> Dict[str, Any]:
    """
    获取备份配置和状态信息
    """
    # 检查权限
    if current_user.role != "admin":
        raise HTTPException(
            status_code=403,
            detail="只有管理员可以查看备份状态"
        )

    try:
        from pathlib import Path
        from ef_core.config import get_settings

        settings = get_settings()
        backup_service = DatabaseBackupService()

        # 获取本地备份文件列表
        backup_files = list(backup_service.backup_dir.glob("euraflow_backup_*.sql.gz"))
        backup_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)

        local_backups = []
        total_size = 0
        for backup_file in backup_files[:10]:  # 只显示最新10个
            stat = backup_file.stat()
            total_size += stat.st_size
            local_backups.append({
                "filename": backup_file.name,
                "size_mb": round(stat.st_size / (1024 * 1024), 2),
                "created_at": stat.st_mtime,
            })

        # S3 配置状态
        s3_status = {
            "enabled": backup_service.s3_enabled,
            "bucket": settings.aws_s3_backup_bucket if backup_service.s3_enabled else None,
            "region": settings.aws_region if backup_service.s3_enabled else None,
            "retention_days": backup_service.s3_retention_days if backup_service.s3_enabled else None,
        }

        return {
            "local_backups": {
                "count": len(backup_files),
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "retention_days": backup_service.retention_days,
                "backup_dir": str(backup_service.backup_dir),
                "recent": local_backups,
            },
            "s3": s3_status,
            "schedule": "每天北京时间 01:00 和 13:00",
        }

    except Exception as e:
        logger.error(f"获取备份状态失败: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"获取状态失败: {str(e)}"
        )
