/**
 * OZON 商品列表表格列配置
 * 提取自 ProductList.tsx，用于减少主文件复杂度
 */
import {
  EditOutlined,
  DollarOutlined,
  ShoppingOutlined,
  SyncOutlined,
  DeleteOutlined,
  EllipsisOutlined,
  ReloadOutlined,
  FileImageOutlined,
} from '@ant-design/icons';
import { Button, Tag, Dropdown, Tooltip, Space, Switch } from 'antd';
import { ColumnsType } from 'antd/es/table';
import React from 'react';

import ProductImage from '@/components/ozon/ProductImage';
import type * as ozonApi from '@/services/ozon';
import { formatPriceWithCurrency } from '@/utils/currency';

// 列配置工厂函数的参数接口
 
export interface ProductTableColumnsParams {
  handleEdit: (product: ozonApi.Product) => void;
  handlePriceUpdate: (product: ozonApi.Product) => void;
  handleStockUpdate: (product: ozonApi.Product) => void;
  handleSyncSingle: (product: ozonApi.Product) => Promise<void>;
  handleArchive: (product: ozonApi.Product) => void;
  handleRestore?: (product: ozonApi.Product) => void;
  handleDelete?: (product: ozonApi.Product) => void;
  handleWatermark?: (product: ozonApi.Product) => void;
  handleImageClick: (product: ozonApi.Product, images: string[], index?: number) => void;
  copyToClipboard: (text: string, label: string) => void;
  canOperate: boolean;
  canSync: boolean;
  canDelete: boolean;
  SortableColumnTitle: React.FC<{ title: string; field: string }>;
  onErrorClick?: (productId: number) => void;
}
 

// 状态映射配置
export const statusMap: Record<string, { text: string; color: string }> = {
  on_sale: { text: '在售', color: 'success' },
  draft: { text: '草稿', color: 'default' },
  archived: { text: '已归档', color: 'error' },
  moderating: { text: '审核中', color: 'processing' },
  rejected: { text: '已拒绝', color: 'error' },
  disabled: { text: '已禁用', color: 'default' },
};

/**
 * 获取商品列表表格列配置
 */
export const getProductTableColumns = (
  params: ProductTableColumnsParams
): ColumnsType<ozonApi.Product> => {
  const {
    handleEdit,
    handlePriceUpdate,
    handleStockUpdate,
    handleSyncSingle,
    handleArchive,
    handleRestore,
    handleDelete,
    handleWatermark,
    handleImageClick,
    copyToClipboard,
    canOperate,
    canSync,
    canDelete,
    SortableColumnTitle,
    onErrorClick,
  } = params;

  return [
    // 第一列：图片（80px）- 使用统一的 ProductImage 组件
    {
      title: '图片',
      key: 'image',
      width: 80,
      render: (_, record) => {
        const allImages: string[] = [];
        if (record.images?.primary) {
          allImages.push(record.images.primary);
        }
        if (record.images?.additional && Array.isArray(record.images.additional)) {
          allImages.push(...record.images.additional);
        }

        return (
          <ProductImage
            imageUrl={record.images?.primary}
            size="small"
            hoverBehavior="medium"
            name={record.title}
            topLeftCorner="link"
            sku={record.ozon_sku?.toString()}
            offerId={record.offer_id}
            onClick={() => handleImageClick(record, allImages)}
          />
        );
      },
    },
    // 第二列：SKU信息（100px）
    {
      title: 'SKU',
      key: 'sku',
      width: 100,
      render: (_, record) => {
        const copyIcon = (
          <div style={{ position: 'relative', width: '12px', height: '12px' }}>
            <div
              style={{
                position: 'absolute',
                top: '2px',
                left: '2px',
                width: '8px',
                height: '8px',
                border: '1px solid #666',
                backgroundColor: 'white',
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: '0px',
                left: '0px',
                width: '8px',
                height: '8px',
                border: '1px solid #666',
                backgroundColor: 'white',
              }}
            />
          </div>
        );

        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {/* 商品货号 */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                width: '100%',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {record.offer_id}
              </span>
              <Button
                type="text"
                size="small"
                icon={copyIcon}
                onClick={() => copyToClipboard(record.offer_id, '商品货号')}
                style={{ padding: '0 4px', height: '18px', minWidth: '18px' }}
                title="复制商品货号"
              />
            </div>
            {/* SKU */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                width: '100%',
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {record.ozon_sku || '-'}
              </span>
              {record.ozon_sku && (
                <Button
                  type="text"
                  size="small"
                  icon={copyIcon}
                  onClick={() => copyToClipboard(String(record.ozon_sku), 'SKU')}
                  style={{ padding: '0 4px', height: '18px', minWidth: '18px' }}
                  title="复制SKU"
                />
              )}
            </div>
          </Space>
        );
      },
    },
    // 第三列：标题（自适应宽度）
    {
      title: <SortableColumnTitle title="商品名称" field="title" />,
      dataIndex: 'title',
      key: 'title',
      render: (text) => {
        const displayText = text && text.length > 80 ? text.substring(0, 80) + '...' : text;
        return text && text.length > 80 ? (
          <Tooltip title={text}>
            <span>{displayText}</span>
          </Tooltip>
        ) : (
          <span>{displayText || '-'}</span>
        );
      },
    },
    // 第四列：价格（80px）
    {
      title: <SortableColumnTitle title="价格" field="price" />,
      key: 'price',
      width: 80,
      render: (_, record) => {
        const price = parseFloat(record.price || '0');
        const oldPrice = record.old_price ? parseFloat(record.old_price) : null;

        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {/* 当前价格（绿色加粗） */}
            <span style={{ fontWeight: 'bold', color: '#52c41a', fontSize: 13 }}>
              {formatPriceWithCurrency(price, record.currency_code)}
            </span>
            {/* 划线价（如果有old_price且大于当前价格） */}
            {oldPrice && oldPrice > price && (
              <span
                style={{
                  textDecoration: 'line-through',
                  color: '#999',
                  fontSize: 11,
                }}
              >
                {formatPriceWithCurrency(oldPrice, record.currency_code)}
              </span>
            )}
          </Space>
        );
      },
    },
    // 第五列：库存（80px）
    {
      title: <SortableColumnTitle title="库存" field="stock" />,
      key: 'stock',
      width: 80,
      render: (_, record) => {
        // 如果有仓库库存详情，按仓库显示
        if (record.warehouse_stocks && record.warehouse_stocks.length > 0) {
          return (
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              {record.warehouse_stocks.map((ws, index) => {
                // 提取仓库名称缩写（取前4个字符）
                const warehouseAbbr = ws.warehouse_name?.substring(0, 4) || `W${ws.warehouse_id}`;
                const totalStock = ws.present + ws.reserved;

                return (
                  <span key={index} style={{ fontSize: 12 }}>
                    {warehouseAbbr}:
                    <span style={{ fontWeight: 600, marginLeft: '4px' }}>{totalStock}</span>
                  </span>
                );
              })}
            </Space>
          );
        }

        // 降级：如果没有仓库库存详情，显示总计
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <span style={{ fontSize: 12 }}>
              可售: <span style={{ fontWeight: 600, marginLeft: '4px' }}>{record.available}</span>
            </span>
            <span style={{ fontSize: 12, color: '#999' }}>
              库存: <span style={{ marginLeft: '4px' }}>{record.stock}</span>
            </span>
            <span style={{ fontSize: 12, color: '#999' }}>
              预留: <span style={{ marginLeft: '4px' }}>{record.reserved}</span>
            </span>
          </Space>
        );
      },
    },
    // 第六列：销量（100px）
    {
      title: <SortableColumnTitle title="销量" field="sales_count" />,
      key: 'sales_count',
      width: 100,
      render: (_, record) => {
        const salesCount = record.sales_count || 0;
        const lastSaleAt = record.last_sale_at;

        // 格式化日期：YYYY-MM-DD
        const formatSaleDate = (dateStr: string) => {
          if (!dateStr) return null;
          const date = new Date(dateStr);
          const year = date.getFullYear();
          const month = (date.getMonth() + 1).toString().padStart(2, '0');
          const day = date.getDate().toString().padStart(2, '0');
          return `${year}-${month}-${day}`;
        };

        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            {/* 销量 */}
            <span
              style={{
                fontWeight: salesCount > 0 ? 'bold' : 'normal',
                color: salesCount > 0 ? '#ff4d4f' : undefined,
                fontSize: 13,
              }}
            >
              {salesCount > 0 ? salesCount : '-'}
            </span>
            {/* 最后销售时间 */}
            {lastSaleAt && (
              <span style={{ fontSize: 11, color: '#999' }}>
                {formatSaleDate(lastSaleAt)}
              </span>
            )}
          </Space>
        );
      },
    },
    // 第七列：状态（80px）
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status, record) => {
        const statusMap: Record<string, { color: string; text: string }> = {
          on_sale: { color: 'success', text: '销售中' },
          ready_to_sell: { color: 'warning', text: '准备' },
          error: { color: 'error', text: '错误' },
          pending_modification: { color: 'processing', text: '待修改' },
          inactive: { color: 'default', text: '下架' },
          archived: { color: 'default', text: '归档' },
          draft: { color: 'default', text: '草稿' },
          active: { color: 'success', text: '在售' },
          deleted: { color: 'error', text: '已删除' },
        };

        const isError = status === 'error';
        const handleErrorClick = () => {
          if (isError && onErrorClick) {
            onErrorClick(record.id);
          }
        };

        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Tag
              color={statusMap[status]?.color}
              style={{ cursor: isError ? 'pointer' : 'default' }}
              onClick={handleErrorClick}
            >
              {statusMap[status]?.text || status}
            </Tag>
            <div style={{ fontSize: 11, color: '#999' }}>
              {record.ozon_has_fbs_stocks && <div>FBS</div>}
            </div>
          </Space>
        );
      },
    },
    // 第七列：可见性（80px）
    {
      title: '可见性',
      dataIndex: 'visibility',
      key: 'visibility',
      width: 80,
      render: (visible) => <Switch checked={visible} disabled size="small" />,
    },
    // 第八列：创建时间（110px）
    {
      title: <SortableColumnTitle title="创建时间" field="created_at" />,
      dataIndex: 'ozon_created_at',
      key: 'created_at',
      width: 110,
      render: (date, record) => {
        const displayDate = date || record.created_at;
        if (!displayDate) return '-';
        const createDate = new Date(displayDate);

        const formatDate = (d) => {
          const year = d.getFullYear();
          const month = d.getMonth() + 1;
          const day = d.getDate();
          const hours = d.getHours().toString().padStart(2, '0');
          const minutes = d.getMinutes().toString().padStart(2, '0');
          return `${year}/${month}/${day} ${hours}:${minutes}`;
        };

        return (
          <Tooltip title={formatDate(createDate)}>
            <span style={{ fontSize: 12 }}>{createDate.toLocaleDateString('zh-CN')}</span>
          </Tooltip>
        );
      },
    },
    // 第九列：操作（60px）
    {
      title: '操作',
      key: 'action',
      width: 60,
      fixed: 'right',
      render: (_, record) => {
        // 归档商品：只显示"恢复"和"删除"
        if (record.is_archived) {
          return (
            <Dropdown
              menu={{
                items: [
                  canOperate && {
                    key: 'restore',
                    icon: <ReloadOutlined />,
                    label: '恢复',
                  },
                  canDelete && {
                    type: 'divider' as const,
                  },
                  canDelete && {
                    key: 'delete',
                    icon: <DeleteOutlined />,
                    label: '删除',
                    danger: true,
                  },
                ].filter(Boolean),
                onClick: ({ key }) => {
                  switch (key) {
                    case 'restore':
                      handleRestore(record);
                      break;
                    case 'delete':
                      handleDelete(record);
                      break;
                  }
                },
              }}
            >
              <Button type="text" size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          );
        }

        // 下架商品：显示"编辑"、"更新价格"和"归档"
        if (record.status === 'inactive') {
          return (
            <Dropdown
              menu={{
                items: [
                  canOperate && {
                    key: 'edit',
                    icon: <EditOutlined />,
                    label: '编辑',
                  },
                  canOperate && {
                    key: 'price',
                    icon: <DollarOutlined />,
                    label: '价格',
                  },
                  canOperate && {
                    type: 'divider' as const,
                  },
                  canOperate && {
                    key: 'archive',
                    icon: <DeleteOutlined />,
                    label: '归档',
                  },
                ].filter(Boolean),
                onClick: ({ key }) => {
                  switch (key) {
                    case 'edit':
                      handleEdit(record);
                      break;
                    case 'price':
                      handlePriceUpdate(record);
                      break;
                    case 'archive':
                      handleArchive(record);
                      break;
                  }
                },
              }}
            >
              <Button type="text" size="small" icon={<EllipsisOutlined />} />
            </Dropdown>
          );
        }

        // 其他状态：显示完整的操作菜单
        return (
          <Dropdown
            menu={{
              items: [
                canOperate && {
                  key: 'edit',
                  icon: <EditOutlined />,
                  label: '编辑',
                },
                canOperate && {
                  key: 'price',
                  icon: <DollarOutlined />,
                  label: '价格',
                },
                canOperate && {
                  key: 'stock',
                  icon: <ShoppingOutlined />,
                  label: '库存',
                },
                canOperate && handleWatermark && {
                  key: 'watermark',
                  icon: <FileImageOutlined />,
                  label: '图片',
                },
                (canOperate || canSync) && {
                  type: 'divider' as const,
                },
                canSync && {
                  key: 'sync',
                  icon: <SyncOutlined />,
                  label: '同步',
                },
                canOperate && {
                  key: 'archive',
                  icon: <DeleteOutlined />,
                  label: '归档',
                },
              ].filter(Boolean),
              onClick: ({ key }) => {
                switch (key) {
                  case 'edit':
                    handleEdit(record);
                    break;
                  case 'price':
                    handlePriceUpdate(record);
                    break;
                  case 'stock':
                    handleStockUpdate(record);
                    break;
                  case 'watermark':
                    handleWatermark?.(record);
                    break;
                  case 'sync':
                    handleSyncSingle(record);
                    break;
                  case 'archive':
                    handleArchive(record);
                    break;
                }
              },
            }}
          >
            <Button type="text" size="small" icon={<EllipsisOutlined />} />
          </Dropdown>
        );
      },
    },
  ];
};
