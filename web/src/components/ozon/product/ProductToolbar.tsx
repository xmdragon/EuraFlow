/**
 * 商品工具栏组件
 * 包含同步、批量操作、导入导出等功能按钮
 */
import {
  SyncOutlined,
  ReloadOutlined,
  DollarOutlined,
  ShoppingOutlined,
  UploadOutlined,
  DownloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import { Space, Button, Tooltip } from 'antd';
import React from 'react';

import styles from '../../../pages/ozon/ProductList.module.scss';

export interface ProductToolbarProps {
  /** 是否可以同步 */
  canSync: boolean;
  /** 是否可以操作 */
  canOperate: boolean;
  /** 是否可以导入 */
  canImport: boolean;
  /** 是否可以导出 */
  canExport: boolean;
  /** 选中的行数量 */
  selectedRowsCount: number;
  /** 同步是否正在进行 */
  syncLoading: boolean;
  /** 是否选择了店铺 */
  hasSelectedShop?: boolean;
  /** 增量同步回调 */
  onIncrementalSync: () => void;
  /** 全量同步回调 */
  onFullSync: () => void;
  /** 批量调价回调 */
  onBatchPriceUpdate: () => void;
  /** 批量改库存回调 */
  onBatchStockUpdate: () => void;
  /** 导入回调 */
  onImport: () => void;
  /** 导出回调 */
  onExport: () => void;
  /** 列设置回调 */
  onColumnSettings: () => void;
}

/**
 * 商品工具栏组件
 */
export const ProductToolbar: React.FC<ProductToolbarProps> = ({
  canSync,
  canOperate,
  canImport,
  canExport,
  selectedRowsCount,
  syncLoading,
  hasSelectedShop = true,
  onIncrementalSync,
  onFullSync,
  onBatchPriceUpdate,
  onBatchStockUpdate,
  onImport,
  onExport,
  onColumnSettings,
}) => {
  return (
    <div className={styles.actionWrapper}>
      <Space>
        {canSync && (
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={onIncrementalSync}
            loading={syncLoading}
            disabled={!hasSelectedShop}
          >
            增量同步
          </Button>
        )}
        {canSync && (
          <Button
            icon={<ReloadOutlined />}
            onClick={onFullSync}
            loading={syncLoading}
            disabled={!hasSelectedShop}
          >
            全量同步
          </Button>
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
        {canImport && (
          <Button icon={<UploadOutlined />} onClick={onImport}>
            导入商品
          </Button>
        )}
        {canExport && (
          <Button icon={<DownloadOutlined />} onClick={onExport}>
            导出数据
          </Button>
        )}
      </Space>
      <Tooltip title="列显示设置">
        <Button icon={<SettingOutlined />} onClick={onColumnSettings}>
          列设置
        </Button>
      </Tooltip>
    </div>
  );
};

export default ProductToolbar;
