/**
 * 表格列配置组件
 * 用于显示/隐藏表格列
 */
import { SettingOutlined, ReloadOutlined, EyeOutlined } from '@ant-design/icons';
import { Button, Checkbox, Popover, Space, Divider, Tooltip } from 'antd';
import React from 'react';

import styles from './index.module.scss';

import type { ColumnConfig } from '@/hooks/useColumnSettings';

interface ColumnSettingProps {
  /**
   * 列配置
   */
  columnConfig: ColumnConfig[];
  /**
   * 切换列的显示/隐藏
   */
  onToggle: (key: string) => void;
  /**
   * 显示所有列
   */
  onShowAll: () => void;
  /**
   * 重置为默认配置
   */
  onReset: () => void;
}

const ColumnSetting: React.FC<ColumnSettingProps> = ({
  columnConfig,
  onToggle,
  onShowAll,
  onReset,
}) => {
  const content = (
    <div className={styles.columnSetting}>
      <div className={styles.header}>
        <span>列设置</span>
        <Space size="small">
          <Tooltip title="显示全部">
            <Button
              type="text"
              size="small"
              icon={<EyeOutlined />}
              onClick={onShowAll}
            />
          </Tooltip>
          <Tooltip title="重置">
            <Button
              type="text"
              size="small"
              icon={<ReloadOutlined />}
              onClick={onReset}
            />
          </Tooltip>
        </Space>
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <div className={styles.columnList}>
        {columnConfig.map((col) => (
          <div key={col.key} className={styles.columnItem}>
            <Checkbox
              checked={col.visible}
              onChange={() => onToggle(col.key)}
              disabled={col.fixed}
            >
              {col.title}
            </Checkbox>
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Popover
      content={content}
      trigger="click"
      placement="bottomRight"
      overlayClassName={styles.columnSettingPopover}
    >
      <Tooltip title="列设置">
        <Button icon={<SettingOutlined />} type="text" />
      </Tooltip>
    </Popover>
  );
};

export default ColumnSetting;
