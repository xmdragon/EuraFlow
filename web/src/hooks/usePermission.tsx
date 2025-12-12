import { useCallback, useMemo } from 'react';

import { useAuth } from './useAuth';

/**
 * 权限匹配函数
 * 支持精确匹配和通配符匹配（*.后缀）
 *
 * @param userPermissions 用户拥有的权限代码列表
 * @param requiredCode 需要检查的权限代码
 * @returns 是否有权限
 */
function matchPermission(userPermissions: string[], requiredCode: string): boolean {
  // 1. 精确匹配
  if (userPermissions.includes(requiredCode)) {
    return true;
  }

  // 2. 通配符匹配 (ozon.orders.* 匹配 ozon.orders.list)
  for (const perm of userPermissions) {
    if (perm.endsWith('.*')) {
      const prefix = perm.slice(0, -2); // 移除 .*
      if (requiredCode.startsWith(prefix + '.')) {
        return true;
      }
    }
  }

  return false;
}

/**
 * 权限检查 Hook
 *
 * 支持两种权限检查模式：
 * 1. 基于角色的权限判断（向后兼容）：isAdmin, isMainAccount, canOperate 等
 * 2. 基于权限代码的细粒度检查（新版）：hasPermission('ozon.orders.list')
 *
 * 角色权限层级：
 * - admin: 超级管理员，最高权限，可以执行所有操作
 * - main_account: 主账号，可以创建子账号和店铺（受级别限额）
 * - sub_account: 子账号，只能查看被绑定的店铺
 * - shipper: 发货员，只能访问首页和扫描单号页面（操作启用发货托管的店铺订单）
 * - extension: 浏览器扩展，只能访问扩展相关的API（/api/ef/v1/ozon/extension/*）
 *
 * 权限代码命名规范：{module}.{category}.{action}
 * 例如：ozon.orders.list, ozon.products.create, system.users.delete
 *
 * 克隆状态限制：
 * - 克隆状态下，canManageLevels 和 canManageSystem 为 false（仅 admin 专属功能）
 * - canManageUsers 不受克隆状态影响（主账号可以管理自己的子账号）
 * - 其他业务权限保持不变
 *
 * @example
 * ```tsx
 * const { canOperate, isAdmin, isMainAccount, isCloned, hasPermission } = usePermission();
 *
 * return (
 *   <>
 *     {canOperate && <Button>编辑</Button>}
 *     {isAdmin && !isCloned && <Button>删除</Button>}
 *     {hasPermission('ozon.orders.export') && <Button>导出</Button>}
 *   </>
 * );
 * ```
 */
export function usePermission() {
  const { user, isCloned } = useAuth();

  // 用户拥有的权限代码列表
  const permissionCodes = useMemo(() => user?.permissions ?? [], [user?.permissions]);

  // 权限代码检查函数
  const hasPermission = useCallback(
    (requiredCode: string): boolean => {
      return matchPermission(permissionCodes, requiredCode);
    },
    [permissionCodes]
  );

  // 批量权限检查：是否拥有所有指定权限
  const hasAllPermissions = useCallback(
    (requiredCodes: string[]): boolean => {
      return requiredCodes.every((code) => matchPermission(permissionCodes, code));
    },
    [permissionCodes]
  );

  // 批量权限检查：是否拥有任一指定权限
  const hasAnyPermission = useCallback(
    (requiredCodes: string[]): boolean => {
      return requiredCodes.some((code) => matchPermission(permissionCodes, code));
    },
    [permissionCodes]
  );

  const permissions = useMemo(() => {
    const role = user?.role || 'sub_account';

    return {
      // 角色判断
      isAdmin: role === 'admin',
      isMainAccount: role === 'main_account',
      isSubAccount: role === 'sub_account',
      isShipper: role === 'shipper',
      isExtension: role === 'extension',

      // 克隆状态
      isCloned,

      // 基于角色的权限判断（向后兼容）
      canOperate: role === 'admin' || role === 'main_account',
      canOnlyView: role === 'sub_account' || role === 'shipper' || role === 'extension',

      // 具体操作权限（基于角色，向后兼容）
      canCreate: role === 'admin' || role === 'main_account',
      canUpdate: role === 'admin' || role === 'main_account',
      canDelete: role === 'admin' || role === 'main_account',
      canExport: role === 'admin' || role === 'main_account',
      canImport: role === 'admin' || role === 'main_account',
      canSync: role === 'admin' || role === 'main_account',

      // 主账号及以上专属权限
      // canManageUsers 不受克隆状态影响，因为主账号可以管理自己的子账号
      canManageUsers: role === 'admin' || role === 'main_account',
      canManageShops: role === 'admin' || role === 'main_account',
      canManageSettings: role === 'admin' || role === 'main_account',
      canManageLevels: !isCloned && role === 'admin', // 仅 admin 可管理级别，克隆状态禁用
      canManageSystem: !isCloned && role === 'admin', // 仅 admin 可管理系统，克隆状态禁用

      // 发货员专属权限（admin 通常不需要此功能，但保留访问权限）
      canScanShipping: role === 'main_account' || role === 'sub_account' || role === 'shipper',

      // 当前角色
      role,

      // 新版权限代码列表
      permissionCodes,

      // 权限检查函数
      hasPermission,
      hasAllPermissions,
      hasAnyPermission,
    };
  }, [user?.role, isCloned, permissionCodes, hasPermission, hasAllPermissions, hasAnyPermission]);

  return permissions;
}
