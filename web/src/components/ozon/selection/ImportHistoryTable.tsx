/**
 * OZON 选品助手 - 导入历史表格组件
 *
 * 显示商品导入历史记录
 */

import React, { useState } from 'react';
import { Table, Button, Tag, Space } from 'antd';
import { LinkOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';

import type { ImportHistory } from '@/services/productSelectionApi';

/**
 * 导入历史表格组件 Props
 */
export interface ImportHistoryTableProps {
  /** 数据源 */
  dataSource?: ImportHistory[];
  /** 是否加载中 */
  loading: boolean;
  /** 当前页码 */
  current: number;
  /** 总数量 */
  total?: number;
  /** 页码变化 */
  onPageChange: (page: number) => void;
  /** 查看批次 */
  onViewBatch: (batchId: number) => void;
  /** 删除批次 */
  onDeleteBatch: (batchId: number) => void;
  /** 批量删除批次 */
  onBatchDelete: (batchIds: number[]) => void;
}

/**
 * 导入历史表格组件
 */
export const ImportHistoryTable: React.FC<ImportHistoryTableProps> = ({
  dataSource,
  loading,
  current,
  total,
  onPageChange,
  onViewBatch,
  onDeleteBatch,
  onBatchDelete,
}) => {
  // 选中的批次ID列表
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  // 处理批量删除
  const handleBatchDelete = () => {
    if (selectedRowKeys.length === 0) return;
    onBatchDelete(selectedRowKeys.map((key) => Number(key)));
    // 清空选中状态
    setSelectedRowKeys([]);
  };
  const columns: ColumnsType<ImportHistory> = [
    {
      title: '文件名',
      dataIndex: 'file_name',
      key: 'file_name',
    },
    {
      title: '批次链接',
      dataIndex: 'id',
      key: 'batch_link',
      render: (id: number, _record: ImportHistory) => (
        <Button
          type="link"
          size="small"
          icon={<LinkOutlined />}
          onClick={() => onViewBatch(id)}
        >
          查看批次 #{id}
        </Button>
      ),
    },
    {
      title: '导入时间',
      dataIndex: 'import_time',
      key: 'import_time',
      render: (time: string) => new Date(time).toLocaleString('zh-CN'),
    },
    {
      title: '导入策略',
      dataIndex: 'import_strategy',
      key: 'import_strategy',
      render: (strategy: string) => {
        const map: Record<string, string> = {
          skip: '跳过重复',
          update: '更新已有',
          append: '追加记录',
        };
        return map[strategy] || strategy;
      },
    },
    {
      title: '总行数',
      dataIndex: 'total_rows',
      key: 'total_rows',
    },
    {
      title: '成功',
      dataIndex: 'success_rows',
      key: 'success_rows',
      render: (val: number) => <Tag color="success">{val}</Tag>,
    },
    {
      title: '更新',
      dataIndex: 'updated_rows',
      key: 'updated_rows',
      render: (val: number) => val > 0 && <Tag color="blue">{val}</Tag>,
    },
    {
      title: '跳过',
      dataIndex: 'skipped_rows',
      key: 'skipped_rows',
      render: (val: number) => val > 0 && <Tag color="warning">{val}</Tag>,
    },
    {
      title: '失败',
      dataIndex: 'failed_rows',
      key: 'failed_rows',
      render: (val: number) => val > 0 && <Tag color="error">{val}</Tag>,
    },
    {
      title: '耗时',
      dataIndex: 'process_duration',
      key: 'process_duration',
      render: (val: number) => `${val}秒`,
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: unknown, record: ImportHistory) => (
        <Button
          type="link"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => onDeleteBatch(record.id)}
        >
          删除
        </Button>
      ),
    },
  ];

  // 行选择配置
  const rowSelection = {
    selectedRowKeys,
    onChange: (newSelectedRowKeys: React.Key[]) => {
      setSelectedRowKeys(newSelectedRowKeys);
    },
  };

  return (
    <>
      {/* 批量操作工具栏 */}
      {selectedRowKeys.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Space>
            <span>已选择 {selectedRowKeys.length} 个批次</span>
            <Button type="primary" danger icon={<DeleteOutlined />} onClick={handleBatchDelete}>
              批量删除
            </Button>
            <Button onClick={() => setSelectedRowKeys([])}>取消选择</Button>
          </Space>
        </div>
      )}

      {/* 表格 */}
      <Table
        dataSource={dataSource}
        rowKey="id"
        loading={loading}
        rowSelection={rowSelection}
        pagination={{
          current: current,
          pageSize: 10,
          total: total,
          onChange: onPageChange,
        }}
        columns={columns}
      />
    </>
  );
};
