import { useMemo } from 'react';

import { useAuth } from './useAuth';

/**
 * 权限检查 Hook
 *
 * 基于用户角色提供权限检查功能
 *
 * 角色权限层级：
 * - admin: 超级管理员，最高权限，可以执行所有操作
 * - manager: 管理员，可以创建子账号和店铺（受级别限额）
 * - sub_account: 子账号，只能查看被绑定的店铺
 *
 * @example
 * ```tsx
 * const { canOperate, isAdmin, isManager } = usePermission();
 *
 * return (
 *   <>
 *     {canOperate && <Button>编辑</Button>}
 *     {isAdmin && <Button>删除</Button>}
 *   </>
 * );
 * ```
 */
export function usePermission() {
  const { user } = useAuth();

  const permissions = useMemo(() => {
    const role = user?.role || 'sub_account';

    return {
      // 角色判断
      isAdmin: role === 'admin',
      isManager: role === 'manager',
      isSubAccount: role === 'sub_account',

      // 权限判断
      canOperate: role === 'admin' || role === 'manager',
      canOnlyView: role === 'sub_account',

      // 具体操作权限
      canCreate: role === 'admin' || role === 'manager',
      canUpdate: role === 'admin' || role === 'manager',
      canDelete: role === 'admin' || role === 'manager',
      canExport: role === 'admin' || role === 'manager',
      canImport: role === 'admin' || role === 'manager',
      canSync: role === 'admin' || role === 'manager',

      // 管理员专属权限
      canManageUsers: role === 'admin' || role === 'manager',
      canManageShops: role === 'admin' || role === 'manager',
      canManageSettings: role === 'admin' || role === 'manager',
      canManageLevels: role === 'admin', // 仅 admin 可管理级别

      // 当前角色
      role,
    };
  }, [user?.role]);

  return permissions;
}
