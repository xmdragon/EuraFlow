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
 * 克隆状态限制：
 * - 克隆状态下，canManageUsers 和 canManageSystem 为 false
 * - 其他业务权限保持不变
 *
 * @example
 * ```tsx
 * const { canOperate, isAdmin, isManager, isCloned } = usePermission();
 *
 * return (
 *   <>
 *     {canOperate && <Button>编辑</Button>}
 *     {isAdmin && !isCloned && <Button>删除</Button>}
 *   </>
 * );
 * ```
 */
export function usePermission() {
  const { user, isCloned } = useAuth();

  const permissions = useMemo(() => {
    const role = user?.role || 'sub_account';

    return {
      // 角色判断
      isAdmin: role === 'admin',
      isManager: role === 'manager',
      isSubAccount: role === 'sub_account',

      // 克隆状态
      isCloned,

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

      // 管理员专属权限（克隆状态下禁用用户管理和系统管理）
      canManageUsers: !isCloned && (role === 'admin' || role === 'manager'),
      canManageShops: role === 'admin' || role === 'manager',
      canManageSettings: role === 'admin' || role === 'manager',
      canManageLevels: !isCloned && role === 'admin', // 仅 admin 可管理级别，克隆状态禁用
      canManageSystem: !isCloned && role === 'admin', // 仅 admin 可管理系统，克隆状态禁用

      // 当前角色
      role,
    };
  }, [user?.role, isCloned]);

  return permissions;
}
