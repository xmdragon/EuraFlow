"""
配置系统测试
"""
import pytest
import os
from ef_core.config import Settings, get_settings


class TestSettings:
    """配置测试类"""
    
    def test_default_values(self):
        """测试默认值"""
        settings = Settings()
        
        assert settings.db_host == "localhost"
        assert settings.db_port == 5432
        assert settings.api_prefix == "/api/ef/v1"
        assert settings.metrics_prefix == "ef"
        assert settings.celery_timezone == "UTC"
    
    def test_api_prefix_validation(self):
        """测试 API 前缀验证"""
        with pytest.raises(ValueError, match="API prefix must start with /api/ef/"):
            Settings(api_prefix="/invalid/prefix")
    
    def test_metrics_prefix_validation(self):
        """测试指标前缀验证"""
        with pytest.raises(ValueError, match="Metrics prefix must start with 'ef'"):
            Settings(metrics_prefix="invalid")
    
    def test_database_url_property(self):
        """测试数据库 URL 生成"""
        settings = Settings(
            db_user="test_user",
            db_password="test_pass", 
            db_host="test_host",
            db_port=5433,
            db_name="test_db"
        )
        
        expected_url = "postgresql+asyncpg://test_user:test_pass@test_host:5433/test_db"
        assert settings.database_url == expected_url
    
    def test_sync_database_url_property(self):
        """测试同步数据库 URL 生成"""
        settings = Settings(
            db_user="test_user",
            db_password="test_pass",
            db_host="test_host", 
            db_port=5433,
            db_name="test_db"
        )
        
        expected_url = "postgresql://test_user:test_pass@test_host:5433/test_db"
        assert settings.sync_database_url == expected_url
    
    def test_redis_url_property(self):
        """测试 Redis URL 生成"""
        # 无密码
        settings = Settings(
            redis_host="test_host",
            redis_port=6380,
            redis_db=1
        )
        
        expected_url = "redis://test_host:6380/1"
        assert settings.redis_url == expected_url
        
        # 有密码
        settings = Settings(
            redis_host="test_host",
            redis_port=6380,
            redis_db=1,
            redis_password="test_pass"
        )
        
        expected_url = "redis://:test_pass@test_host:6380/1"
        assert settings.redis_url == expected_url
    
    def test_environment_variables(self, monkeypatch):
        """测试环境变量读取"""
        # 设置环境变量
        monkeypatch.setenv("EF__DB_HOST", "env_host")
        monkeypatch.setenv("EF__DB_PORT", "5434")
        monkeypatch.setenv("EF__API_DEBUG", "true")
        
        settings = Settings()
        
        assert settings.db_host == "env_host"
        assert settings.db_port == 5434
        assert settings.api_debug is True
    
    def test_get_settings_singleton(self):
        """测试配置单例"""
        settings1 = get_settings()
        settings2 = get_settings()
        
        # 应该是同一个实例
        assert settings1 is settings2