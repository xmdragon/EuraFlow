/**
 * OZON 选品助手 - 工具栏组件
 *
 * 显示统计信息和批量操作按钮
 */

import React from 'react';
import { Row, Col, Space, Button, Typography } from 'antd';
import { CheckCircleOutlined, SettingOutlined } from '@ant-design/icons';

import styles from '@/pages/ozon/ProductSelection.module.scss';

const { Text } = Typography;

/**
 * 工具栏组件 Props
 */
export interface ProductToolbarProps {
  /** 已加载商品数量 */
  loadedCount: number;
  /** 总商品数量 */
  totalCount: number;
  /** 已选中商品数量 */
  selectedCount: number;
  /** 是否正在标记已读 */
  marking: boolean;
  /** 标记已读回调 */
  onMarkAsRead: () => void;
  /** 打开字段配置 */
  onOpenFieldConfig: () => void;
}

/**
 * 工具栏组件
 */
export const ProductToolbar: React.FC<ProductToolbarProps> = ({
  loadedCount,
  totalCount,
  selectedCount,
  marking,
  onMarkAsRead,
  onOpenFieldConfig,
}) => {
  return (
    <Row justify="space-between" align="middle" className={styles.searchStats}>
      <Col>
        <Space>
          <Text>
            已加载 <Text strong>{loadedCount}</Text> / {totalCount} 件商品
          </Text>
          {selectedCount > 0 && (
            <Button
              type="primary"
              icon={<CheckCircleOutlined />}
              onClick={onMarkAsRead}
              loading={marking}
            >
              已阅 ({selectedCount})
            </Button>
          )}
        </Space>
      </Col>
      <Col>
        <Button icon={<SettingOutlined />} onClick={onOpenFieldConfig}>
          列配置
        </Button>
      </Col>
    </Row>
  );
};
