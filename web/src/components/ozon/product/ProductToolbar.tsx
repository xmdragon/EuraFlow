/**
 * 商品工具栏组件
 * 包含同步、批量操作等功能按钮
 */
import {
  SyncOutlined,
  ReloadOutlined,
  DollarOutlined,
  ShoppingOutlined,
  SettingOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { Space, Button, Tooltip } from 'antd';
import React from 'react';

import styles from '../../../pages/ozon/ProductList.module.scss';

export interface ProductToolbarProps {
  /** 是否可以同步 */
  canSync: boolean;
  /** 是否可以操作 */
  canOperate: boolean;
  /** 是否可以删除 */
  canDelete?: boolean;
  /** 选中的行数量 */
  selectedRowsCount: number;
  /** 同步是否正在进行 */
  syncLoading: boolean;
  /** 同步进度 */
  syncProgress?: { progress: number; message?: string } | null;
  /** 是否选择了店铺 */
  hasSelectedShop?: boolean;
  /** 是否在归档标签页 */
  isArchivedTab?: boolean;
  /** 增量同步回调 */
  onIncrementalSync: () => void;
  /** 全量同步回调 */
  onFullSync: () => void;
  /** 批量调价回调 */
  onBatchPriceUpdate: () => void;
  /** 批量改库存回调 */
  onBatchStockUpdate: () => void;
  /** 列配置回调 */
  onColumnSettings: () => void;
  /** 批量删除回调 */
  onBatchDelete?: () => void;
}

/**
 * 商品工具栏组件
 */
export const ProductToolbar: React.FC<ProductToolbarProps> = ({
  canSync,
  canOperate,
  canDelete = false,
  selectedRowsCount,
  syncLoading,
  syncProgress,
  hasSelectedShop = true,
  isArchivedTab = false,
  onIncrementalSync,
  onFullSync,
  onBatchPriceUpdate,
  onBatchStockUpdate,
  onColumnSettings,
  onBatchDelete,
}) => {
  return (
    <div className={styles.actionWrapper}>
      <Space>
        {canSync && (
          <Tooltip
            title={
              !hasSelectedShop
                ? '请先选择店铺'
                : '同步当前店铺的商品'
            }
          >
            <Button
              type="primary"
              icon={<SyncOutlined spin={syncLoading} />}
              onClick={onIncrementalSync}
              loading={syncLoading}
              disabled={!hasSelectedShop}
            >
              {syncLoading && syncProgress
                ? `同步中 ${Math.round(syncProgress.progress)}%`
                : '增量同步'}
            </Button>
          </Tooltip>
        )}
        {canSync && (
          <Tooltip
            title={
              !hasSelectedShop
                ? '请先选择店铺'
                : '全量同步当前店铺的商品'
            }
          >
            <Button
              icon={<ReloadOutlined spin={syncLoading} />}
              onClick={onFullSync}
              loading={syncLoading}
              disabled={!hasSelectedShop}
            >
              {syncLoading && syncProgress
                ? `同步中 ${Math.round(syncProgress.progress)}%`
                : '全量同步'}
            </Button>
          </Tooltip>
        )}
        {canOperate && (
          <Tooltip
            title={
              !hasSelectedShop
                ? '请先选择店铺'
                : selectedRowsCount === 0
                  ? '未选择商品时将对全店铺商品操作'
                  : `已选择 ${selectedRowsCount} 个商品`
            }
          >
            <Button
              icon={<DollarOutlined />}
              onClick={onBatchPriceUpdate}
              disabled={!hasSelectedShop}
            >
              批量调价
            </Button>
          </Tooltip>
        )}
        {canOperate && (
          <Tooltip
            title={
              !hasSelectedShop
                ? '请先选择店铺'
                : selectedRowsCount === 0
                  ? '未选择商品时将对全店铺商品操作'
                  : `已选择 ${selectedRowsCount} 个商品`
            }
          >
            <Button
              icon={<ShoppingOutlined />}
              onClick={onBatchStockUpdate}
              disabled={!hasSelectedShop}
            >
              批量改库存
            </Button>
          </Tooltip>
        )}
        {canDelete && isArchivedTab && (
          <Tooltip
            title={
              selectedRowsCount === 0
                ? '请先选择要删除的商品'
                : `删除选中的 ${selectedRowsCount} 个商品（仅限无SKU的归档商品）`
            }
          >
            <Button
              danger
              icon={<DeleteOutlined />}
              onClick={onBatchDelete}
              disabled={selectedRowsCount === 0}
            >
              批量删除
            </Button>
          </Tooltip>
        )}
      </Space>
      <Button icon={<SettingOutlined />} onClick={onColumnSettings}>
        列配置
      </Button>
    </div>
  );
};

export default ProductToolbar;
