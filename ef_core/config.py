"""
EuraFlow Configuration Management
遵循约束：环境变量前缀 EF__
"""
from typing import Optional
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, validator
from functools import lru_cache


class Settings(BaseSettings):
    """全局配置类"""
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="EF__",
        case_sensitive=False
    )
    
    # Database
    db_host: str = Field(default="localhost")
    db_port: int = Field(default=5432)
    db_name: str = Field(default="euraflow")
    db_user: str = Field(default="euraflow")
    db_password: str = Field(default="")
    db_pool_size: int = Field(default=20)
    db_max_overflow: int = Field(default=40)
    
    # Redis
    redis_host: str = Field(default="localhost")
    redis_port: int = Field(default=6379)
    redis_db: int = Field(default=0)
    redis_password: Optional[str] = Field(default=None)
    
    # API Settings
    api_host: str = Field(default="0.0.0.0")
    api_port: int = Field(default=8000)
    api_prefix: str = Field(default="/api/ef/v1")
    api_title: str = Field(default="EuraFlow API")
    api_version: str = Field(default="1.0.0")
    api_debug: bool = Field(default=False)
    
    # Security
    secret_key: str = Field(default="change-me-in-production")
    algorithm: str = Field(default="HS256")
    access_token_expire_minutes: int = Field(default=30)
    
    # Celery
    celery_broker_url: str = Field(default="redis://localhost:6379/0")
    celery_result_backend: str = Field(default="redis://localhost:6379/1")
    celery_task_default_queue: str = Field(default="ef_default")
    celery_task_serializer: str = Field(default="json")
    celery_result_serializer: str = Field(default="json")
    celery_accept_content: list[str] = Field(default=["json"])
    celery_timezone: str = Field(default="UTC")
    
    # Monitoring
    log_level: str = Field(default="INFO")
    log_format: str = Field(default="json")  # json or text
    metrics_enabled: bool = Field(default=True)
    metrics_prefix: str = Field(default="ef")
    trace_enabled: bool = Field(default=True)
    
    # Plugin Settings
    plugin_dir: str = Field(default="plugins")
    plugin_auto_load: bool = Field(default=True)
    plugin_config_file: str = Field(default="plugin.json")
    
    # Rate Limiting
    rate_limit_enabled: bool = Field(default=True)
    rate_limit_default: str = Field(default="60/minute")
    
    # 守护阈值
    inventory_default_threshold: int = Field(default=5)
    price_min_margin: float = Field(default=0.2)

    # AWS S3 Backup
    aws_access_key_id: Optional[str] = Field(default=None)
    aws_secret_access_key: Optional[str] = Field(default=None)
    aws_region: str = Field(default="us-east-1")
    aws_s3_backup_bucket: Optional[str] = Field(default=None)
    backup_retention_days: int = Field(default=30)
    
    @validator("api_prefix")
    def validate_api_prefix(cls, v):
        """确保 API 前缀符合规范"""
        if not v.startswith("/api/ef/"):
            raise ValueError("API prefix must start with /api/ef/")
        return v
    
    @validator("metrics_prefix")
    def validate_metrics_prefix(cls, v):
        """确保指标前缀符合规范"""
        if not v.startswith("ef"):
            raise ValueError("Metrics prefix must start with 'ef'")
        return v
    
    @property
    def database_url(self) -> str:
        """构建数据库连接字符串"""
        return f"postgresql+asyncpg://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"
    
    @property
    def sync_database_url(self) -> str:
        """构建同步数据库连接字符串（用于 Alembic）"""
        return f"postgresql://{self.db_user}:{self.db_password}@{self.db_host}:{self.db_port}/{self.db_name}"
    
    @property
    def redis_url(self) -> str:
        """构建 Redis 连接字符串"""
        password = f":{self.redis_password}@" if self.redis_password else ""
        return f"redis://{password}{self.redis_host}:{self.redis_port}/{self.redis_db}"


@lru_cache()
def get_settings() -> Settings:
    """获取配置单例"""
    return Settings()


# 插件配置基类
class PluginConfig(BaseSettings):
    """插件配置基类"""
    enabled: bool = Field(default=True)
    version: str = Field(default="1.0.0")
    
    # 通用限流配置
    rate_limit: Optional[str] = Field(default=None)
    concurrency: int = Field(default=2)
    timeout: int = Field(default=10)
    retry_max: int = Field(default=5)
    retry_backoff_base: int = Field(default=1)
