/**
 * Ozon 库存管理页面
 */
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Input,
  InputNumber,
  Popconfirm,
  App,
  Form,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import React, { useState } from 'react';

import AddStockModal from '@/components/ozon/AddStockModal';
import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useShopSelection } from '@/hooks/ozon/useShopSelection';
import { useCurrency } from '@/hooks/useCurrency';
import { usePermission } from '@/hooks/usePermission';
import * as ozonApi from '@/services/ozonApi';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;

const Stock: React.FC = () => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const { symbol: currencySymbol } = useCurrency();
  const { selectedShop, handleShopChange } = useShopSelection();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [skuSearch, setSkuSearch] = useState('');
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [form] = Form.useForm();

  // 查询库存列表
  const {
    data: stockData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['stock', selectedShop, skuSearch, currentPage, pageSize],
    queryFn: () =>
      ozonApi.getStockList({
        shop_id: selectedShop === null ? undefined : selectedShop,
        sku: skuSearch || undefined,
        page: currentPage,
        page_size: pageSize,
      }),
    staleTime: 30000, // 30秒缓存
  });

  // 更新库存 Mutation
  const updateMutation = useMutation({
    mutationFn: ({ stockId, data }: { stockId: number; data: ozonApi.UpdateStockRequest }) =>
      ozonApi.updateStock(stockId, data),
    onSuccess: () => {
      notifySuccess('库存更新成功', '库存数量已更新');
      queryClient.invalidateQueries({ queryKey: ['stock'] });
      setEditingKey(null);
      form.resetFields();
    },
    onError: (error: any) => {
      loggers.stock.error('更新库存失败', error);
      notifyError('更新失败', error?.response?.data?.detail || '请稍后重试');
    },
  });

  // 删除库存 Mutation
  const deleteMutation = useMutation({
    mutationFn: (stockId: number) => ozonApi.deleteStock(stockId),
    onSuccess: () => {
      notifySuccess('库存删除成功', '库存记录已删除');
      queryClient.invalidateQueries({ queryKey: ['stock'] });
    },
    onError: (error: any) => {
      loggers.stock.error('删除库存失败', error);
      notifyError('删除失败', error?.response?.data?.detail || '请稍后重试');
    },
  });

  // 编辑行
  const handleEdit = (record: ozonApi.StockItem) => {
    form.setFieldsValue({
      quantity: record.qty_available,
      notes: record.notes,
    });
    setEditingKey(record.id);
  };

  // 取消编辑
  const handleCancel = () => {
    setEditingKey(null);
    form.resetFields();
  };

  // 保存编辑
  const handleSave = async (record: ozonApi.StockItem) => {
    try {
      const values = await form.validateFields();

      // 如果数量为0，提示确认删除
      if (values.quantity === 0) {
        modal.confirm({
          title: '确认删除',
          content: '库存数量为0将自动删除该记录，确认删除吗？',
          onOk: () => {
            updateMutation.mutate({
              stockId: record.id,
              data: values,
            });
          },
        });
      } else {
        updateMutation.mutate({
          stockId: record.id,
          data: values,
        });
      }
    } catch (error) {
      loggers.stock.error('表单验证失败', error);
    }
  };

  // 删除库存
  const handleDelete = (stockId: number) => {
    deleteMutation.mutate(stockId);
  };

  // 表格列定义
  const columns: ColumnsType<ozonApi.StockItem> = [
    // 店铺名（仅在"全部店铺"时显示）
    ...(selectedShop === null
      ? [
          {
            title: '店铺',
            dataIndex: 'shop_name',
            key: 'shop_name',
            width: 150,
            render: (text: string) => <Text>{text || '-'}</Text>,
          },
        ]
      : []),
    // 商品图片
    {
      title: '商品图片',
      dataIndex: 'product_image',
      key: 'product_image',
      width: 100,
      render: (image: string) =>
        image ? (
          <img
            src={image}
            alt="商品"
            style={{ width: 80, height: 80, objectFit: 'cover', borderRadius: 4 }}
          />
        ) : (
          <div
            style={{
              width: 80,
              height: 80,
              background: '#f0f0f0',
              borderRadius: 4,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            无图片
          </div>
        ),
    },
    // 商品名称
    {
      title: '商品名称',
      dataIndex: 'product_title',
      key: 'product_title',
      width: 200,
      ellipsis: true,
      render: (text: string, record: ozonApi.StockItem) => (
        <div>
          <Text>{text || '-'}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            SKU: {record.sku}
          </Text>
        </div>
      ),
    },
    // 价格
    {
      title: '价格',
      dataIndex: 'product_price',
      key: 'product_price',
      width: 100,
      render: (price: string | number) => (
        <Text>{price ? `${currencySymbol}${parseFloat(String(price)).toFixed(2)}` : '-'}</Text>
      ),
    },
    // 库存数量（可编辑）
    {
      title: '库存数量',
      dataIndex: 'qty_available',
      key: 'qty_available',
      width: 150,
      render: (quantity: number, record: ozonApi.StockItem) => {
        const isEditing = editingKey === record.id;

        return isEditing ? (
          <Form form={form} component={false}>
            <Form.Item
              name="quantity"
              style={{ margin: 0 }}
              rules={[
                { required: true, message: '请输入库存数量' },
                { type: 'number', min: 0, message: '库存数量不能为负数' },
              ]}
            >
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Form>
        ) : (
          <Text>{quantity}</Text>
        );
      },
    },
    // 备注
    {
      title: '备注',
      dataIndex: 'notes',
      key: 'notes',
      width: 150,
      ellipsis: true,
      render: (notes: string, record: ozonApi.StockItem) => {
        const isEditing = editingKey === record.id;

        return isEditing ? (
          <Form form={form} component={false}>
            <Form.Item name="notes" style={{ margin: 0 }}>
              <Input placeholder="备注" />
            </Form.Item>
          </Form>
        ) : (
          <Text type="secondary">{notes || '-'}</Text>
        );
      },
    },
    // 操作
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_: any, record: ozonApi.StockItem) => {
        const isEditing = editingKey === record.id;

        if (!canOperate) {
          return <Text type="secondary">无权限</Text>;
        }

        return isEditing ? (
          <Space>
            <Button type="link" size="small" onClick={() => handleSave(record)}>
              保存
            </Button>
            <Button type="link" size="small" onClick={handleCancel}>
              取消
            </Button>
          </Space>
        ) : (
          <Space>
            <Button
              type="link"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
              disabled={editingKey !== null}
            >
              编辑
            </Button>
            <Popconfirm
              title="确认删除"
              description="确定要删除该库存记录吗？"
              onConfirm={() => handleDelete(record.id)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger icon={<DeleteOutlined />}>
                删除
              </Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <div>
      <PageTitle icon={<PlusOutlined />} title="库存管理" />

      <Card>
        {/* 工具栏 */}
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          {/* 第一行：店铺选择器 + 搜索 + 添加按钮 */}
          <Space>
            <ShopSelector value={selectedShop} onChange={handleShopChange} />
            <Input
              placeholder="搜索 SKU"
              value={skuSearch}
              onChange={(e) => setSkuSearch(e.target.value)}
              onPressEnter={() => {
                setCurrentPage(1);
                refetch();
              }}
              style={{ width: 250 }}
              allowClear
            />
            <Button onClick={() => refetch()}>搜索</Button>
            {canOperate && (
              <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddModalVisible(true)}>
                添加库存
              </Button>
            )}
          </Space>

          {/* 第二行：表格 */}
          <Table
            columns={columns}
            dataSource={stockData?.items || []}
            rowKey="id"
            loading={isLoading}
            pagination={{
              current: currentPage,
              pageSize,
              total: stockData?.total || 0,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`,
              onChange: (page, size) => {
                setCurrentPage(page);
                setPageSize(size);
              },
            }}
            scroll={{ x: 1200 }}
            size="middle"
          />
        </Space>
      </Card>

      {/* 添加库存弹窗 */}
      <AddStockModal
        visible={addModalVisible}
        onClose={() => setAddModalVisible(false)}
        onSuccess={() => {
          setAddModalVisible(false);
          queryClient.invalidateQueries({ queryKey: ['stock'] });
        }}
      />
    </div>
  );
};

export default Stock;
