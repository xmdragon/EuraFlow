/* eslint-disable no-unused-vars */
/**
 * 商品状态标签组件
 * 显示各状态的商品数量并支持切换过滤
 */
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  FileOutlined,
  PlusCircleOutlined,
} from '@ant-design/icons';
import { Tabs } from 'antd';
import React from 'react';

export interface ProductStats {
  on_sale: number;
  ready_to_sell: number;
  error: number;
  pending_modification: number;
  inactive: number;
  archived: number;
}

export interface ProductStatusTabsProps {
  /** 商品统计数据 */
  stats: ProductStats | null | undefined;
  /** 当前激活的状态 */
  activeStatus: string;
  /** 状态改变时的回调 */
  onStatusChange: (_newStatus: string) => void;
}

/**
 * 商品状态标签组件
 */
export const ProductStatusTabs: React.FC<ProductStatusTabsProps> = ({
  stats,
  activeStatus,
  onStatusChange,
}) => {
  return (
    <Tabs
      activeKey={activeStatus || 'new_products'}
      onChange={onStatusChange}
      style={{ marginTop: 16 }}
      items={[
        {
          key: 'new_products',
          label: (
            <span>
              <PlusCircleOutlined />
              新增商品
            </span>
          ),
        },
        {
          key: 'on_sale',
          label: (
            <span>
              <CheckCircleOutlined />
              销售中 ({stats?.on_sale || 0})
            </span>
          ),
        },
        {
          key: 'ready_to_sell',
          label: (
            <span>
              <ClockCircleOutlined />
              准备销售 ({stats?.ready_to_sell || 0})
            </span>
          ),
        },
        {
          key: 'error',
          label: (
            <span>
              <CloseCircleOutlined />
              错误 ({stats?.error || 0})
            </span>
          ),
        },
        {
          key: 'pending_modification',
          label: (
            <span>
              <WarningOutlined />
              待修改 ({stats?.pending_modification || 0})
            </span>
          ),
        },
        {
          key: 'inactive',
          label: (
            <span>
              <InfoCircleOutlined />
              已下架 ({stats?.inactive || 0})
            </span>
          ),
        },
        {
          key: 'archived',
          label: (
            <span>
              <FileOutlined />
              已归档 ({stats?.archived || 0})
            </span>
          ),
        },
      ]}
    />
  );
};

export default ProductStatusTabs;
