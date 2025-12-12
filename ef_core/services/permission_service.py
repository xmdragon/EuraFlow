"""
权限管理服务

提供 RBAC 权限管理功能：
- 角色管理（CRUD）
- 权限管理（CRUD）
- 角色权限分配
- 权限检查
"""
import re
import fnmatch
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass

from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ef_core.models.permission import Role, APIPermission, RolePermission
from ef_core.utils.logger import get_logger
from ef_core.utils.errors import NotFoundError, ValidationError, ForbiddenError


logger = get_logger(__name__)


@dataclass
class PermissionCheckResult:
    """权限检查结果"""
    allowed: bool
    permission_code: Optional[str] = None
    message: Optional[str] = None


class PermissionService:
    """权限管理服务"""

    # 权限映射缓存（应用启动时加载）
    _permission_cache: Dict[str, List[str]] = {}  # role_name -> [permission_codes]
    _path_mapping_cache: List[Tuple[str, str, str]] = []  # [(method, path_pattern, code)]
    _cache_loaded: bool = False

    def __init__(self):
        self.logger = logger

    # ========== 缓存管理 ==========

    async def load_cache(self, db: AsyncSession) -> None:
        """加载权限缓存"""
        try:
            # 加载所有活跃的权限
            stmt = select(APIPermission).where(APIPermission.is_active == True)
            result = await db.execute(stmt)
            permissions = result.scalars().all()

            # 构建路径映射缓存
            self._path_mapping_cache = [
                (p.http_method, p.path_pattern, p.code)
                for p in permissions
            ]

            # 加载角色权限映射
            stmt = (
                select(Role)
                .where(Role.is_active == True)
                .options(selectinload(Role.role_permissions).selectinload(RolePermission.permission))
            )
            result = await db.execute(stmt)
            roles = result.scalars().all()

            self._permission_cache = {}
            for role in roles:
                permission_codes = [
                    rp.permission.code
                    for rp in role.role_permissions
                    if rp.permission and rp.permission.is_active
                ]
                self._permission_cache[role.name] = permission_codes

            self._cache_loaded = True
            self.logger.info(
                f"Permission cache loaded: {len(self._path_mapping_cache)} APIs, "
                f"{len(self._permission_cache)} roles"
            )
        except Exception as e:
            self.logger.error(f"Failed to load permission cache: {e}", exc_info=True)
            raise

    def invalidate_cache(self) -> None:
        """使缓存失效"""
        self._permission_cache = {}
        self._path_mapping_cache = []
        self._cache_loaded = False
        self.logger.info("Permission cache invalidated")

    # ========== 权限检查 ==========

    async def get_user_permissions(
        self,
        db: AsyncSession,
        role_name: str
    ) -> List[str]:
        """获取用户角色的所有权限代码"""
        # 优先从缓存获取
        if self._cache_loaded and role_name in self._permission_cache:
            return self._permission_cache[role_name].copy()

        # 缓存未命中，从数据库查询
        stmt = (
            select(Role)
            .where(Role.name == role_name, Role.is_active == True)
            .options(selectinload(Role.role_permissions).selectinload(RolePermission.permission))
        )
        result = await db.execute(stmt)
        role = result.scalar_one_or_none()

        if not role:
            return []

        permission_codes = [
            rp.permission.code
            for rp in role.role_permissions
            if rp.permission and rp.permission.is_active
        ]

        return permission_codes

    def check_permission(
        self,
        user_permissions: List[str],
        required_permission: str
    ) -> bool:
        """检查用户是否拥有指定权限

        Args:
            user_permissions: 用户拥有的权限代码列表
            required_permission: 所需的权限代码

        Returns:
            是否拥有权限
        """
        if not user_permissions or not required_permission:
            return False

        # 1. 精确匹配
        if required_permission in user_permissions:
            return True

        # 2. 通配符匹配 (ozon.orders.* 匹配 ozon.orders.list)
        for perm in user_permissions:
            if perm.endswith(".*"):
                prefix = perm[:-2]  # 去掉 .*
                if required_permission.startswith(prefix + "."):
                    return True
            # 支持双层通配符 (ozon.* 匹配 ozon.orders.list)
            elif perm.endswith(".*"):
                parts = perm[:-2].split(".")
                required_parts = required_permission.split(".")
                if len(required_parts) > len(parts):
                    if all(p == r for p, r in zip(parts, required_parts[:len(parts)])):
                        return True

        return False

    def find_permission_code(
        self,
        method: str,
        path: str
    ) -> Optional[str]:
        """根据请求方法和路径查找权限代码

        Args:
            method: HTTP 方法 (GET, POST, PUT, DELETE)
            path: 请求路径

        Returns:
            权限代码，未找到返回 None
        """
        for perm_method, pattern, code in self._path_mapping_cache:
            # 方法匹配（* 匹配所有方法）
            if perm_method != "*" and perm_method != method:
                continue

            # 路径匹配
            if self._match_path(pattern, path):
                return code

        return None

    def _match_path(self, pattern: str, path: str) -> bool:
        """路径模式匹配

        支持的模式：
        - /api/ef/v1/ozon/orders - 精确匹配
        - /api/ef/v1/ozon/orders/* - 匹配 orders 下的任意子路径
        - /api/ef/v1/ozon/orders/{id} - 匹配带路径参数的路径
        """
        # 将 {param} 转换为正则表达式
        regex_pattern = pattern
        regex_pattern = re.sub(r'\{[^}]+\}', r'[^/]+', regex_pattern)
        # 将 * 转换为正则表达式
        regex_pattern = regex_pattern.replace('*', '.*')
        # 添加锚点
        regex_pattern = f"^{regex_pattern}$"

        try:
            return bool(re.match(regex_pattern, path))
        except re.error:
            return False

    async def check_api_access(
        self,
        db: AsyncSession,
        method: str,
        path: str,
        user_permissions: List[str]
    ) -> PermissionCheckResult:
        """检查 API 访问权限

        Args:
            db: 数据库会话
            method: HTTP 方法
            path: 请求路径
            user_permissions: 用户权限列表

        Returns:
            PermissionCheckResult
        """
        # 查找对应的权限代码
        permission_code = self.find_permission_code(method, path)

        if not permission_code:
            # 未配置权限的 API，白名单模式下默认拒绝
            return PermissionCheckResult(
                allowed=False,
                permission_code=None,
                message="该 API 未配置权限"
            )

        # 检查权限
        has_permission = self.check_permission(user_permissions, permission_code)

        if has_permission:
            return PermissionCheckResult(
                allowed=True,
                permission_code=permission_code
            )
        else:
            return PermissionCheckResult(
                allowed=False,
                permission_code=permission_code,
                message=f"需要权限: {permission_code}"
            )

    # ========== 角色管理 ==========

    async def list_roles(
        self,
        db: AsyncSession,
        include_inactive: bool = False
    ) -> List[Role]:
        """获取角色列表"""
        stmt = select(Role).order_by(Role.priority.desc(), Role.id)

        if not include_inactive:
            stmt = stmt.where(Role.is_active == True)

        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def get_role(
        self,
        db: AsyncSession,
        role_id: int
    ) -> Optional[Role]:
        """获取角色详情"""
        return await db.get(Role, role_id)

    async def get_role_by_name(
        self,
        db: AsyncSession,
        name: str
    ) -> Optional[Role]:
        """根据名称获取角色"""
        stmt = select(Role).where(Role.name == name)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def create_role(
        self,
        db: AsyncSession,
        name: str,
        display_name: str,
        description: Optional[str] = None,
        priority: int = 0
    ) -> Role:
        """创建角色"""
        # 检查名称是否已存在
        existing = await self.get_role_by_name(db, name)
        if existing:
            raise ValidationError(
                code="ROLE_NAME_EXISTS",
                detail=f"角色名称 '{name}' 已存在"
            )

        role = Role(
            name=name,
            display_name=display_name,
            description=description,
            is_system=False,
            is_active=True,
            priority=priority
        )
        db.add(role)
        await db.flush()

        self.logger.info(f"Created role: {name}")
        return role

    async def update_role(
        self,
        db: AsyncSession,
        role_id: int,
        display_name: Optional[str] = None,
        description: Optional[str] = None,
        priority: Optional[int] = None,
        is_active: Optional[bool] = None
    ) -> Role:
        """更新角色"""
        role = await self.get_role(db, role_id)
        if not role:
            raise NotFoundError(
                code="ROLE_NOT_FOUND",
                detail=f"角色 {role_id} 不存在"
            )

        if display_name is not None:
            role.display_name = display_name
        if description is not None:
            role.description = description
        if priority is not None:
            role.priority = priority
        if is_active is not None:
            role.is_active = is_active

        await db.flush()
        self.invalidate_cache()

        self.logger.info(f"Updated role: {role.name}")
        return role

    async def delete_role(
        self,
        db: AsyncSession,
        role_id: int
    ) -> bool:
        """删除角色（系统角色不可删除）"""
        role = await self.get_role(db, role_id)
        if not role:
            raise NotFoundError(
                code="ROLE_NOT_FOUND",
                detail=f"角色 {role_id} 不存在"
            )

        if role.is_system:
            raise ForbiddenError(
                code="CANNOT_DELETE_SYSTEM_ROLE",
                detail=f"系统角色 '{role.name}' 不可删除"
            )

        await db.delete(role)
        await db.flush()
        self.invalidate_cache()

        self.logger.info(f"Deleted role: {role.name}")
        return True

    # ========== 权限管理 ==========

    async def list_permissions(
        self,
        db: AsyncSession,
        module: Optional[str] = None,
        include_inactive: bool = False
    ) -> List[APIPermission]:
        """获取权限列表"""
        stmt = select(APIPermission).order_by(
            APIPermission.module,
            APIPermission.category,
            APIPermission.sort_order
        )

        if module:
            stmt = stmt.where(APIPermission.module == module)

        if not include_inactive:
            stmt = stmt.where(APIPermission.is_active == True)

        result = await db.execute(stmt)
        return list(result.scalars().all())

    async def list_modules(
        self,
        db: AsyncSession
    ) -> List[str]:
        """获取所有模块列表"""
        stmt = (
            select(APIPermission.module)
            .where(APIPermission.is_active == True)
            .distinct()
            .order_by(APIPermission.module)
        )
        result = await db.execute(stmt)
        return [row[0] for row in result.fetchall()]

    async def get_permission(
        self,
        db: AsyncSession,
        permission_id: int
    ) -> Optional[APIPermission]:
        """获取权限详情"""
        return await db.get(APIPermission, permission_id)

    async def get_permission_by_code(
        self,
        db: AsyncSession,
        code: str
    ) -> Optional[APIPermission]:
        """根据代码获取权限"""
        stmt = select(APIPermission).where(APIPermission.code == code)
        result = await db.execute(stmt)
        return result.scalar_one_or_none()

    async def create_permission(
        self,
        db: AsyncSession,
        code: str,
        name: str,
        module: str,
        http_method: str,
        path_pattern: str,
        category: Optional[str] = None,
        description: Optional[str] = None,
        is_public: bool = False,
        sort_order: int = 0
    ) -> APIPermission:
        """创建权限"""
        # 检查代码是否已存在
        existing = await self.get_permission_by_code(db, code)
        if existing:
            raise ValidationError(
                code="PERMISSION_CODE_EXISTS",
                detail=f"权限代码 '{code}' 已存在"
            )

        permission = APIPermission(
            code=code,
            name=name,
            module=module,
            category=category,
            http_method=http_method,
            path_pattern=path_pattern,
            description=description,
            is_public=is_public,
            is_active=True,
            sort_order=sort_order
        )
        db.add(permission)
        await db.flush()
        self.invalidate_cache()

        self.logger.info(f"Created permission: {code}")
        return permission

    async def update_permission(
        self,
        db: AsyncSession,
        permission_id: int,
        **kwargs
    ) -> APIPermission:
        """更新权限"""
        permission = await self.get_permission(db, permission_id)
        if not permission:
            raise NotFoundError(
                code="PERMISSION_NOT_FOUND",
                detail=f"权限 {permission_id} 不存在"
            )

        allowed_fields = ['name', 'description', 'category', 'http_method',
                         'path_pattern', 'is_public', 'is_active', 'sort_order']

        for field, value in kwargs.items():
            if field in allowed_fields and value is not None:
                setattr(permission, field, value)

        await db.flush()
        self.invalidate_cache()

        self.logger.info(f"Updated permission: {permission.code}")
        return permission

    async def delete_permission(
        self,
        db: AsyncSession,
        permission_id: int
    ) -> bool:
        """删除权限"""
        permission = await self.get_permission(db, permission_id)
        if not permission:
            raise NotFoundError(
                code="PERMISSION_NOT_FOUND",
                detail=f"权限 {permission_id} 不存在"
            )

        await db.delete(permission)
        await db.flush()
        self.invalidate_cache()

        self.logger.info(f"Deleted permission: {permission.code}")
        return True

    # ========== 角色权限分配 ==========

    async def get_role_permissions(
        self,
        db: AsyncSession,
        role_id: int
    ) -> List[str]:
        """获取角色的权限代码列表"""
        role = await db.get(
            Role,
            role_id,
            options=[selectinload(Role.role_permissions).selectinload(RolePermission.permission)]
        )

        if not role:
            raise NotFoundError(
                code="ROLE_NOT_FOUND",
                detail=f"角色 {role_id} 不存在"
            )

        return [
            rp.permission.code
            for rp in role.role_permissions
            if rp.permission
        ]

    async def set_role_permissions(
        self,
        db: AsyncSession,
        role_id: int,
        permission_codes: List[str],
        granted_by: Optional[int] = None
    ) -> int:
        """设置角色权限（完全替换）

        Args:
            db: 数据库会话
            role_id: 角色ID
            permission_codes: 权限代码列表
            granted_by: 授权人ID

        Returns:
            分配的权限数量
        """
        role = await self.get_role(db, role_id)
        if not role:
            raise NotFoundError(
                code="ROLE_NOT_FOUND",
                detail=f"角色 {role_id} 不存在"
            )

        # 删除现有权限
        await db.execute(
            delete(RolePermission).where(RolePermission.role_id == role_id)
        )

        # 查找权限ID
        if permission_codes:
            stmt = select(APIPermission).where(APIPermission.code.in_(permission_codes))
            result = await db.execute(stmt)
            permissions = result.scalars().all()

            # 创建新的关联
            for permission in permissions:
                role_permission = RolePermission(
                    role_id=role_id,
                    permission_id=permission.id,
                    granted_by=granted_by
                )
                db.add(role_permission)

            await db.flush()
            count = len(permissions)
        else:
            count = 0

        self.invalidate_cache()
        self.logger.info(f"Set {count} permissions for role {role.name}")
        return count

    async def add_role_permission(
        self,
        db: AsyncSession,
        role_id: int,
        permission_code: str,
        granted_by: Optional[int] = None
    ) -> bool:
        """为角色添加单个权限"""
        role = await self.get_role(db, role_id)
        if not role:
            raise NotFoundError(
                code="ROLE_NOT_FOUND",
                detail=f"角色 {role_id} 不存在"
            )

        permission = await self.get_permission_by_code(db, permission_code)
        if not permission:
            raise NotFoundError(
                code="PERMISSION_NOT_FOUND",
                detail=f"权限 '{permission_code}' 不存在"
            )

        # 检查是否已存在
        stmt = select(RolePermission).where(
            RolePermission.role_id == role_id,
            RolePermission.permission_id == permission.id
        )
        result = await db.execute(stmt)
        if result.scalar_one_or_none():
            return False  # 已存在

        role_permission = RolePermission(
            role_id=role_id,
            permission_id=permission.id,
            granted_by=granted_by
        )
        db.add(role_permission)
        await db.flush()
        self.invalidate_cache()

        return True

    async def remove_role_permission(
        self,
        db: AsyncSession,
        role_id: int,
        permission_code: str
    ) -> bool:
        """移除角色的单个权限"""
        permission = await self.get_permission_by_code(db, permission_code)
        if not permission:
            return False

        result = await db.execute(
            delete(RolePermission).where(
                RolePermission.role_id == role_id,
                RolePermission.permission_id == permission.id
            )
        )
        await db.flush()

        if result.rowcount > 0:
            self.invalidate_cache()
            return True
        return False


# 单例
_permission_service: Optional[PermissionService] = None


def get_permission_service() -> PermissionService:
    """获取权限服务实例"""
    global _permission_service
    if _permission_service is None:
        _permission_service = PermissionService()
    return _permission_service
