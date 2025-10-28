/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Ozon 促销活动管理页面
 */
import {
  SyncOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
  MinusOutlined,
  CopyOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Table,
  Button,
  Space,
  Card,
  Tag,
  Modal,
  Form,
  InputNumber,
  Tabs,
  Switch,
  Tooltip,
  Empty,
  Image,
  message,
} from 'antd';
import { ColumnsType } from 'antd/es/table';
import React, { useState, useEffect } from 'react';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { useCopy } from '@/hooks/useCopy';
import { useCurrency } from '@/hooks/useCurrency';
import { usePermission } from '@/hooks/usePermission';
import * as promotionApi from '@/services/ozonPromotionApi';
import { formatCurrency } from '@/utils/currency';
import { loggers } from '@/utils/logger';
import { notifySuccess, notifyError } from '@/utils/notification';

import styles from './Promotions.module.scss';

const { confirm } = Modal;

type ViewMode = 'list' | 'detail';

// 活动类型中文映射
const ACTION_TYPE_MAP: Record<string, string> = {
  STOCK_DISCOUNT: '库存折扣',
  MARKETPLACE_MULTI_LEVEL_DISCOUNT_ON_AMOUNT: '弹性提升',
};

// 活动状态中文映射
const STATUS_MAP: Record<string, string> = {
  active: '活动中',
  inactive: '未激活',
  expired: '已过期',
};

// 将UTC时间转换为莫斯科时间并格式化为日期
const formatMoscowDate = (utcDateString: string): string => {
  if (!utcDateString) return '-';
  const date = new Date(utcDateString);
  // 莫斯科时区是 UTC+3
  const moscowOffset = 3 * 60; // 3小时转换为分钟
  const localOffset = date.getTimezoneOffset(); // 本地时区相对UTC的偏移（分钟）
  const moscowTime = new Date(date.getTime() + (moscowOffset + localOffset) * 60 * 1000);

  const year = moscowTime.getFullYear();
  const month = moscowTime.getMonth() + 1;
  const day = moscowTime.getDate();

  return `${year}/${month}/${day}`;
};

// 格式化描述文本：在句子结束符后添加换行
const formatDescription = (html: string): string => {
  if (!html) return '';

  // 在句子结束符（。！？.!?）后面添加换行，但要避免影响HTML标签
  // 使用正则表达式匹配句子结束符，后面不是HTML标签的情况
  let formatted = html
    // 在中文句号、感叹号、问号后添加换行
    .replace(/([。！？])(?!<)/g, '$1<br/>')
    // 在英文句号、感叹号、问号后添加换行（但要避免数字中的点和HTML实体）
    .replace(/([.!?])(\s+)(?![0-9<])/g, '$1<br/>$2')
    // 在</p>、</li>等块级标签后不需要额外的<br/>，移除多余的
    .replace(/<br\/>\s*(<\/(p|li|div|h[1-6])>)/gi, '$1');

  return formatted;
};

// 鼠标悬浮显示大图的组件
const HoverImage: React.FC<{
  src: string;
  alt: string;
}> = ({ src, alt }) => {
  const [showPreview, setShowPreview] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent) => {
    setPosition({ x: e.clientX + 10, y: e.clientY + 10 });
  };

  return (
    <div
      onMouseEnter={() => setShowPreview(true)}
      onMouseLeave={() => setShowPreview(false)}
      onMouseMove={handleMouseMove}
      style={{ position: 'relative', display: 'inline-block' }}
    >
      <Image
        src={src}
        alt={alt}
        width={80}
        height={80}
        style={{ objectFit: 'cover', borderRadius: 4, cursor: 'pointer' }}
        preview={false}
      />
      {showPreview && (
        <div
          style={{
            position: 'fixed',
            left: position.x,
            top: position.y,
            zIndex: 9999,
            pointerEvents: 'none',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            borderRadius: 4,
          }}
        >
          <img
            src={src}
            alt={alt}
            style={{
              width: 160,
              height: 160,
              objectFit: 'cover',
              borderRadius: 4,
              border: '2px solid #fff',
            }}
          />
        </div>
      )}
    </div>
  );
};

const Promotions: React.FC = () => {
  const queryClient = useQueryClient();
  const { canOperate, canSync } = usePermission();
  const { symbol: currencySymbol } = useCurrency();
  const { copyToClipboard } = useCopy();

  // 添加样式
  React.useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .ant-space-gap-row-large {
        row-gap: 0 !important;
      }
      .promotion-description * {
        max-width: 100%;
        word-wrap: break-word;
      }
      .promotion-description p {
        margin-bottom: 8px;
      }
      .promotion-description ul, .promotion-description ol {
        margin-left: 20px;
        margin-bottom: 8px;
      }
      .promotion-description li {
        margin-bottom: 4px;
      }
      .promotion-description br {
        display: block;
        margin: 4px 0;
        content: "";
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // 生成OZON商品链接
  const getOzonProductUrl = (productId: number) => {
    return `https://www.ozon.ru/product/${productId}`;
  };

  // 基础状态
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [selectedShop, setSelectedShop] = useState<number | null>(() => {
    const saved = localStorage.getItem('ozon_selected_shop');
    if (saved && saved !== 'all') {
      return parseInt(saved, 10);
    }
    return null;
  });
  const [selectedAction, setSelectedAction] = useState<promotionApi.PromotionAction | null>(null);

  // 详情视图状态
  const [activeTab, setActiveTab] = useState<'candidates' | 'active'>('candidates');
  const [selectedCandidateRows, setSelectedCandidateRows] = useState<
    promotionApi.PromotionProduct[]
  >([]);
  const [selectedActiveRows, setSelectedActiveRows] = useState<promotionApi.PromotionProduct[]>([]);

  // 弹窗状态
  const [activateModalVisible, setActivateModalVisible] = useState(false);
  const [activateForm] = Form.useForm();

  // 保存店铺选择
  useEffect(() => {
    if (selectedShop) {
      localStorage.setItem('ozon_selected_shop', selectedShop.toString());
    }
  }, [selectedShop]);

  // 查询活动列表
  const { data: actionsData, isLoading: actionsLoading } = useQuery({
    queryKey: ['promotion-actions', selectedShop],
    queryFn: async () => {
      if (!selectedShop) return null;
      const response = await promotionApi.getActions(selectedShop);
      if (!response.ok) {
        throw new Error(response.error?.detail || 'Failed to fetch actions');
      }
      return response.data;
    },
    enabled: !!selectedShop && viewMode === 'list',
  });

  // 查询候选商品
  const { data: candidatesData, isLoading: candidatesLoading } = useQuery({
    queryKey: ['promotion-candidates', selectedShop, selectedAction?.action_id],
    queryFn: async () => {
      if (!selectedShop || !selectedAction) return null;
      const response = await promotionApi.getCandidates(selectedShop, selectedAction.action_id);
      if (!response.ok) {
        throw new Error(response.error?.detail || 'Failed to fetch candidates');
      }
      return response.data;
    },
    enabled:
      !!selectedShop && !!selectedAction && viewMode === 'detail' && activeTab === 'candidates',
  });

  // 查询参与商品
  const { data: activeProductsData, isLoading: activeProductsLoading } = useQuery({
    queryKey: ['promotion-active-products', selectedShop, selectedAction?.action_id],
    queryFn: async () => {
      if (!selectedShop || !selectedAction) return null;
      const response = await promotionApi.getActiveProducts(selectedShop, selectedAction.action_id);
      if (!response.ok) {
        throw new Error(response.error?.detail || 'Failed to fetch active products');
      }
      return response.data;
    },
    enabled: !!selectedShop && !!selectedAction && viewMode === 'detail' && activeTab === 'active',
  });

  // 同步促销数据
  const syncMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShop) throw new Error('Please select a shop');
      return await promotionApi.syncPromotions(selectedShop);
    },
    onSuccess: (response) => {
      if (response.ok) {
        notifySuccess('同步成功', `同步了 ${response.data?.synced_actions} 个活动`);
        queryClient.invalidateQueries({ queryKey: ['promotion-actions'] });
      } else {
        notifyError('同步失败', response.error?.detail || '未知错误');
      }
    },
    onError: (error: any) => {
      loggers.promotion.error('Sync promotions failed:', error);
      notifyError('同步失败', error.message || '未知错误');
    },
  });

  // 设置自动取消
  const setAutoCancelMutation = useMutation({
    mutationFn: async ({ actionId, enabled }: { actionId: number; enabled: boolean }) => {
      if (!selectedShop) throw new Error('Please select a shop');
      return await promotionApi.setAutoCancel(selectedShop, actionId, { enabled });
    },
    onSuccess: (response, variables) => {
      if (response.ok) {
        notifySuccess('设置成功', `已${variables.enabled ? '开启' : '关闭'}自动取消`);
        queryClient.invalidateQueries({ queryKey: ['promotion-actions'] });
      } else {
        notifyError('设置失败', response.error?.detail || '未知错误');
      }
    },
    onError: (error: any) => {
      loggers.promotion.error('Set auto cancel failed:', error);
      notifyError('设置失败', error.message || '未知错误');
    },
  });

  // 添加商品到促销
  const activateProductsMutation = useMutation({
    mutationFn: async (products: promotionApi.ActivateProductRequest[]) => {
      if (!selectedShop || !selectedAction) throw new Error('Invalid state');
      return await promotionApi.activateProducts(selectedShop, selectedAction.action_id, {
        products,
      });
    },
    onSuccess: (response) => {
      if (response.ok) {
        notifySuccess('添加成功', `成功添加 ${response.data?.success_count} 个商品`);
        setActivateModalVisible(false);
        activateForm.resetFields();
        setSelectedCandidateRows([]);
        queryClient.invalidateQueries({ queryKey: ['promotion-candidates'] });
        queryClient.invalidateQueries({ queryKey: ['promotion-active-products'] });
        queryClient.invalidateQueries({ queryKey: ['promotion-actions'] });
      } else {
        notifyError('添加失败', response.error?.detail || '未知错误');
      }
    },
    onError: (error: any) => {
      loggers.promotion.error('Activate products failed:', error);
      notifyError('添加失败', error.message || '未知错误');
    },
  });

  // 取消商品促销
  const deactivateProductsMutation = useMutation({
    mutationFn: async (productIds: number[]) => {
      if (!selectedShop || !selectedAction) throw new Error('Invalid state');
      return await promotionApi.deactivateProducts(selectedShop, selectedAction.action_id, {
        product_ids: productIds,
      });
    },
    onSuccess: (response) => {
      if (response.ok) {
        notifySuccess('取消成功', `成功取消 ${response.data?.success_count} 个商品`);
        setSelectedActiveRows([]);
        queryClient.invalidateQueries({ queryKey: ['promotion-active-products'] });
        queryClient.invalidateQueries({ queryKey: ['promotion-actions'] });
      } else {
        notifyError('取消失败', response.error?.detail || '未知错误');
      }
    },
    onError: (error: any) => {
      loggers.promotion.error('Deactivate products failed:', error);
      notifyError('取消失败', error.message || '未知错误');
    },
  });

  // 设置加入方式
  const setAddModeMutation = useMutation({
    mutationFn: async ({
      productId,
      addMode,
    }: {
      productId: number;
      addMode: 'manual' | 'automatic';
    }) => {
      if (!selectedShop || !selectedAction) throw new Error('Invalid state');
      return await promotionApi.setAddMode(selectedShop, selectedAction.action_id, productId, {
        add_mode: addMode,
      });
    },
    onSuccess: (response, variables) => {
      if (response.ok) {
        notifySuccess('设置成功', `已设置为${variables.addMode === 'manual' ? '手动' : '自动'}`);
        queryClient.invalidateQueries({ queryKey: ['promotion-active-products'] });
      } else {
        notifyError('设置失败', response.error?.detail || '未知错误');
      }
    },
    onError: (error: any) => {
      loggers.promotion.error('Set add mode failed:', error);
      notifyError('设置失败', error.message || '未知错误');
    },
  });

  // 活动列表列定义
  const actionColumns: ColumnsType<promotionApi.PromotionAction> = [
    {
      title: '活动ID',
      dataIndex: 'action_id',
      key: 'action_id',
      width: 90,
      fixed: 'left',
    },
    {
      title: '活动名称',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      fixed: 'left',
      render: (title: string, record: promotionApi.PromotionAction) => (
        <Button
          type="link"
          onClick={() => {
            setSelectedAction(record);
            setViewMode('detail');
            setActiveTab('candidates');
          }}
          style={{ padding: 0, height: 'auto' }}
        >
          {title}
        </Button>
      ),
    },
    {
      title: '活动类型',
      dataIndex: 'action_type',
      key: 'action_type',
      width: 100,
      render: (type: string) => ACTION_TYPE_MAP[type] || type || '-',
    },
    {
      title: () => (
        <Tooltip title="参与状态">
          <span>状态</span>
        </Tooltip>
      ),
      dataIndex: 'is_participating',
      key: 'is_participating',
      width: 70,
      render: (value: boolean) => (
        <Tag color={value ? 'green' : 'default'}>{value ? '是' : '否'}</Tag>
      ),
    },
    {
      title: () => (
        <Tooltip title="有目标定位">
          <span>定位</span>
        </Tooltip>
      ),
      dataIndex: 'with_targeting',
      key: 'with_targeting',
      width: 70,
      render: (value: boolean) => (
        <Tag color={value ? 'blue' : 'default'}>{value ? '是' : '否'}</Tag>
      ),
    },
    {
      title: () => (
        <Tooltip title="优惠券活动">
          <span>优惠券</span>
        </Tooltip>
      ),
      dataIndex: 'is_voucher_action',
      key: 'is_voucher_action',
      width: 80,
      render: (value: boolean) => (
        <Tag color={value ? 'purple' : 'default'}>{value ? '是' : '否'}</Tag>
      ),
    },
    {
      title: '活动状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status: string) => {
        const colorMap: Record<string, string> = {
          active: 'green',
          inactive: 'default',
          expired: 'red',
        };
        return (
          <Tag color={colorMap[status] || 'default'}>{STATUS_MAP[status] || status || '-'}</Tag>
        );
      },
    },
    {
      title: () => (
        <Tooltip title="开始时间 (莫斯科)">
          <span>开始时间</span>
        </Tooltip>
      ),
      dataIndex: 'date_start',
      key: 'date_start',
      width: 90,
      render: (date: string) => formatMoscowDate(date),
    },
    {
      title: () => (
        <Tooltip title="结束时间 (莫斯科)">
          <span>结束时间</span>
        </Tooltip>
      ),
      dataIndex: 'date_end',
      key: 'date_end',
      width: 90,
      render: (date: string) => formatMoscowDate(date),
    },
    {
      title: () => (
        <Tooltip title="候选商品">
          <span>候选</span>
        </Tooltip>
      ),
      dataIndex: 'candidate_count',
      key: 'candidate_count',
      width: 70,
      render: (count: number) => <Tag color="blue">{count || 0}</Tag>,
    },
    {
      title: () => (
        <Tooltip title="参与商品">
          <span>参与</span>
        </Tooltip>
      ),
      dataIndex: 'active_count',
      key: 'active_count',
      width: 70,
      render: (count: number) => <Tag color="green">{count || 0}</Tag>,
    },
    {
      title: '自动取消',
      dataIndex: 'auto_cancel_enabled',
      key: 'auto_cancel_enabled',
      width: 90,
      fixed: 'right',
      render: (enabled: boolean, record) => (
        <Switch
          checked={enabled}
          onChange={(checked) => {
            setAutoCancelMutation.mutate({ actionId: record.action_id, enabled: checked });
          }}
          disabled={!canOperate}
        />
      ),
    },
  ];

  // 候选商品列定义
  const candidateColumns: ColumnsType<promotionApi.PromotionProduct> = [
    {
      title: '商品图片',
      dataIndex: 'images',
      key: 'images',
      width: 100,
      render: (images: { primary?: string; additional?: string[] }) => {
        const imageUrl = images?.primary;
        return imageUrl ? (
          <HoverImage src={imageUrl} alt="商品图片" />
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
              fontSize: 12,
              color: '#999',
            }}
          >
            无图片
          </div>
        );
      },
    },
    {
      title: '商品信息',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record: promotionApi.PromotionProduct) => (
        <div>
          <div style={{ marginBottom: 4 }}>
            {record.ozon_product_id ? (
              <a
                href={getOzonProductUrl(record.ozon_product_id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: 500, color: '#1890ff' }}
              >
                {title || '未知商品'}
              </a>
            ) : (
              <span style={{ fontWeight: 500 }}>{title || '未知商品'}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            <Space size={4}>
              <span>SKU: {record.ozon_sku || '-'}</span>
              {record.ozon_sku && (
                <Tooltip title="复制SKU">
                  <CopyOutlined
                    style={{ cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => copyToClipboard(String(record.ozon_sku), 'SKU')}
                  />
                </Tooltip>
              )}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: '当前价格',
      dataIndex: 'price',
      key: 'price',
      width: 120,
      render: (price: number) => (price ? formatCurrency(price, currencySymbol) : '-'),
    },
    {
      title: '当前库存',
      dataIndex: 'stock',
      key: 'stock',
      width: 100,
    },
  ];

  // 参与商品列定义
  const activeProductColumns: ColumnsType<promotionApi.PromotionProduct> = [
    {
      title: '商品图片',
      dataIndex: 'images',
      key: 'images',
      width: 100,
      render: (images: { primary?: string; additional?: string[] }) => {
        const imageUrl = images?.primary;
        return imageUrl ? (
          <HoverImage src={imageUrl} alt="商品图片" />
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
              fontSize: 12,
              color: '#999',
            }}
          >
            无图片
          </div>
        );
      },
    },
    {
      title: '商品信息',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (title: string, record: promotionApi.PromotionProduct) => (
        <div>
          <div style={{ marginBottom: 4 }}>
            {record.ozon_product_id ? (
              <a
                href={getOzonProductUrl(record.ozon_product_id)}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontWeight: 500, color: '#1890ff' }}
              >
                {title || '未知商品'}
              </a>
            ) : (
              <span style={{ fontWeight: 500 }}>{title || '未知商品'}</span>
            )}
          </div>
          <div style={{ fontSize: 12, color: '#888' }}>
            <Space size={4}>
              <span>SKU: {record.ozon_sku || '-'}</span>
              {record.ozon_sku && (
                <Tooltip title="复制SKU">
                  <CopyOutlined
                    style={{ cursor: 'pointer', color: '#1890ff' }}
                    onClick={() => copyToClipboard(String(record.ozon_sku), 'SKU')}
                  />
                </Tooltip>
              )}
            </Space>
          </div>
        </div>
      ),
    },
    {
      title: '价格对比',
      key: 'price_comparison',
      width: 160,
      render: (_: unknown, record: promotionApi.PromotionProduct) => {
        const originalPrice = record.price || 0;
        const promoPrice = record.promotion_price || 0;
        const discount =
          originalPrice > 0 ? (((originalPrice - promoPrice) / originalPrice) * 100).toFixed(1) : 0;
        return (
          <div>
            <div style={{ fontSize: 12, color: '#888', textDecoration: 'line-through' }}>
              原价: {formatCurrency(originalPrice, currencySymbol)}
            </div>
            <div style={{ fontWeight: 500, color: '#ff4d4f', fontSize: 14 }}>
              促销: {formatCurrency(promoPrice, currencySymbol)}
            </div>
            {Number(discount) > 0 && (
              <Tag color="red" style={{ marginTop: 4 }}>
                -{discount}%
              </Tag>
            )}
          </div>
        );
      },
    },
    {
      title: '库存信息',
      key: 'stock_info',
      width: 120,
      render: (_: unknown, record: promotionApi.PromotionProduct) => (
        <div>
          <div style={{ fontSize: 12, color: '#888' }}>总库存: {record.stock || 0}</div>
          <div style={{ fontWeight: 500, color: '#1890ff' }}>
            促销: {record.promotion_stock || 0}
          </div>
        </div>
      ),
    },
    {
      title: '加入方式',
      dataIndex: 'add_mode',
      key: 'add_mode',
      width: 120,
      render: (mode: string, record) => (
        <Tooltip title="手动加入的商品不会被自动取消">
          <Switch
            checkedChildren="手动"
            unCheckedChildren="自动"
            checked={mode === 'manual'}
            onChange={(checked) => {
              setAddModeMutation.mutate({
                productId: record.product_id,
                addMode: checked ? 'manual' : 'automatic',
              });
            }}
            disabled={!canOperate}
          />
        </Tooltip>
      ),
    },
  ];

  // 处理参加促销
  const handleActivateProducts = () => {
    if (selectedCandidateRows.length === 0) {
      notifyError('请选择商品', '请至少选择一个商品');
      return;
    }
    setActivateModalVisible(true);
  };

  // 处理取消促销
  const handleDeactivateProducts = () => {
    if (selectedActiveRows.length === 0) {
      notifyError('请选择商品', '请至少选择一个商品');
      return;
    }

    confirm({
      title: '确认取消促销',
      content: `确定要取消 ${selectedActiveRows.length} 个商品的促销吗？`,
      onOk: () => {
        const productIds = selectedActiveRows.map((row) => row.product_id);
        deactivateProductsMutation.mutate(productIds);
      },
    });
  };

  // 提交参加促销表单
  const handleActivateSubmit = () => {
    activateForm.validateFields().then((values) => {
      const products = selectedCandidateRows.map((row) => ({
        product_id: row.product_id,
        promotion_price: values[`price_${row.product_id}`].toString(),
        promotion_stock: values[`stock_${row.product_id}`],
      }));
      activateProductsMutation.mutate(products);
    });
  };

  // 渲染活动列表视图
  const renderListView = () => (
    <Card>
      <Space direction="vertical" style={{ width: '100%', gap: 0 }}>
        {/* 工具栏 */}
        <div style={{ marginBottom: 16 }}>
          <Space>
            <ShopSelector
              value={selectedShop}
              onChange={(value) => setSelectedShop(typeof value === 'number' ? value : value[0])}
              showAllOption={false}
              style={{ width: 200 }}
            />
            <Button
              type="primary"
              icon={<SyncOutlined />}
              onClick={() => syncMutation.mutate()}
              loading={syncMutation.isPending}
              disabled={!selectedShop || !canSync}
            >
              同步促销数据
            </Button>
          </Space>
        </div>

        {/* 活动列表表格 */}
        <Table
          columns={actionColumns}
          dataSource={actionsData || []}
          loading={actionsLoading}
          rowKey="id"
          locale={{
            emptyText: selectedShop ? (
              <Empty description="暂无促销活动，请点击同步按钮获取数据" />
            ) : (
              <Empty description="请先选择店铺" />
            ),
          }}
        />
      </Space>
    </Card>
  );

  // 渲染活动详情视图
  const renderDetailView = () => {
    if (!selectedAction) return null;

    return (
      <Card>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          {/* 返回按钮和活动信息 */}
          <Space>
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={() => {
                setViewMode('list');
                setSelectedAction(null);
                setSelectedCandidateRows([]);
                setSelectedActiveRows([]);
              }}
            >
              返回列表
            </Button>
            <span style={{ fontSize: 16, fontWeight: 'bold' }}>{selectedAction.title}</span>
            <Tag color={selectedAction.action_status === 'RUNNING' ? 'green' : 'default'}>
              {selectedAction.action_status}
            </Tag>
          </Space>

          {/* 活动描述 */}
          {selectedAction.description && (
            <Card
              size="small"
              style={{
                backgroundColor: '#f5f5f5',
                border: '1px solid #d9d9d9',
              }}
            >
              <div
                dangerouslySetInnerHTML={{ __html: formatDescription(selectedAction.description) }}
                style={{
                  lineHeight: '1.8',
                  whiteSpace: 'normal',
                  wordBreak: 'break-word',
                  overflowWrap: 'break-word',
                }}
                className="promotion-description"
              />
            </Card>
          )}

          {/* 标签页 */}
          <Tabs
            activeKey={activeTab}
            onChange={(key) => setActiveTab(key as 'candidates' | 'active')}
            items={[
              {
                key: 'candidates',
                label: `可用促销商品 (${selectedAction.candidate_count || 0})`,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    {/* 操作按钮 */}
                    <Space>
                      <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={handleActivateProducts}
                        disabled={selectedCandidateRows.length === 0 || !canOperate}
                      >
                        参加促销 ({selectedCandidateRows.length})
                      </Button>
                    </Space>

                    {/* 候选商品表格 */}
                    <Table
                      columns={candidateColumns}
                      dataSource={candidatesData || []}
                      loading={candidatesLoading}
                      rowKey="id"
                      rowSelection={{
                        selectedRowKeys: selectedCandidateRows.map((row) => row.id),
                        onChange: (_selectedRowKeys, selectedRows) => {
                          setSelectedCandidateRows(selectedRows);
                        },
                      }}
                    />
                  </Space>
                ),
              },
              {
                key: 'active',
                label: `参与活动商品 (${selectedAction.active_count || 0})`,
                children: (
                  <Space direction="vertical" style={{ width: '100%' }} size="middle">
                    {/* 操作按钮 */}
                    <Space>
                      <Button
                        danger
                        icon={<MinusOutlined />}
                        onClick={handleDeactivateProducts}
                        disabled={selectedActiveRows.length === 0 || !canOperate}
                      >
                        取消促销 ({selectedActiveRows.length})
                      </Button>
                    </Space>

                    {/* 参与商品表格 */}
                    <Table
                      columns={activeProductColumns}
                      dataSource={activeProductsData || []}
                      loading={activeProductsLoading}
                      rowKey="id"
                      rowSelection={{
                        selectedRowKeys: selectedActiveRows.map((row) => row.id),
                        onChange: (_selectedRowKeys, selectedRows) => {
                          setSelectedActiveRows(selectedRows);
                        },
                      }}
                    />
                  </Space>
                ),
              },
            ]}
          />
        </Space>
      </Card>
    );
  };

  return (
    <div className={styles.pageWrapper}>
      <PageTitle title="促销活动管理" />
      {viewMode === 'list' ? renderListView() : renderDetailView()}

      {/* 参加促销弹窗 */}
      <Modal
        title="设置促销价格和库存"
        open={activateModalVisible}
        onOk={handleActivateSubmit}
        onCancel={() => {
          setActivateModalVisible(false);
          activateForm.resetFields();
        }}
        width={600}
        confirmLoading={activateProductsMutation.isPending}
      >
        <Form form={activateForm} layout="vertical">
          {selectedCandidateRows.map((row) => (
            <Card key={row.id} size="small" style={{ marginBottom: 16 }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                <Space>
                  {row.images?.primary && (
                    <Image
                      src={row.images.primary}
                      alt={row.title}
                      width={60}
                      height={60}
                      style={{ objectFit: 'cover', borderRadius: 4 }}
                    />
                  )}
                  <div>
                    <div>
                      <strong>{row.title || '未知商品'}</strong>
                    </div>
                    <div style={{ color: '#888', fontSize: 12 }}>
                      SKU: {row.sku || '-'} | 当前价格:{' '}
                      {formatCurrency(row.price || 0, currencySymbol)}
                    </div>
                  </div>
                </Space>
                <Space>
                  <Form.Item
                    name={`price_${row.product_id}`}
                    label="促销价格"
                    rules={[{ required: true, message: '请输入促销价格' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber
                      min={0}
                      precision={2}
                      addonBefore={currencySymbol}
                      style={{ width: 200 }}
                      placeholder={`当前: ${(row.price || 0).toFixed(2)}`}
                    />
                  </Form.Item>
                  <Form.Item
                    name={`stock_${row.product_id}`}
                    label="促销库存"
                    rules={[{ required: true, message: '请输入促销库存' }]}
                    style={{ marginBottom: 0 }}
                  >
                    <InputNumber
                      min={0}
                      style={{ width: 150 }}
                      placeholder={`当前: ${row.stock || 0}`}
                    />
                  </Form.Item>
                </Space>
              </Space>
            </Card>
          ))}
        </Form>
      </Modal>
    </div>
  );
};

export default Promotions;
