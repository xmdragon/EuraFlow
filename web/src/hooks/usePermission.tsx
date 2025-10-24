import { useMemo } from 'react';

import { useAuth } from './useAuth';

/**
 * 权限检查 Hook
 *
 * 基于用户角色提供权限检查功能
 *
 * 角色权限层级：
 * - admin: 最高权限，可以执行所有操作
 * - operator: 可以修改数据
 * - viewer: 只能查看数据
 *
 * @example
 * ```tsx
 * const { canOperate, isAdmin, isViewer } = usePermission();
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
    const role = user?.role || 'viewer';

    return {
      // 角色判断
      isAdmin: role === 'admin',
      isOperator: role === 'operator',
      isViewer: role === 'viewer',

      // 权限判断
      canOperate: role === 'admin' || role === 'operator',
      canOnlyView: role === 'viewer',

      // 具体操作权限
      canCreate: role === 'admin' || role === 'operator',
      canUpdate: role === 'admin' || role === 'operator',
      canDelete: role === 'admin' || role === 'operator',
      canExport: role === 'admin' || role === 'operator',
      canImport: role === 'admin' || role === 'operator',
      canSync: role === 'admin' || role === 'operator',

      // 管理员专属权限
      canManageUsers: role === 'admin',
      canManageShops: role === 'admin' || role === 'operator',
      canManageSettings: role === 'admin' || role === 'operator',

      // 当前角色
      role,
    };
  }, [user?.role]);

  return permissions;
}
