/**
 * 列显示配置Modal组件
 */
import { SettingOutlined } from '@ant-design/icons';
import { Alert, Divider, Modal, Space, Switch } from 'antd';
import React from 'react';

export interface ColumnVisibility {
  image?: boolean;
  sku?: boolean;
  title?: boolean;
  info?: boolean;
  price?: boolean;
  stock?: boolean;
  status?: boolean;
  visibility?: boolean;
  created_at?: boolean;
  last_sync?: boolean;
  actions?: boolean;
  [key: string]: boolean | undefined;
}

/* eslint-disable no-unused-vars */
export interface ColumnConfigModalProps {
  visible: boolean;
  onCancel: () => void;
  onOk: () => void;
  visibleColumns: ColumnVisibility;
  onColumnVisibilityChange: (columnKey: string, visible: boolean) => void;
}
/* eslint-enable no-unused-vars */

/**
 * 列显示配置Modal组件
 */
export const ColumnConfigModal: React.FC<ColumnConfigModalProps> = ({
  visible,
  onCancel,
  onOk,
  visibleColumns,
  onColumnVisibilityChange,
}) => {
  const columnConfigs = [
    { key: 'sku', label: 'SKU/编码' },
    { key: 'info', label: '商品信息' },
    { key: 'price', label: '价格' },
    { key: 'stock', label: '库存' },
    { key: 'status', label: '状态' },
    { key: 'visibility', label: '可见性' },
    { key: 'created_at', label: '创建时间' },
    { key: 'last_sync', label: '最后同步' },
  ];

  return (
    <Modal title="列显示设置" open={visible} onCancel={onCancel} onOk={onOk} width={400}>
      <div style={{ padding: '12px 0' }}>
        <Alert
          message="选择要显示的列"
          description="取消勾选可隐藏对应的列，设置会自动保存"
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
        />
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {columnConfigs.map((config) => (
            <div key={config.key}>
              <Switch
                checked={visibleColumns[config.key] !== false}
                onChange={(checked) => onColumnVisibilityChange(config.key, checked)}
                style={{ marginRight: 8 }}
              />
              <span>{config.label}</span>
            </div>
          ))}
          <Divider style={{ margin: '12px 0' }} />
          <div style={{ color: '#999', fontSize: 12 }}>
            <SettingOutlined /> 操作列始终显示
          </div>
        </Space>
      </div>
    </Modal>
  );
};
