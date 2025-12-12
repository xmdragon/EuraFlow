"""
权限管理 API 路由
"""
from typing import Optional, List
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ef_core.database import get_async_session
from ef_core.models.users import User
from ef_core.models.permission import Role, APIPermission
from ef_core.services.permission_service import get_permission_service
from ef_core.services.permission_scanner import CATEGORY_NAMES_CN, MODULE_NAMES_CN
from ef_core.middleware.auth import require_role
from ef_core.utils.logger import get_logger

logger = get_logger(__name__)

router = APIRouter(prefix="/permissions", tags=["Permissions"])


# ========== 请求/响应模型 ==========

class RoleBase(BaseModel):
    """角色基础模型"""
    name: str = Field(..., min_length=2, max_length=50, description="角色标识符")
    display_name: str = Field(..., min_length=2, max_length=100, description="显示名称")
    description: Optional[str] = Field(None, description="角色描述")
    priority: int = Field(default=0, description="优先级")


class CreateRoleRequest(RoleBase):
    """创建角色请求"""
    pass


class UpdateRoleRequest(BaseModel):
    """更新角色请求"""
    display_name: Optional[str] = Field(None, min_length=2, max_length=100)
    description: Optional[str] = None
    priority: Optional[int] = None
    is_active: Optional[bool] = None


class RoleResponse(BaseModel):
    """角色响应"""
    id: int
    name: str
    display_name: str
    description: Optional[str]
    is_system: bool
    is_active: bool
    priority: int

    class Config:
        from_attributes = True


class PermissionBase(BaseModel):
    """权限基础模型"""
    code: str = Field(..., description="权限代码")
    name: str = Field(..., description="权限名称")
    module: str = Field(..., description="模块")
    category: Optional[str] = Field(None, description="分类")
    http_method: str = Field(..., description="HTTP方法")
    path_pattern: str = Field(..., description="路径模式")
    description: Optional[str] = None
    is_public: bool = False
    sort_order: int = 0


class CreatePermissionRequest(PermissionBase):
    """创建权限请求"""
    pass


class UpdatePermissionRequest(BaseModel):
    """更新权限请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    http_method: Optional[str] = None
    path_pattern: Optional[str] = None
    is_public: Optional[bool] = None
    is_active: Optional[bool] = None
    sort_order: Optional[int] = None


class PermissionResponse(BaseModel):
    """权限响应"""
    id: int
    code: str
    name: str
    description: Optional[str]
    module: str
    category: Optional[str]
    http_method: str
    path_pattern: str
    is_public: bool
    is_active: bool
    sort_order: int

    class Config:
        from_attributes = True


class SetPermissionsRequest(BaseModel):
    """设置角色权限请求"""
    permission_codes: List[str] = Field(..., description="权限代码列表")


class PermissionTreeItem(BaseModel):
    """权限树节点"""
    key: str
    title: str
    children: Optional[List["PermissionTreeItem"]] = None
    is_leaf: bool = False


# ========== 角色管理 ==========

@router.get("/roles", response_model=List[RoleResponse])
async def list_roles(
    include_inactive: bool = False,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """获取角色列表"""
    service = get_permission_service()
    roles = await service.list_roles(db, include_inactive=include_inactive)
    return roles


@router.post("/roles", response_model=RoleResponse, status_code=201)
async def create_role(
    request: CreateRoleRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """创建角色"""
    service = get_permission_service()
    role = await service.create_role(
        db,
        name=request.name,
        display_name=request.display_name,
        description=request.description,
        priority=request.priority
    )
    await db.commit()
    return role


@router.get("/roles/{role_id}", response_model=RoleResponse)
async def get_role(
    role_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """获取角色详情"""
    service = get_permission_service()
    role = await service.get_role(db, role_id)
    if not role:
        raise HTTPException(status_code=404, detail="角色不存在")
    return role


@router.put("/roles/{role_id}", response_model=RoleResponse)
async def update_role(
    role_id: int,
    request: UpdateRoleRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """更新角色"""
    service = get_permission_service()
    role = await service.update_role(
        db,
        role_id,
        display_name=request.display_name,
        description=request.description,
        priority=request.priority,
        is_active=request.is_active
    )
    await db.commit()
    return role


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """删除角色（系统角色不可删除）"""
    service = get_permission_service()
    await service.delete_role(db, role_id)
    await db.commit()
    return {"ok": True, "message": "角色已删除"}


# ========== 权限管理 ==========

@router.get("/apis", response_model=List[PermissionResponse])
async def list_permissions(
    module: Optional[str] = None,
    include_inactive: bool = False,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """获取所有 API 权限列表"""
    service = get_permission_service()
    permissions = await service.list_permissions(
        db,
        module=module,
        include_inactive=include_inactive
    )
    return permissions


@router.get("/apis/modules")
async def list_modules(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """获取所有模块列表"""
    service = get_permission_service()
    modules = await service.list_modules(db)
    return {"modules": modules}


@router.get("/apis/tree")
async def get_permission_tree(
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """获取权限树结构（用于前端树形组件）"""
    service = get_permission_service()
    permissions = await service.list_permissions(db)

    # 按模块和分类组织权限树
    tree = {}
    for perm in permissions:
        module = perm.module
        category = perm.category or "其他"

        if module not in tree:
            tree[module] = {"children": {}}

        if category not in tree[module]["children"]:
            tree[module]["children"][category] = []

        tree[module]["children"][category].append({
            "key": perm.code,
            "title": f"{perm.name} {perm.path_pattern}",
            "is_leaf": True,
            "method": perm.http_method,
            "path": perm.path_pattern
        })

    # 转换为树形结构
    result = []

    for module, data in sorted(tree.items()):
        module_node = {
            "key": module,
            "title": MODULE_NAMES_CN.get(module, module),
            "children": []
        }

        for category, perms in sorted(data["children"].items()):
            category_node = {
                "key": f"{module}.{category}",
                "title": CATEGORY_NAMES_CN.get(category, category),
                "children": perms
            }
            module_node["children"].append(category_node)

        result.append(module_node)

    return {"tree": result}


@router.post("/apis", response_model=PermissionResponse, status_code=201)
async def create_permission(
    request: CreatePermissionRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """创建权限"""
    service = get_permission_service()
    permission = await service.create_permission(
        db,
        code=request.code,
        name=request.name,
        module=request.module,
        category=request.category,
        http_method=request.http_method,
        path_pattern=request.path_pattern,
        description=request.description,
        is_public=request.is_public,
        sort_order=request.sort_order
    )
    await db.commit()
    return permission


@router.put("/apis/{permission_id}", response_model=PermissionResponse)
async def update_permission(
    permission_id: int,
    request: UpdatePermissionRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """更新权限"""
    service = get_permission_service()
    permission = await service.update_permission(
        db,
        permission_id,
        **request.model_dump(exclude_unset=True)
    )
    await db.commit()
    return permission


@router.delete("/apis/{permission_id}")
async def delete_permission(
    permission_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """删除权限"""
    service = get_permission_service()
    await service.delete_permission(db, permission_id)
    await db.commit()
    return {"ok": True, "message": "权限已删除"}


# ========== 角色权限分配 ==========

@router.get("/roles/{role_id}/permissions")
async def get_role_permissions(
    role_id: int,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """获取角色的权限代码列表"""
    service = get_permission_service()
    permission_codes = await service.get_role_permissions(db, role_id)
    return {"permission_codes": permission_codes}


@router.put("/roles/{role_id}/permissions")
async def set_role_permissions(
    role_id: int,
    request: SetPermissionsRequest,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """设置角色权限（完全替换）"""
    service = get_permission_service()
    count = await service.set_role_permissions(
        db,
        role_id,
        request.permission_codes,
        granted_by=current_user.id
    )
    await db.commit()

    # 使缓存失效，下次请求时重新加载
    service.invalidate_cache()

    return {
        "ok": True,
        "message": f"已分配 {count} 个权限",
        "count": count
    }


@router.post("/roles/{role_id}/permissions/{permission_code}")
async def add_role_permission(
    role_id: int,
    permission_code: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """为角色添加单个权限"""
    service = get_permission_service()
    added = await service.add_role_permission(
        db,
        role_id,
        permission_code,
        granted_by=current_user.id
    )
    await db.commit()

    if added:
        return {"ok": True, "message": "权限已添加"}
    else:
        return {"ok": True, "message": "权限已存在"}


@router.delete("/roles/{role_id}/permissions/{permission_code}")
async def remove_role_permission(
    role_id: int,
    permission_code: str,
    current_user: User = Depends(require_role("admin")),
    db: AsyncSession = Depends(get_async_session)
):
    """移除角色的单个权限"""
    service = get_permission_service()
    removed = await service.remove_role_permission(db, role_id, permission_code)
    await db.commit()

    if removed:
        return {"ok": True, "message": "权限已移除"}
    else:
        return {"ok": False, "message": "权限不存在"}


