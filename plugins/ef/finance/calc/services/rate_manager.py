"""
费率管理器 - 版本化管理运费和平台费率
"""

import json
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, Any, List, Tuple
from ef_core.utils.logger import get_logger

from ..models.enums import ServiceType, Platform, FulfillmentModel

logger = get_logger(__name__)


class RateManager:
    """费率管理器"""

    def __init__(self, data_dir: Optional[Path] = None):
        """
        初始化费率管理器

        Args:
            data_dir: 数据目录路径
        """
        if data_dir is None:
            # 默认路径
            data_dir = Path(__file__).parent.parent / "data"

        self.data_dir = Path(data_dir)
        self.rates_dir = self.data_dir / "rates"
        self.platform_fees_dir = self.data_dir / "platform_fees"

        # 缓存配置
        self._cache: Dict[str, Any] = {}
        self._cache_ttl = 3600  # 1小时
        self._last_cache_clear = datetime.now()

        # 验证目录存在
        if not self.rates_dir.exists():
            logger.warning(f"Rates directory not found: {self.rates_dir}")
            self.rates_dir.mkdir(parents=True, exist_ok=True)

        if not self.platform_fees_dir.exists():
            logger.warning(f"Platform fees directory not found: {self.platform_fees_dir}")
            self.platform_fees_dir.mkdir(parents=True, exist_ok=True)

    def get_shipping_rate(
        self, carrier_service: str, service_type: ServiceType, calc_date: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        获取运费费率

        Args:
            carrier_service: 承运商服务
            service_type: 服务类型
            calc_date: 计算日期

        Returns:
            费率数据
        """
        calc_date = calc_date or datetime.now()

        # 检查缓存
        cache_key = f"shipping:{carrier_service}:{service_type.value}:{calc_date.date()}"
        if cache_key in self._cache:
            return self._cache[cache_key]  # type: ignore[no-any-return]

        # 查找有效的费率文件
        rate_file = self._find_effective_rate_file(self.rates_dir, carrier_service, calc_date)

        if not rate_file:
            raise ValueError(f"No rate found for {carrier_service} on {calc_date.date()}")

        # 加载费率数据
        with open(rate_file, "r", encoding="utf-8") as f:
            rates = json.load(f)

        # 验证服务类型存在
        service_key = service_type.value.upper()
        if service_key not in rates.get("services", {}):
            # 检查特殊服务
            if service_key not in rates.get("special_services", {}):
                raise ValueError(f"Service type {service_type} not found in {carrier_service} rates")
            rates["services"][service_key] = rates["special_services"][service_key]

        # 缓存结果
        self._cache[cache_key] = rates
        self._check_cache_expiry()

        return rates  # type: ignore[no-any-return]

    def get_platform_fee(
        self,
        platform: Platform,
        category_code: str,
        fulfillment_model: FulfillmentModel,
        calc_date: Optional[datetime] = None,
    ) -> Dict[str, Any]:
        """
        获取平台费率

        Args:
            platform: 平台
            category_code: 类目代码
            fulfillment_model: 履约模式
            calc_date: 计算日期

        Returns:
            平台费率数据
        """
        calc_date = calc_date or datetime.now()

        # 检查缓存
        cache_key = f"platform_fee:{platform.value}:{category_code}:{fulfillment_model.value}:{calc_date.date()}"
        if cache_key in self._cache:
            return self._cache[cache_key]  # type: ignore[no-any-return]

        # 查找有效的费率文件
        fee_file = self._find_effective_rate_file(self.platform_fees_dir, "fees", calc_date)

        if not fee_file:
            raise ValueError(f"No platform fee configuration found for {calc_date.date()}")

        # 加载费率数据
        with open(fee_file, "r", encoding="utf-8") as f:
            fees_data = json.load(f)

        # 获取平台配置
        platform_config = fees_data.get("platforms", {}).get(platform.value.upper())
        if not platform_config:
            raise ValueError(f"Platform {platform} not found in fee configuration")

        # 获取类目配置（如果找不到使用默认）
        category_config = platform_config.get("categories", {}).get(
            category_code, platform_config.get("categories", {}).get("default")
        )

        if not category_config:
            raise ValueError(f"Category {category_code} not found for platform {platform}")

        # 构造费率对象
        fee_rate_key = f"{fulfillment_model.value}_rate"
        fee_data = {
            "platform": platform.value,
            "category_code": category_code,
            "fulfillment_model": fulfillment_model.value,
            "fee_rate": category_config.get(fee_rate_key, category_config.get("fbo_rate")),
            "min_fee": category_config.get("min_fee"),
            "max_fee": category_config.get("max_fee"),
            "fixed_fee": category_config.get("fixed_fee", 0),
            "version": fees_data["meta"]["version"],
            "effective_from": fees_data["meta"]["effective_from"],
        }

        # 缓存结果
        self._cache[cache_key] = fee_data
        self._check_cache_expiry()

        return fee_data

    def _find_effective_rate_file(self, directory: Path, prefix: str, date: datetime) -> Optional[Path]:
        """
        查找指定日期有效的费率文件

        Args:
            directory: 搜索目录
            prefix: 文件前缀
            date: 目标日期

        Returns:
            找到的文件路径
        """
        # 文件名格式: prefix_v{version}_{YYYYMMDD}.json
        pattern = f"{prefix}_v*_*.json"
        files = list(directory.glob(pattern))

        if not files:
            logger.warning(f"No rate files found matching pattern: {pattern}")
            return None

        # 解析文件名并排序
        valid_files = []
        for file in files:
            match = re.match(r"(.+)_v(\d+)_(\d{8})\.json", file.name)
            if match:
                file_date = datetime.strptime(match.group(3), "%Y%m%d")
                if file_date <= date:
                    valid_files.append((file_date, file))

        if not valid_files:
            return None

        # 返回最新的有效文件
        valid_files.sort(key=lambda x: x[0], reverse=True)
        return valid_files[0][1]

    def get_versions(self) -> Dict[str, List[Dict[str, str]]]:
        """
        获取所有费率版本信息

        Returns:
            版本信息字典
        """
        versions: Dict[str, List[Dict[str, str]]] = {"shipping_rates": [], "platform_fees": []}

        # 获取运费费率版本
        for file in self.rates_dir.glob("*.json"):
            match = re.match(r"(.+)_v(\d+)_(\d{8})\.json", file.name)
            if match:
                versions["shipping_rates"].append(
                    {"carrier": match.group(1), "version": f"v{match.group(2)}", "effective_date": match.group(3)}
                )

        # 获取平台费版本
        for file in self.platform_fees_dir.glob("*.json"):
            match = re.match(r"(.+)_v(\d+)_(\d{8})\.json", file.name)
            if match:
                versions["platform_fees"].append(
                    {"type": match.group(1), "version": f"v{match.group(2)}", "effective_date": match.group(3)}
                )

        return versions

    def get_last_update(self) -> Dict[str, str]:
        """
        获取最后更新时间

        Returns:
            最后更新信息
        """
        last_update = {}

        # 获取最新的运费费率文件
        rate_files = list(self.rates_dir.glob("*.json"))
        if rate_files:
            latest_rate = max(rate_files, key=lambda x: x.stat().st_mtime)
            last_update["shipping_rates"] = datetime.fromtimestamp(latest_rate.stat().st_mtime).isoformat()

        # 获取最新的平台费文件
        fee_files = list(self.platform_fees_dir.glob("*.json"))
        if fee_files:
            latest_fee = max(fee_files, key=lambda x: x.stat().st_mtime)
            last_update["platform_fees"] = datetime.fromtimestamp(latest_fee.stat().st_mtime).isoformat()

        return last_update

    def validate_rate_file(self, file_path: Path) -> Tuple[bool, List[str]]:
        """
        验证费率文件的完整性和正确性

        Args:
            file_path: 文件路径

        Returns:
            (是否有效, 错误列表)
        """
        errors = []

        try:
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except json.JSONDecodeError as e:
            return False, [f"JSON解析错误: {e}"]
        except Exception as e:
            return False, [f"文件读取错误: {e}"]

        # 检查必要字段
        if "meta" not in data:
            errors.append("缺少'meta'字段")
        else:
            required_meta = ["carrier_service", "version", "effective_from"]
            for field in required_meta:
                if field not in data["meta"]:
                    errors.append(f"meta中缺少'{field}'字段")

        if "services" not in data:
            errors.append("缺少'services'字段")
        else:
            # 检查每个服务
            for service_name, service in data["services"].items():
                if "tiers" not in service:
                    errors.append(f"服务{service_name}缺少'tiers'字段")
                else:
                    # 检查阶梯连续性
                    tiers = service["tiers"]
                    for i in range(len(tiers) - 1):
                        if tiers[i]["max_kg"] != tiers[i + 1]["min_kg"]:
                            errors.append(f"服务{service_name}的阶梯{i}和{i+1}不连续")

                # 检查时效合理性
                if "delivery_days" in service:
                    days = service["delivery_days"]
                    if days.get("min", 0) > days.get("max", 999):
                        errors.append(f"服务{service_name}的时效范围不合理")

        return len(errors) == 0, errors

    def _check_cache_expiry(self) -> None:
        """检查并清理过期缓存"""
        now = datetime.now()
        if (now - self._last_cache_clear).total_seconds() > self._cache_ttl:
            self._cache.clear()
            self._last_cache_clear = now
            logger.debug("Rate cache cleared")

    def clear_cache(self) -> None:
        """手动清理缓存"""
        self._cache.clear()
        logger.info("Rate cache manually cleared")
