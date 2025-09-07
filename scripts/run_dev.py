#!/usr/bin/env python3
"""
EuraFlow 开发环境启动脚本
同时启动 API 服务器、Celery Worker 和 Beat 调度器
"""
import os
import sys
import signal
import asyncio
import subprocess
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor


class ServiceManager:
    """服务管理器"""
    
    def __init__(self):
        self.services = {}
        self.running = False
        
        # 确定 Python 路径
        if os.name == "nt":  # Windows
            self.python_path = "venv/Scripts/python"
            self.celery_path = "venv/Scripts/celery"
        else:  # Unix/Linux/macOS
            self.python_path = "venv/bin/python"
            self.celery_path = "venv/bin/celery"
    
    def add_service(self, name, command, description):
        """添加服务"""
        self.services[name] = {
            "command": command,
            "description": description,
            "process": None
        }
    
    def start_service(self, name):
        """启动单个服务"""
        service = self.services[name]
        print(f"🚀 启动 {service['description']}")
        
        try:
            # 设置环境变量
            env = os.environ.copy()
            env["PYTHONPATH"] = "."
            
            process = subprocess.Popen(
                service["command"],
                shell=True,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=True,
                bufsize=1
            )
            
            service["process"] = process
            print(f"✅ {service['description']} 已启动 (PID: {process.pid})")
            
            return process
            
        except Exception as e:
            print(f"❌ 启动 {service['description']} 失败: {e}")
            return None
    
    def stop_service(self, name):
        """停止单个服务"""
        service = self.services[name]
        if service["process"]:
            print(f"🛑 停止 {service['description']}")
            try:
                service["process"].terminate()
                service["process"].wait(timeout=5)
            except subprocess.TimeoutExpired:
                service["process"].kill()
            except Exception as e:
                print(f"⚠️  停止服务时出错: {e}")
            finally:
                service["process"] = None
    
    def stop_all(self):
        """停止所有服务"""
        print("\n🛑 停止所有服务...")
        for name in self.services:
            self.stop_service(name)
        self.running = False
    
    def monitor_service(self, name):
        """监控服务输出"""
        service = self.services[name]
        process = service["process"]
        
        if not process:
            return
        
        print(f"📊 监控 {service['description']}")
        
        try:
            while process.poll() is None and self.running:
                line = process.stdout.readline()
                if line:
                    # 过滤和格式化输出
                    line = line.strip()
                    if line and not self._should_filter_log(line):
                        print(f"[{name}] {line}")
        except Exception as e:
            print(f"⚠️  监控服务时出错: {e}")
        
        if process.poll() is not None and self.running:
            print(f"❌ {service['description']} 意外退出 (退出码: {process.poll()})")
    
    def _should_filter_log(self, line):
        """过滤不重要的日志"""
        filters = [
            "INFO:     Started server process",
            "INFO:     Waiting for application startup",
            "INFO:     Application startup complete",
            "INFO:     Uvicorn running on",
        ]
        
        return any(f in line for f in filters)
    
    async def run_all(self):
        """启动所有服务"""
        print("🎯 EuraFlow 开发环境启动器")
        print("=" * 50)
        
        # 检查环境
        if not self._check_environment():
            return False
        
        # 设置信号处理
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)
        
        self.running = True
        
        # 启动所有服务
        started_services = []
        for name in self.services:
            if self.start_service(name):
                started_services.append(name)
            else:
                print(f"❌ 无法启动 {name}，退出")
                self.stop_all()
                return False
        
        if not started_services:
            print("❌ 没有服务启动成功")
            return False
        
        print("\n" + "=" * 50)
        print("🎉 所有服务已启动!")
        print("📝 服务信息:")
        for name in started_services:
            service = self.services[name]
            print(f"   - {service['description']}")
        
        print("\n💡 提示:")
        print("   - API 文档: http://localhost:8000/docs")
        print("   - 健康检查: http://localhost:8000/healthz")
        print("   - 指标监控: http://localhost:8000/api/ef/v1/system/metrics")
        print("   - 按 Ctrl+C 停止所有服务")
        
        # 并行监控所有服务
        with ThreadPoolExecutor() as executor:
            futures = [
                executor.submit(self.monitor_service, name)
                for name in started_services
            ]
            
            try:
                # 等待所有监控任务
                for future in futures:
                    future.result()
            except KeyboardInterrupt:
                print("\n🛑 收到中断信号")
            finally:
                self.stop_all()
        
        print("👋 所有服务已停止")
        return True
    
    def _check_environment(self):
        """检查环境"""
        print("📋 检查环境...")
        
        # 检查虚拟环境
        if not Path("venv").exists():
            print("❌ 虚拟环境不存在，请先运行 python scripts/setup_dev.py")
            return False
        
        # 检查 .env 文件
        if not Path(".env").exists():
            print("❌ .env 文件不存在，请先运行 python scripts/setup_dev.py")
            return False
        
        # 检查 Python 可执行文件
        if not Path(self.python_path).exists():
            print(f"❌ Python 可执行文件不存在: {self.python_path}")
            return False
        
        print("✅ 环境检查通过")
        return True
    
    def _signal_handler(self, signum, frame):
        """信号处理器"""
        print(f"\n🔔 收到信号 {signum}")
        self.running = False


def main():
    """主函数"""
    manager = ServiceManager()
    
    # 添加服务
    manager.add_service(
        "api",
        f"{manager.python_path} -m ef_core.app",
        "FastAPI 服务器"
    )
    
    manager.add_service(
        "worker",
        f"{manager.celery_path} -A ef_core.tasks.celery_app worker --loglevel=info --concurrency=4",
        "Celery Worker"
    )
    
    manager.add_service(
        "beat",
        f"{manager.celery_path} -A ef_core.tasks.celery_app beat --loglevel=info",
        "Celery Beat 调度器"
    )
    
    # 运行所有服务
    try:
        success = asyncio.run(manager.run_all())
        sys.exit(0 if success else 1)
    except KeyboardInterrupt:
        print("\n👋 用户中断")
        sys.exit(0)
    except Exception as e:
        print(f"\n❌ 运行时错误: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()