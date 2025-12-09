/**
 * Ozon 仓库列表管理页面
 */
import { SyncOutlined, HomeOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Table, Button, Space, Card, Tag, Empty, Tooltip } from 'antd';
import { ColumnsType } from 'antd/es/table';
import React from 'react';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { usePermission } from '@/hooks/usePermission';
import * as warehouseApi from '@/services/ozon/api/warehouses';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

import styles from './Warehouses.module.scss';

// 仓库数据接口
interface Warehouse {
  id: number;
  shop_id: number;
  warehouse_id: number;
  name: string;
  is_rfbs: boolean;
  status: string;
  has_entrusted_acceptance: boolean;
  postings_limit: number;
  min_postings_limit: number | null;
  has_postings_limit: boolean;
  min_working_days: number | null;
  working_days: string[] | null;
  can_print_act_in_advance: boolean;
  is_karantin: boolean;
  is_kgt: boolean;
  is_timetable_editable: boolean;
  first_mile_type: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

// 仓库状态中文映射
const STATUS_MAP: Record<string, { text: string; color: string }> = {
  created: { text: '正常', color: 'green' },
  new: { text: '新建', color: 'blue' },
  disabled: { text: '已禁用', color: 'default' },
  blocked: { text: '已封锁', color: 'red' },
  disabled_due_to_limit: { text: '限额禁用', color: 'orange' },
  error: { text: '错误', color: 'red' },
};

// 工作日映射
const WEEKDAY_MAP: Record<string, string> = {
  '1': '周一',
  '2': '周二',
  '3': '周三',
  '4': '周四',
  '5': '周五',
  '6': '周六',
  '7': '周日',
};

const Warehouses: React.FC = () => {
  const queryClient = useQueryClient();
  const { canSync } = usePermission();
  const { selectedShop, handleShopChange } = useShopSelection();

  // 查询仓库列表
  const { data: warehousesResponse, isLoading } = useQuery({
    queryKey: ['warehouses', selectedShop],
    queryFn: async () => {
      if (!selectedShop) return null;
      return await warehouseApi.getWarehouses(selectedShop);
    },
    enabled: !!selectedShop,
  });

  const warehouses: Warehouse[] = warehousesResponse?.data || [];

  // 同步仓库
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return await warehouseApi.syncWarehouses(selectedShop);
    },
    onSuccess: (response) => {
      if (response.success) {
        const { total, created, updated } = response.data || {};
        notifySuccess('同步成功', `共${total}个仓库，新增${created}个，更新${updated}个`);
        queryClient.invalidateQueries({ queryKey: ['warehouses'] });
      } else {
        notifyError('同步失败', response.message || '未知错误');
      }
    },
    onError: (error: Error) => {
      loggers.ozon.error('同步仓库失败:', error);
      notifyError('同步失败', error.message || '未知错误');
    },
  });

  // 格式化工作日
  const formatWorkingDays = (days: string[] | null): string => {
    if (!days || days.length === 0) return '-';
    if (days.length === 7) return '全周';
    return days.map((d) => WEEKDAY_MAP[d] || d).join('、');
  };

  // 格式化订单限额
  const formatPostingsLimit = (limit: number): string => {
    if (limit === -1) return '无限制';
    return `${limit} 单`;
  };

  // 表格列定义
  const columns: ColumnsType<Warehouse> = [
    {
      title: '仓库ID',
      dataIndex: 'warehouse_id',
      key: 'warehouse_id',
      width: 140,
    },
    {
      title: '仓库名称',
      dataIndex: 'name',
      key: 'name',
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'is_rfbs',
      key: 'is_rfbs',
      width: 80,
      render: (isRfbs: boolean) => (
        <Tag color={isRfbs ? 'purple' : 'cyan'}>{isRfbs ? 'rFBS' : 'FBS'}</Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status: string) => {
        const config = STATUS_MAP[status] || { text: status, color: 'default' };
        return <Tag color={config.color}>{config.text}</Tag>;
      },
    },
    {
      title: () => (
        <Tooltip title="订单限额（-1表示无限制）">
          <span>限额</span>
        </Tooltip>
      ),
      dataIndex: 'postings_limit',
      key: 'postings_limit',
      width: 100,
      render: (limit: number) => formatPostingsLimit(limit),
    },
    {
      title: () => (
        <Tooltip title="是否启用受信任接受">
          <span>受信任</span>
        </Tooltip>
      ),
      dataIndex: 'has_entrusted_acceptance',
      key: 'has_entrusted_acceptance',
      width: 80,
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '工作日',
      dataIndex: 'working_days',
      key: 'working_days',
      width: 150,
      render: (days: string[] | null) => formatWorkingDays(days),
    },
    {
      title: () => (
        <Tooltip title="是否因隔离停运">
          <span>隔离</span>
        </Tooltip>
      ),
      dataIndex: 'is_karantin',
      key: 'is_karantin',
      width: 70,
      render: (value: boolean) => (
        <Tag color={value ? 'red' : 'default'}>{value ? '是' : '否'}</Tag>
      ),
    },
    {
      title: () => (
        <Tooltip title="是否接受大宗商品">
          <span>大宗</span>
        </Tooltip>
      ),
      dataIndex: 'is_kgt',
      key: 'is_kgt',
      width: 70,
      render: (value: boolean) => (
        <Tag color={value ? 'blue' : 'default'}>{value ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (time: string | null) => {
        if (!time) return '-';
        return new Date(time).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
      },
    },
  ];

  return (
    <div className={styles.pageWrapper}>
      <PageTitle icon={<HomeOutlined />} title="仓库列表" />
      <Card>
        <Space direction="vertical" className={styles.fullWidth}>
          {/* 工具栏 */}
          <div className={styles.toolbar}>
            <Space>
              <ShopSelector
                value={selectedShop}
                onChange={handleShopChange}
                showAllOption={false}
                className={styles.shopSelector}
              />
              <Button
                type="primary"
                icon={<SyncOutlined />}
                onClick={() => syncMutation.mutate()}
                loading={syncMutation.isPending}
                disabled={!selectedShop || !canSync}
              >
                同步仓库
              </Button>
            </Space>
          </div>

          {/* 仓库列表表格 */}
          <Table
            columns={columns}
            dataSource={warehouses}
            loading={isLoading}
            rowKey="id"
            locale={{
              emptyText: selectedShop ? (
                <Empty description="暂无仓库数据，请点击同步按钮获取数据" />
              ) : (
                <Empty description="请先选择店铺" />
              ),
            }}
            pagination={false}
            scroll={{ x: 1100 }}
          />
        </Space>
      </Card>
    </div>
  );
};

export default Warehouses;
