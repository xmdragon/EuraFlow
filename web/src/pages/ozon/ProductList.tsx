/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ozon 商品列表页面
 */
import {
  ReloadOutlined,
  UploadOutlined,
  DownloadOutlined,
  EditOutlined,
  DeleteOutlined,
  SyncOutlined,
  DollarOutlined,
  ShoppingOutlined,
  SettingOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  FileImageOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Row,
  Col,
  Statistic,
  Input,
  Select,
  Tag,
  Dropdown,
  Modal,
  message,
  Tooltip,
  Badge,
  Switch,
  InputNumber,
  Form,
  Progress,
  Alert,
  Upload,
  Image,
} from 'antd';
import { ColumnsType } from 'antd/es/table';
import React, { useState, useEffect } from 'react';

import * as ozonApi from '@/services/ozonApi';
import ShopSelector from '@/components/ozon/ShopSelector';
import ImagePreview from '@/components/ImagePreview';
import './ProductList.css';

const { Option } = Select;
const { confirm } = Modal;

const ProductList: React.FC = () => {
  const queryClient = useQueryClient();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRows, setSelectedRows] = useState<ozonApi.Product[]>([]);
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [filterForm] = Form.useForm();
  const [priceModalVisible, setPriceModalVisible] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ozonApi.Product | null>(null);
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [filterValues, setFilterValues] = useState<ozonApi.ProductFilter>({});

  // 图片预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);

  // 查询商品列表
  const {
    data: productsData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['ozonProducts', currentPage, pageSize, selectedShop, filterValues],
    queryFn: () => ozonApi.getProducts(currentPage, pageSize, { ...filterValues, shop_id: selectedShop }),
    refetchInterval: 30000, // 30秒自动刷新
  });

  // 查询全局统计数据（不受筛选影响）
  const { data: globalStats } = useQuery({
    queryKey: ['ozonProductsStats', selectedShop],
    queryFn: () => ozonApi.getProducts(1, 1, { shop_id: selectedShop }),
    refetchInterval: 30000, // 30秒自动刷新
  });

  // 同步商品
  const syncProductsMutation = useMutation({
    mutationFn: (fullSync: boolean) => ozonApi.syncProducts(selectedShop, fullSync),
    onSuccess: (data) => {
      message.success('商品同步任务已启动');
      setSyncTaskId(data.task_id);
      setSyncStatus({
        status: 'running',
        progress: 0,
        message: '正在启动同步...',
      });
    },
    onError: (error: any) => {
      message.error(`同步失败: ${error.message}`);
    },
  });

  // 批量更新价格
  const updatePricesMutation = useMutation({
    mutationFn: (updates: ozonApi.PriceUpdate[]) => ozonApi.updatePrices(updates, selectedShop || undefined),
    onSuccess: () => {
      message.success('价格更新成功');
      setPriceModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
    onError: (error: any) => {
      message.error(`价格更新失败: ${error.message}`);
    },
  });

  // 轮询同步任务状态
  useEffect(() => {
    if (!syncTaskId || syncStatus?.status === 'completed' || syncStatus?.status === 'failed') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const response = await fetch(`/api/ef/v1/ozon/sync/status/${syncTaskId}`);
        if (response.ok) {
          const result = await response.json();
          const status = result.data || result; // 兼容不同响应格式
          setSyncStatus(status);

          if (status.status === 'completed') {
            message.success('同步完成！');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
            // 刷新页面数据
            refetch();
            setSyncTaskId(null);
          } else if (status.status === 'failed') {
            message.error(`同步失败: ${status.error || '未知错误'}`);
            setSyncTaskId(null);
          }
        }
      } catch (error) {
        console.error('Failed to fetch sync status:', error);
      }
    }, 2000); // 每2秒检查一次

    return () => clearInterval(interval);
  }, [syncTaskId, syncStatus?.status, queryClient]);

  // 处理图片点击
  const handleImageClick = (images: string[], index: number = 0) => {
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewVisible(true);
  };

  // 批量更新库存
  const updateStocksMutation = useMutation({
    mutationFn: (updates: ozonApi.StockUpdate[]) => ozonApi.updateStocks(updates, selectedShop || undefined),
    onSuccess: () => {
      message.success('库存更新成功');
      setStockModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
    onError: (error: any) => {
      message.error(`库存更新失败: ${error.message}`);
    },
  });

  // 表格列定义
  const columns: ColumnsType<ozonApi.Product> = [
    {
      title: 'SKU',
      dataIndex: 'sku',
      key: 'sku',
      width: 180,
      render: (text, record) => (
        <Space direction="vertical" size="small">
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontWeight: 'bold' }}>{text}</span>
            <Button
              type="text"
              size="small"
              icon={
                <div style={{ position: 'relative', width: '12px', height: '12px' }}>
                  <div style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    width: '8px',
                    height: '8px',
                    border: '1px solid #666',
                    backgroundColor: 'white'
                  }} />
                  <div style={{
                    position: 'absolute',
                    top: '0px',
                    left: '0px',
                    width: '8px',
                    height: '8px',
                    border: '1px solid #666',
                    backgroundColor: 'white'
                  }} />
                </div>
              }
              onClick={() => handleCopyToClipboard(text, 'SKU')}
              style={{ padding: '0 4px', height: '20px', minWidth: '20px' }}
              title="复制SKU"
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ fontSize: 12, color: '#999' }}>
              ID: {record.ozon_product_id || record.offer_id}
            </span>
            <Button
              type="text"
              size="small"
              icon={
                <div style={{ position: 'relative', width: '10px', height: '10px' }}>
                  <div style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    width: '6px',
                    height: '6px',
                    border: '1px solid #666',
                    backgroundColor: 'white'
                  }} />
                  <div style={{
                    position: 'absolute',
                    top: '0px',
                    left: '0px',
                    width: '6px',
                    height: '6px',
                    border: '1px solid #666',
                    backgroundColor: 'white'
                  }} />
                </div>
              }
              onClick={() => handleCopyToClipboard(String(record.ozon_product_id || record.offer_id), '产品ID')}
              style={{ padding: '0 4px', height: '16px', minWidth: '16px', fontSize: '10px' }}
              title="复制产品ID"
            />
          </div>
        </Space>
      ),
    },
    {
      title: '商品信息',
      dataIndex: 'title',
      key: 'title',
      width: 350,
      render: (text, record) => {
        // 准备所有图片URL用于预览
        const allImages: string[] = [];
        if (record.images?.primary) {
          allImages.push(record.images.primary);
        }
        if (record.images?.additional && Array.isArray(record.images.additional)) {
          allImages.push(...record.images.additional);
        }

        return (
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            {/* 商品图片 */}
            <div style={{ flexShrink: 0 }}>
              {record.images?.primary ? (
                <img
                  src={record.images.primary}
                  alt={text}
                  style={{
                    width: '60px',
                    height: '60px',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    border: '1px solid #f0f0f0',
                    cursor: 'pointer',
                  }}
                  onClick={() => handleImageClick(allImages)}
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    img.style.display = 'none';
                    const placeholder = img.nextElementSibling as HTMLElement;
                    if (placeholder) placeholder.style.display = 'flex';
                  }}
                />
              ) : null}
              {/* 图片占位符 */}
              <div
                style={{
                  width: '60px',
                  height: '60px',
                  backgroundColor: '#f5f5f5',
                  border: '1px dashed #d9d9d9',
                  borderRadius: '4px',
                  display: record.images?.primary ? 'none' : 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#bfbfbf',
                }}
              >
                <FileImageOutlined style={{ fontSize: '20px' }} />
              </div>
            </div>

            {/* 商品信息 */}
            <Space direction="vertical" size="small" style={{ flex: 1 }}>
              <span style={{ fontWeight: 500, wordBreak: 'break-word' }}>{text}</span>
              <Space size="small" wrap>
                {record.category_name && <Tag color="blue">{record.category_name}</Tag>}
                {record.brand && <Tag>{record.brand}</Tag>}
                {allImages.length > 1 && (
                  <Tooltip title={`点击图片查看全部 ${allImages.length} 张图片`}>
                    <Tag icon={<FileImageOutlined />} color="blue">{allImages.length}张图片</Tag>
                  </Tooltip>
                )}
              </Space>
              {record.barcode && (
                <span style={{ fontSize: 12, color: '#999' }}>条码: {record.barcode}</span>
              )}
            </Space>
          </div>
        );
      },
    },
    {
      title: '价格',
      key: 'price',
      width: 150,
      render: (_, record) => {
        // 确保价格格式正确
        const price = parseFloat(record.price || '0');
        const oldPrice = record.old_price ? parseFloat(record.old_price) : null;
        const cost = record.cost ? parseFloat(record.cost) : null;

        return (
          <Space direction="vertical" size="small">
            <span style={{ fontWeight: 'bold', color: '#52c41a', fontSize: 16 }}>
              ₽ {price.toFixed(2)}
            </span>
            {oldPrice && oldPrice > price && (
              <span
                style={{
                  textDecoration: 'line-through',
                  color: '#999',
                  fontSize: 12,
                }}
              >
                ₽ {oldPrice.toFixed(2)}
              </span>
            )}
            {cost && price > 0 && (
              <Tooltip title={`成本: ₽${cost.toFixed(2)}`}>
                <span
                  style={{
                    fontSize: 12,
                    color: price > cost ? '#52c41a' : '#ff4d4f',
                  }}
                >
                  毛利: {(((price - cost) / price) * 100).toFixed(1)}%
                </span>
              </Tooltip>
            )}
          </Space>
        );
      },
    },
    {
      title: '库存',
      key: 'stock',
      width: 120,
      render: (_, record) => {
        const stockLevel =
          record.available > 10 ? 'success' : record.available > 0 ? 'warning' : 'error';
        return (
          <Space direction="vertical" size="small">
            <Badge status={stockLevel} text={`可售: ${record.available}`} />
            <span style={{ fontSize: 12, color: '#999' }}>
              总库存: {record.stock} | 预留: {record.reserved}
            </span>
          </Space>
        );
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status, record) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          draft: { color: 'default', text: '草稿' },
          active: { color: 'success', text: '在售' },
          inactive: { color: 'warning', text: '下架' },
          archived: { color: 'default', text: '已归档' },
          deleted: { color: 'error', text: '已删除' },
        };
        // 构建OZON状态详情
        const ozonStatusDetails = [
          record.ozon_archived && '已归档',
          record.ozon_has_fbo_stocks && '有FBO库存',
          record.ozon_has_fbs_stocks && '有FBS库存',
          record.ozon_is_discounted && '促销中',
          record.ozon_visibility_status && `可见性: ${record.ozon_visibility_status}`,
        ].filter(Boolean).join(', ');

        return (
          <Space direction="vertical" size="small">
            <Tooltip title={ozonStatusDetails || 'OZON原生状态信息'}>
              <Tag color={statusMap[status]?.color}>{statusMap[status]?.text || status}</Tag>
            </Tooltip>
            {record.sync_status === 'failed' && (
              <Tooltip title={record.sync_error}>
                <Tag color="error" icon={<ExclamationCircleOutlined />}>
                  同步失败
                </Tag>
              </Tooltip>
            )}
            {/* 显示OZON库存状态 */}
            {(record.ozon_has_fbo_stocks || record.ozon_has_fbs_stocks) && (
              <Space size={4}>
                {record.ozon_has_fbo_stocks && <Tag size="small" color="blue">FBO</Tag>}
                {record.ozon_has_fbs_stocks && <Tag size="small" color="cyan">FBS</Tag>}
              </Space>
            )}
            {record.ozon_is_discounted && <Tag size="small" color="red">促销</Tag>}
          </Space>
        );
      },
    },
    {
      title: '可见性',
      dataIndex: 'visibility',
      key: 'visibility',
      width: 80,
      render: (visible) => <Switch checked={visible} disabled />,
    },
    {
      title: '创建时间',
      dataIndex: 'ozon_created_at',
      key: 'ozon_created_at',
      width: 150,
      render: (date, record) => {
        // 优先显示OZON平台创建时间，如果没有则显示本地创建时间
        const displayDate = date || record.created_at;
        if (!displayDate) return '-';
        const createDate = new Date(displayDate);

        // 格式化为 2025/9/17 18:41:21 格式
        const formatDate = (d) => {
          const year = d.getFullYear();
          const month = d.getMonth() + 1;
          const day = d.getDate();
          const hours = d.getHours().toString().padStart(2, '0');
          const minutes = d.getMinutes().toString().padStart(2, '0');
          const seconds = d.getSeconds().toString().padStart(2, '0');
          return `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;
        };

        return (
          <Tooltip title={formatDate(createDate)}>
            <span>{createDate.toLocaleDateString('zh-CN')}</span>
          </Tooltip>
        );
      },
    },
    {
      title: '最后同步',
      dataIndex: 'last_sync_at',
      key: 'last_sync_at',
      width: 120,
      render: (date) => {
        if (!date) return '-';
        const syncDate = new Date(date);
        const now = new Date();
        const diffHours = (now.getTime() - syncDate.getTime()) / (1000 * 60 * 60);

        return (
          <Tooltip title={syncDate.toLocaleString()}>
            <span style={{ color: diffHours > 24 ? '#ff4d4f' : '#52c41a' }}>
              {diffHours < 1
                ? '刚刚'
                : diffHours < 24
                  ? `${Math.floor(diffHours)}小时前`
                  : `${Math.floor(diffHours / 24)}天前`}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space>
          <Tooltip title="编辑">
            <Button
              type="text"
              size="small"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Tooltip title="更新价格">
            <Button
              type="text"
              size="small"
              icon={<DollarOutlined />}
              onClick={() => handlePriceUpdate(record)}
            />
          </Tooltip>
          <Tooltip title="更新库存">
            <Button
              type="text"
              size="small"
              icon={<ShoppingOutlined />}
              onClick={() => handleStockUpdate(record)}
            />
          </Tooltip>
          <Dropdown
            menu={{
              items: [
                {
                  key: 'sync',
                  icon: <SyncOutlined />,
                  label: '立即同步',
                },
                {
                  key: 'archive',
                  icon: <DeleteOutlined />,
                  label: '归档',
                },
                {
                  type: 'divider',
                },
                {
                  key: 'delete',
                  icon: <DeleteOutlined />,
                  label: '删除',
                  danger: true,
                },
              ],
              onClick: ({ key }) => {
                switch (key) {
                  case 'sync':
                    handleSyncSingle(record);
                    break;
                  case 'archive':
                    handleArchive(record);
                    break;
                  case 'delete':
                    handleDelete(record);
                    break;
                }
              },
            }}
          >
            <Button type="text" size="small" icon={<SettingOutlined />} />
          </Dropdown>
        </Space>
      ),
    },
  ];

  // 处理函数
  const handleEdit = (product: ozonApi.Product) => {
    setSelectedProduct(product);
    setEditModalVisible(true);
  };

  const handlePriceUpdate = (product: ozonApi.Product) => {
    setSelectedProduct(product);
    setPriceModalVisible(true);
  };

  const handleStockUpdate = (product: ozonApi.Product) => {
    setSelectedProduct(product);
    setStockModalVisible(true);
  };

  const handleBatchPriceUpdate = () => {
    if (selectedRows.length === 0) {
      message.warning('请先选择商品');
      return;
    }
    setPriceModalVisible(true);
  };

  const handleBatchStockUpdate = () => {
    if (selectedRows.length === 0) {
      message.warning('请先选择商品');
      return;
    }
    setStockModalVisible(true);
  };

  const handleSync = (fullSync: boolean = false) => {
    confirm({
      title: fullSync ? '确认执行全量同步？' : '确认执行增量同步？',
      content: fullSync ? '全量同步将拉取所有商品数据，耗时较长' : '增量同步将只拉取最近更新的商品',
      onOk: () => {
        syncProductsMutation.mutate(fullSync);
      },
    });
  };

  const handleFilter = () => {
    const values = filterForm.getFieldsValue();
    // 过滤掉空值
    const cleanedValues: ozonApi.ProductFilter = {};
    if (values.search) cleanedValues.search = values.search;
    if (values.sku) cleanedValues.sku = values.sku;
    if (values.title) cleanedValues.title = values.title;
    if (values.status) cleanedValues.status = values.status;
    if (values.has_stock !== undefined && values.has_stock !== null) {
      cleanedValues.has_stock = values.has_stock === 'true';
    }
    if (values.sync_status) cleanedValues.sync_status = values.sync_status;

    setFilterValues(cleanedValues);
    setCurrentPage(1);
    refetch();
  };

  const handleReset = () => {
    filterForm.resetFields();
    setFilterValues({});
    setCurrentPage(1);
    refetch();
  };

  // 复制到剪贴板
  const handleCopyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success(`${label} 已复制到剪贴板`);
    } catch (error) {
      // 降级方案：创建临时输入框
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      message.success(`${label} 已复制到剪贴板`);
    }
  };

  const handleSyncSingle = async (product: ozonApi.Product) => {
    confirm({
      title: '确认同步商品？',
      content: `商品SKU: ${product.sku}`,
      onOk: async () => {
        try {
          const response = await fetch(`/api/ef/v1/ozon/products/${product.id}/sync`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          const result = await response.json();

          if (result.success) {
            message.success(result.message || '商品同步成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            message.error(result.message || '商品同步失败');
          }
        } catch (error: any) {
          message.error(`同步失败: ${error.message}`);
        }
      },
    });
  };

  const handleArchive = (product: ozonApi.Product) => {
    confirm({
      title: '确认归档商品？',
      content: `商品SKU: ${product.sku}`,
      onOk: async () => {
        try {
          const response = await fetch(`/api/ef/v1/ozon/products/${product.id}/archive`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          const result = await response.json();

          if (result.success) {
            message.success(result.message || '商品归档成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            message.error(result.message || '商品归档失败');
          }
        } catch (error: any) {
          message.error(`归档失败: ${error.message}`);
        }
      },
    });
  };

  const handleDelete = (product: ozonApi.Product) => {
    confirm({
      title: '确认删除商品？',
      content: `商品SKU: ${product.sku}，此操作不可恢复！`,
      okType: 'danger',
      onOk: async () => {
        try {
          const response = await fetch(`/api/ef/v1/ozon/products/${product.id}`, {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
            },
          });

          const result = await response.json();

          if (result.success) {
            message.success(result.message || '商品删除成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            message.error(result.message || '商品删除失败');
          }
        } catch (error: any) {
          message.error(`删除失败: ${error.message}`);
        }
      },
    });
  };

  const handleImport = () => {
    setImportModalVisible(true);
  };

  const handleExport = () => {
    if (!productsData?.data || productsData.data.length === 0) {
      message.warning('没有商品数据可以导出');
      return;
    }

    try {
      // 准备CSV数据
      const csvData = productsData.data.map((product) => ({
        SKU: product.sku,
        商品标题: product.title || '',
        品牌: product.brand || '',
        条形码: product.barcode || '',
        状态: product.status,
        可见性: product.visibility ? '可见' : '不可见',
        售价: product.price || '0',
        原价: product.old_price || '',
        成本价: product.cost || '',
        总库存: product.stock,
        可售库存: product.available,
        预留库存: product.reserved,
        '重量(g)': product.weight || '',
        '宽度(mm)': product.width || '',
        '高度(mm)': product.height || '',
        '深度(mm)': product.depth || '',
        同步状态: product.sync_status,
        最后同步时间: product.last_sync_at || '',
        创建时间: product.created_at,
        更新时间: product.updated_at,
      }));

      // 转换为CSV格式
      const headers = Object.keys(csvData[0]);
      const csvContent = [
        headers.join(','),
        ...csvData.map((row) =>
          headers
            .map((header) => {
              const value = row[header as keyof typeof row];
              // 处理包含逗号的值，用双引号包围
              return typeof value === 'string' && value.includes(',') ? `"${value}"` : value;
            })
            .join(',')
        ),
      ].join('\n');

      // 创建下载
      const blob = new Blob(['\uFEFF' + csvContent], {
        type: 'text/csv;charset=utf-8;',
      });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `商品数据_${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      message.success(`成功导出 ${csvData.length} 个商品的数据`);
    } catch (error) {
      console.error('Export error:', error);
      message.error('导出失败，请重试');
    }
  };

  return (
    <div style={{ padding: 24 }}>
      {/* 同步进度显示 */}
      {syncStatus && syncStatus.status === 'running' && (
        <Alert
          message="商品同步中"
          description={
            <div>
              <p>{syncStatus.message}</p>
              <Progress percent={Math.round(syncStatus.progress)} status="active" />
            </div>
          }
          type="info"
          showIcon
          closable
          onClose={() => {
            setSyncStatus(null);
            setSyncTaskId(null);
          }}
          style={{ marginBottom: 16 }}
        />
      )}

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总商品数"
              value={globalStats?.total || 0}
              prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card
            style={{ cursor: 'pointer' }}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'active' });
              setFilterValues({ ...filterValues, status: 'active' });
            }}
          >
            <Statistic
              title={<span style={{ color: '#1890ff' }}>在售商品</span>}
              value={globalStats?.stats?.active || 0}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card
            style={{ cursor: 'pointer' }}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'inactive' });
              setFilterValues({ ...filterValues, status: 'inactive' });
            }}
          >
            <Statistic
              title={<span style={{ color: '#1890ff' }}>已下架</span>}
              value={globalStats?.stats?.inactive || 0}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic
              title="缺货商品"
              value={globalStats?.stats?.out_of_stock || 0}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 搜索过滤 */}
      <Card style={{ marginBottom: 16 }}>
        <Row style={{ marginBottom: 16 }}>
          <Col flex="auto">
            <Space size="large">
              <span style={{ fontWeight: 500 }}>选择店铺:</span>
              <ShopSelector
                value={selectedShop}
                onChange={setSelectedShop}
                showAllOption={true}
                style={{ minWidth: 200 }}
              />
            </Space>
          </Col>
        </Row>
        <Form form={filterForm} layout="inline" onFinish={handleFilter}>
          <Form.Item name="search">
            <Input placeholder="搜索 (SKU/标题/条码/产品ID)" prefix={<SearchOutlined />} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="sku">
            <Input placeholder="精确SKU" />
          </Form.Item>
          <Form.Item name="title">
            <Input placeholder="商品名称" />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" style={{ width: 120 }} allowClear>
              <Option value="active">在售</Option>
              <Option value="inactive">下架</Option>
              <Option value="draft">草稿</Option>
            </Select>
          </Form.Item>
          <Form.Item name="has_stock">
            <Select placeholder="库存状态" style={{ width: 120 }} allowClear>
              <Option value="true">有库存</Option>
              <Option value="false">无库存</Option>
            </Select>
          </Form.Item>
          <Form.Item name="sync_status">
            <Select placeholder="同步状态" style={{ width: 120 }} allowClear>
              <Option value="success">成功</Option>
              <Option value="failed">失败</Option>
              <Option value="pending">待同步</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit">
                查询
              </Button>
              <Button onClick={handleReset}>重置</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>

      {/* 操作按钮 */}
      <Card>
        <Space style={{ marginBottom: 16 }}>
          <Button
            type="primary"
            icon={<SyncOutlined />}
            onClick={() => handleSync(false)}
            loading={syncProductsMutation.isPending}
          >
            增量同步
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => handleSync(true)}
            loading={syncProductsMutation.isPending}
          >
            全量同步
          </Button>
          <Button
            icon={<DollarOutlined />}
            onClick={handleBatchPriceUpdate}
            disabled={selectedRows.length === 0}
          >
            批量调价
          </Button>
          <Button
            icon={<ShoppingOutlined />}
            onClick={handleBatchStockUpdate}
            disabled={selectedRows.length === 0}
          >
            批量改库存
          </Button>
          <Button icon={<UploadOutlined />} onClick={handleImport}>
            导入商品
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleExport}>
            导出数据
          </Button>
        </Space>

        {/* 商品表格 */}
        <Table
          columns={columns}
          dataSource={productsData?.data || []}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: 1500 }}
          pagination={{
            current: currentPage,
            pageSize: pageSize,
            total: productsData?.total || 0,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, size) => {
              setCurrentPage(page);
              setPageSize(size || 20);
            },
          }}
          rowSelection={{
            selectedRowKeys: selectedRows.map((r) => r.id),
            onChange: (_, rows) => setSelectedRows(rows),
          }}
        />
      </Card>

      {/* 价格更新弹窗 */}
      <Modal
        title={selectedProduct ? `更新价格 - ${selectedProduct.sku}` : '批量更新价格'}
        open={priceModalVisible}
        onCancel={() => setPriceModalVisible(false)}
        footer={null}
        width={600}
      >
        <Form
          layout="vertical"
          onFinish={(values) => {
            const updates = selectedProduct
              ? [
                  {
                    sku: selectedProduct.sku,
                    ...values,
                  },
                ]
              : selectedRows.map((row) => ({
                  sku: row.sku,
                  ...values,
                }));
            updatePricesMutation.mutate(updates);
          }}
        >
          <Form.Item name="price" label="售价" rules={[{ required: true, message: '请输入售价' }]}>
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              prefix="₽"
              placeholder="请输入售价"
            />
          </Form.Item>
          <Form.Item name="old_price" label="原价">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              precision={2}
              prefix="₽"
              placeholder="可选，用于显示折扣"
            />
          </Form.Item>
          <Form.Item name="reason" label="调价原因">
            <Input.TextArea rows={2} placeholder="请输入调价原因" />
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={updatePricesMutation.isPending}>
                确认更新
              </Button>
              <Button onClick={() => setPriceModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 库存更新弹窗 */}
      <Modal
        title={selectedProduct ? `更新库存 - ${selectedProduct.sku}` : '批量更新库存'}
        open={stockModalVisible}
        onCancel={() => setStockModalVisible(false)}
        footer={null}
        width={500}
      >
        <Form
          layout="vertical"
          onFinish={(values) => {
            const updates = selectedProduct
              ? [
                  {
                    sku: selectedProduct.sku,
                    ...values,
                  },
                ]
              : selectedRows.map((row) => ({
                  sku: row.sku,
                  ...values,
                }));
            updateStocksMutation.mutate(updates);
          }}
        >
          <Form.Item
            name="stock"
            label="库存数量"
            rules={[{ required: true, message: '请输入库存数量' }]}
          >
            <InputNumber style={{ width: '100%' }} min={0} placeholder="请输入库存数量" />
          </Form.Item>
          <Form.Item name="warehouse_id" label="仓库">
            <Select placeholder="选择仓库">
              <Option value={1}>主仓库</Option>
              <Option value={2}>备用仓库</Option>
            </Select>
          </Form.Item>
          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" loading={updateStocksMutation.isPending}>
                确认更新
              </Button>
              <Button onClick={() => setStockModalVisible(false)}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>

      {/* 商品编辑弹窗 */}
      <Modal
        title={`编辑商品 - ${selectedProduct?.sku}`}
        open={editModalVisible}
        onCancel={() => setEditModalVisible(false)}
        footer={null}
        width={800}
      >
        {selectedProduct && (
          <Form
            layout="vertical"
            initialValues={{
              title: selectedProduct.title,
              description: selectedProduct.description,
              brand: selectedProduct.brand,
              barcode: selectedProduct.barcode,
              price: selectedProduct.price,
              old_price: selectedProduct.old_price,
              cost: selectedProduct.cost,
              weight: selectedProduct.weight,
              width: selectedProduct.width,
              height: selectedProduct.height,
              depth: selectedProduct.depth,
            }}
            onFinish={async (values) => {
              try {
                const response = await fetch(`/api/ef/v1/ozon/products/${selectedProduct.id}`, {
                  method: 'PUT',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify(values),
                });

                const result = await response.json();

                if (result.success) {
                  message.success(result.message || '商品信息更新成功');
                  queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
                  setEditModalVisible(false);
                } else {
                  message.error(result.message || '商品信息更新失败');
                }
              } catch (error: any) {
                message.error(`更新失败: ${error.message}`);
              }
            }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="title"
                  label="商品标题"
                  rules={[{ required: true, message: '请输入商品标题' }]}
                >
                  <Input placeholder="请输入商品标题" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="brand" label="品牌">
                  <Input placeholder="请输入品牌" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item name="description" label="商品描述">
              <Input.TextArea rows={3} placeholder="请输入商品描述" />
            </Form.Item>

            <Row gutter={16}>
              <Col span={8}>
                <Form.Item name="barcode" label="条形码">
                  <Input placeholder="请输入条形码" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="price" label="售价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    precision={2}
                    prefix="₽"
                    placeholder="请输入售价"
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="old_price" label="原价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    precision={2}
                    prefix="₽"
                    placeholder="请输入原价"
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={6}>
                <Form.Item name="cost" label="成本价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    precision={2}
                    prefix="₽"
                    placeholder="成本价"
                  />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item name="weight" label="重量(g)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="重量" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="width" label="宽(mm)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="宽度" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="height" label="高(mm)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="高度" />
                </Form.Item>
              </Col>
              <Col span={4}>
                <Form.Item name="depth" label="深(mm)">
                  <InputNumber style={{ width: '100%' }} min={0} placeholder="深度" />
                </Form.Item>
              </Col>
            </Row>

            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  保存更改
                </Button>
                <Button onClick={() => setEditModalVisible(false)}>取消</Button>
              </Space>
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 商品导入弹窗 */}
      <Modal
        title="导入商品"
        open={importModalVisible}
        onCancel={() => setImportModalVisible(false)}
        footer={null}
        width={600}
      >
        <div style={{ textAlign: 'center', padding: '20px 0' }}>
          <Upload.Dragger
            name="file"
            accept=".csv,.xlsx,.xls"
            showUploadList={false}
            beforeUpload={(file) => {
              const isValidType =
                file.type === 'text/csv' ||
                file.type === 'application/vnd.ms-excel' ||
                file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

              if (!isValidType) {
                message.error('只支持 CSV 和 Excel 文件格式');
                return false;
              }

              const isLt10M = file.size / 1024 / 1024 < 10;
              if (!isLt10M) {
                message.error('文件大小不能超过 10MB');
                return false;
              }

              // 处理文件导入
              const reader = new FileReader();
              reader.onload = async (e) => {
                try {
                  const content = e.target?.result as string;
                  const base64Content = btoa(unescape(encodeURIComponent(content)));

                  const response = await fetch('/api/ef/v1/ozon/products/import', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      file_content: base64Content,
                      shop_id: 1, // 默认使用第一个店铺
                    }),
                  });

                  const result = await response.json();

                  if (result.success) {
                    message.success(result.message || '商品导入成功');
                    if (result.warnings && result.warnings.length > 0) {
                      setTimeout(() => {
                        message.warning(
                          `导入过程中发现问题：${result.warnings.slice(0, 3).join('; ')}`
                        );
                      }, 1000);
                    }
                    queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
                  } else {
                    message.error(result.message || '商品导入失败');
                  }
                } catch (error: any) {
                  message.error(`导入失败: ${error.message}`);
                }
              };

              reader.readAsText(file, 'UTF-8');
              setImportModalVisible(false);
              return false; // 阻止自动上传
            }}
          >
            <p className="ant-upload-drag-icon">
              <UploadOutlined style={{ fontSize: 48, color: '#1890ff' }} />
            </p>
            <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
            <p className="ant-upload-hint">支持 CSV 和 Excel 格式，文件大小不超过 10MB</p>
          </Upload.Dragger>

          <div style={{ marginTop: 24, textAlign: 'left' }}>
            <Alert
              message="导入说明"
              description={
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  <li>CSV 文件请使用 UTF-8 编码</li>
                  <li>必填字段：SKU、商品标题</li>
                  <li>可选字段：品牌、条形码、价格、库存等</li>
                  <li>重复SKU将更新现有商品信息</li>
                </ul>
              }
              type="info"
              showIcon
            />
          </div>

          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setImportModalVisible(false)}>取消</Button>
              <Button type="link" onClick={handleExport}>
                下载模板
              </Button>
            </Space>
          </div>
        </div>
      </Modal>

      {/* 图片预览组件 */}
      <ImagePreview
        images={previewImages}
        visible={previewVisible}
        initialIndex={previewIndex}
        onClose={() => setPreviewVisible(false)}
      />
    </div>
  );
};

export default ProductList;
