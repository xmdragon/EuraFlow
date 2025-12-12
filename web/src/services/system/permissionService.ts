/**
 * 权限管理 API 服务
 */
import axios from '@/services/axios';

// ========== 类型定义 ==========

export interface Role {
  id: number;
  name: string;
  display_name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  priority: number;
}

export interface APIPermission {
  id: number;
  code: string;
  name: string;
  description: string | null;
  module: string;
  category: string | null;
  http_method: string;
  path_pattern: string;
  is_public: boolean;
  is_active: boolean;
  sort_order: number;
}

export interface PermissionTreeNode {
  key: string;
  title: string;
  children?: PermissionTreeNode[];
  is_leaf?: boolean;
  method?: string;
  path?: string;
}

export interface CreateRoleRequest {
  name: string;
  display_name: string;
  description?: string;
  priority?: number;
}

export interface UpdateRoleRequest {
  display_name?: string;
  description?: string;
  priority?: number;
  is_active?: boolean;
}

// ========== 角色管理 API ==========

/**
 * 获取角色列表
 */
export async function listRoles(includeInactive = false): Promise<Role[]> {
  const response = await axios.get('/api/ef/v1/permissions/roles', {
    params: { include_inactive: includeInactive },
  });
  return response.data;
}

/**
 * 获取角色详情
 */
export async function getRole(roleId: number): Promise<Role> {
  const response = await axios.get(`/api/ef/v1/permissions/roles/${roleId}`);
  return response.data;
}

/**
 * 创建角色
 */
export async function createRole(data: CreateRoleRequest): Promise<Role> {
  const response = await axios.post('/api/ef/v1/permissions/roles', data);
  return response.data;
}

/**
 * 更新角色
 */
export async function updateRole(roleId: number, data: UpdateRoleRequest): Promise<Role> {
  const response = await axios.put(`/api/ef/v1/permissions/roles/${roleId}`, data);
  return response.data;
}

/**
 * 删除角色
 */
export async function deleteRole(roleId: number): Promise<void> {
  await axios.delete(`/api/ef/v1/permissions/roles/${roleId}`);
}

// ========== 权限管理 API ==========

/**
 * 获取所有 API 权限列表
 */
export async function listPermissions(module?: string): Promise<APIPermission[]> {
  const response = await axios.get('/api/ef/v1/permissions/apis', {
    params: { module },
  });
  return response.data;
}

/**
 * 获取模块列表
 */
export async function listModules(): Promise<string[]> {
  const response = await axios.get('/api/ef/v1/permissions/apis/modules');
  return response.data.modules;
}

/**
 * 获取权限树结构
 */
export async function getPermissionTree(): Promise<PermissionTreeNode[]> {
  const response = await axios.get('/api/ef/v1/permissions/apis/tree');
  return response.data.tree;
}

// ========== 角色权限分配 API ==========

/**
 * 获取角色的权限代码列表
 */
export async function getRolePermissions(roleId: number): Promise<string[]> {
  const response = await axios.get(`/api/ef/v1/permissions/roles/${roleId}/permissions`);
  return response.data.permission_codes;
}

/**
 * 设置角色权限（完全替换）
 */
export async function setRolePermissions(
  roleId: number,
  permissionCodes: string[]
): Promise<{ count: number }> {
  const response = await axios.put(`/api/ef/v1/permissions/roles/${roleId}/permissions`, {
    permission_codes: permissionCodes,
  });
  return response.data;
}

/**
 * 为角色添加单个权限
 */
export async function addRolePermission(roleId: number, permissionCode: string): Promise<void> {
  await axios.post(`/api/ef/v1/permissions/roles/${roleId}/permissions/${permissionCode}`);
}

/**
 * 移除角色的单个权限
 */
export async function removeRolePermission(roleId: number, permissionCode: string): Promise<void> {
  await axios.delete(`/api/ef/v1/permissions/roles/${roleId}/permissions/${permissionCode}`);
}

// ========== 权限扫描 API ==========

/**
 * 扫描并注册所有 API 路由
 */
export async function scanPermissions(): Promise<{
  created: number;
  updated: number;
  skipped: number;
  total: number;
}> {
  const response = await axios.post('/api/ef/v1/permissions/scan');
  return response.data;
}
