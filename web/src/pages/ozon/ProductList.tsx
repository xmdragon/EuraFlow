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
  PictureOutlined,
  RollbackOutlined,
  EllipsisOutlined,
  LinkOutlined,
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
  Tooltip,
  Badge,
  Switch,
  InputNumber,
  Form,
  Progress,
  Alert,
  Upload,
  Image,
  Divider,
  Radio,
  Popover,
  Avatar,
} from 'antd';
import { ColumnsType } from 'antd/es/table';
import React, { useState, useEffect } from 'react';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';

import * as ozonApi from '@/services/ozonApi';
import * as watermarkApi from '@/services/watermarkApi';
import { formatRuble, calculateMargin, formatPriceWithCurrency, getCurrencySymbol } from '../../utils/currency';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import { notifySuccess, notifyError, notifyWarning, notifyInfo } from '@/utils/notification';
import ShopSelector from '@/components/ozon/ShopSelector';
import ImagePreview from '@/components/ImagePreview';
import './ProductList.css';
import styles from './ProductList.module.scss';

const { Option } = Select;
const { confirm } = Modal;

// 西里尔字母到拉丁字母的音译映射表
const translitMap: Record<string, string> = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'yo', 'ж': 'zh',
  'з': 'z', 'и': 'i', 'й': 'y', 'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o',
  'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f', 'х': 'h', 'ц': 'ts',
  'ч': 'ch', 'ш': 'sh', 'щ': 'sch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya'
};

// 将商品标题转换为OZON URL slug格式（拉丁字母）
const generateOzonSlug = (title: string): string => {
  if (!title) return '';

  // 转换为小写并音译西里尔字母
  const transliterated = title.toLowerCase().split('').map(char => {
    return translitMap[char] || char;
  }).join('');

  return transliterated
    .trim()
    .replace(/[^a-z0-9\s-]/g, '') // 只保留拉丁字母、数字、空格和连字符
    .replace(/\s+/g, '-') // 将空格替换为连字符
    .replace(/-+/g, '-') // 将多个连字符替换为单个
    .replace(/^-|-$/g, ''); // 移除首尾的连字符
};

const ProductList: React.FC = () => {
  const queryClient = useQueryClient();

  // 状态管理
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [selectedRows, setSelectedRows] = useState<ozonApi.Product[]>([]);
  // 初始化时从localStorage读取店铺选择，默认为null让用户手动选择
  const [selectedShop, setSelectedShop] = useState<number | null>(() => {
    const saved = localStorage.getItem('ozon_selected_shop');
    if (saved && saved !== 'all') {
      return parseInt(saved, 10);
    }
    return null; // 默认不选择任何店铺
  });
  const [filterForm] = Form.useForm();
  const [priceModalVisible, setPriceModalVisible] = useState(false);
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<ozonApi.Product | null>(null);
  const [syncTaskId, setSyncTaskId] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<any>(null);
  const [filterValues, setFilterValues] = useState<ozonApi.ProductFilter>({ status: 'on_sale' });

  // 排序状态管理
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc' | null>(null);

  // 列显示配置状态管理（从localStorage加载）
  const [visibleColumns, setVisibleColumns] = useState<Record<string, boolean>>(() => {
    const saved = localStorage.getItem('ozon_product_visible_columns');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse visible columns config:', e);
      }
    }
    // 默认显示所有列
    return {
      sku: true,
      info: true,
      price: true,
      stock: true,
      status: true,
      visibility: true,
      created_at: true,
      last_sync: true,
      actions: true, // 操作列始终显示
    };
  });
  const [columnConfigVisible, setColumnConfigVisible] = useState(false);

  // 水印相关状态
  const [watermarkModalVisible, setWatermarkModalVisible] = useState(false);
  const [watermarkConfigs, setWatermarkConfigs] = useState<watermarkApi.WatermarkConfig[]>([]);
  const [selectedWatermarkConfig, setSelectedWatermarkConfig] = useState<number | null>(null);
  const [watermarkBatchId, setWatermarkBatchId] = useState<string | null>(null);
  const [watermarkStep, setWatermarkStep] = useState<'select' | 'preview'>('select');
  const [watermarkPreviews, setWatermarkPreviews] = useState<any[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [watermarkAnalyzeMode, setWatermarkAnalyzeMode] = useState<'individual' | 'fast'>('individual');
  // 手动选择的水印位置 Map<productId_imageIndex, position>
  const [manualPositions, setManualPositions] = useState<Map<string, string>>(new Map());
  // 每张图片的独立水印设置 Map<productId_imageIndex, {watermarkId, position}>
  const [imageWatermarkSettings, setImageWatermarkSettings] = useState<Map<string, {watermarkId: number, position?: string}>>(new Map());

  // 图片预览状态
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [currentPreviewProduct, setCurrentPreviewProduct] = useState<any>(null);

  // 保存列配置到localStorage
  useEffect(() => {
    localStorage.setItem('ozon_product_visible_columns', JSON.stringify(visibleColumns));
  }, [visibleColumns]);

  // 处理排序
  const handleSort = (field: string) => {
    if (sortBy === field) {
      // 同一字段：无排序 → 升序 → 降序 → 无排序
      if (sortOrder === null) {
        setSortOrder('asc');
      } else if (sortOrder === 'asc') {
        setSortOrder('desc');
      } else {
        setSortBy(null);
        setSortOrder(null);
      }
    } else {
      // 切换到新字段，默认升序
      setSortBy(field);
      setSortOrder('asc');
    }
    // 重置到第一页
    setCurrentPage(1);
  };

  // 列标题排序组件
  const SortableColumnTitle: React.FC<{ title: string; field: string }> = ({ title, field }) => {
    const isActive = sortBy === field;
    const isAsc = isActive && sortOrder === 'asc';
    const isDesc = isActive && sortOrder === 'desc';

    return (
      <div
        style={{
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '4px',
          userSelect: 'none',
        }}
        onClick={() => handleSort(field)}
      >
        <span>{title}</span>
        <span style={{ display: 'inline-flex', flexDirection: 'column', fontSize: '10px' }}>
          <span style={{ lineHeight: 1, color: isAsc ? '#1890ff' : '#bfbfbf' }}>▲</span>
          <span style={{ lineHeight: 1, color: isDesc ? '#1890ff' : '#bfbfbf' }}>▼</span>
        </span>
      </div>
    );
  };

  // 查询商品列表
  const {
    data: productsData,
    isLoading,
    refetch,
  } = useQuery({
    queryKey: ['ozonProducts', currentPage, pageSize, selectedShop, filterValues, sortBy, sortOrder],
    queryFn: () => {
      const params: ozonApi.ProductFilter = {
        ...filterValues,
        shop_id: selectedShop,
      };
      // 添加排序参数
      if (sortBy && sortOrder) {
        params.sort_by = sortBy;
        params.sort_order = sortOrder;
      }
      return ozonApi.getProducts(currentPage, pageSize, params);
    },
    refetchInterval: 30000, // 30秒自动刷新
    // 只有选中店铺后才发送请求
    enabled: selectedShop !== null && selectedShop !== undefined,
    staleTime: 5000, // 数据5秒内不会被认为是过期的
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
  });

  // 查询全局统计数据（不受筛选影响）
  const { data: globalStats } = useQuery({
    queryKey: ['ozonStatistics', selectedShop],
    queryFn: () => ozonApi.getStatistics(selectedShop),
    refetchInterval: 30000, // 30秒自动刷新
    // 只有选中店铺后才发送请求
    enabled: selectedShop !== null && selectedShop !== undefined,
    staleTime: 5000, // 数据5秒内不会被认为是过期的
    retry: 1, // 减少重试次数
    retryDelay: 1000, // 重试延迟1秒
  });

  // 同步商品
  const syncProductsMutation = useMutation({
    mutationFn: (fullSync: boolean) => ozonApi.syncProducts(selectedShop, fullSync),
    onSuccess: (data) => {
      notifySuccess('同步已启动', '商品同步任务已启动');
      setSyncTaskId(data.task_id);
      setSyncStatus({
        status: 'running',
        progress: 0,
        message: '正在启动同步...',
      });
    },
    onError: (error: any) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 批量更新价格
  const updatePricesMutation = useMutation({
    mutationFn: (updates: ozonApi.PriceUpdate[]) => ozonApi.updatePrices(updates, selectedShop || undefined),
    onSuccess: () => {
      notifySuccess('更新成功', '价格更新成功');
      setPriceModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
    onError: (error: any) => {
      notifyError('更新失败', `价格更新失败: ${error.message}`);
    },
  });

  // 查询水印配置
  const { data: watermarkConfigsData } = useQuery({
    queryKey: ['watermarkConfigs'],
    queryFn: () => watermarkApi.getWatermarkConfigs(),
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
    retry: 1, // 减少重试次数
    // 静默失败：水印配置查询失败不影响商品列表显示
    throwOnError: false,
    // 查询失败时不显示错误，仅记录到控制台
    onError: (error: any) => {
      console.warn('水印配置加载失败，水印功能将不可用:', error);
    },
  });

  useEffect(() => {
    if (watermarkConfigsData) {
      setWatermarkConfigs(watermarkConfigsData);
    }
  }, [watermarkConfigsData]);

  // 设置表单默认值为"销售中"
  useEffect(() => {
    filterForm.setFieldsValue({ status: 'on_sale' });
  }, [filterForm]);

  // 预加载当前页所有商品的大图（160x160）
  useEffect(() => {
    if (productsData?.data && productsData.data.length > 0) {
      productsData.data.forEach(product => {
        if (product.images?.primary) {
          const img = new Image();
          img.src = optimizeOzonImageUrl(product.images.primary, 160);
        }
      });
    }
  }, [productsData]);

  // 应用水印 - 默认使用异步模式
  const applyWatermarkMutation = useMutation({
    mutationFn: ({ productIds, configId, analyzeMode = 'individual', positionOverrides }: {
      productIds: number[],
      configId: number,
      analyzeMode?: 'individual' | 'fast',
      positionOverrides?: Record<string, Record<string, string>>
    }) =>
      watermarkApi.applyWatermarkBatch(selectedShop!, productIds, configId, false, analyzeMode, positionOverrides),  // 强制使用异步模式
    onSuccess: (data) => {
      console.log('Watermark batch response:', data);

      if (!data.batch_id) {
        notifyError('任务启动失败', '未获取到任务ID，请重试');
        return;
      }

      // 异步模式 - 启动轮询
      notifyInfo('水印处理已启动', `水印批处理已在后台启动，任务ID: ${data.batch_id}`);
      setWatermarkBatchId(data.batch_id);

      // 延迟1秒后开始轮询，给后端时间创建任务
      setTimeout(() => {
        console.log('Starting polling for batch:', data.batch_id);
        pollWatermarkTasks(data.batch_id);
      }, 1000);

      setWatermarkModalVisible(false);
      setSelectedRows([]);
    },
    onError: (error: any) => {
      notifyError('水印应用失败', `水印应用失败: ${error.message}`);
    },
  });

  // 还原原图
  const restoreOriginalMutation = useMutation({
    mutationFn: (productIds: number[]) =>
      watermarkApi.restoreOriginalBatch(selectedShop!, productIds),
    onSuccess: (data) => {
      notifySuccess('原图还原已启动', `原图还原已启动，任务ID: ${data.batch_id}`);
      setSelectedRows([]);
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
    onError: (error: any) => {
      notifyError('原图还原失败', `原图还原失败: ${error.message}`);
    },
  });

  // 轮询水印任务状态
  const pollWatermarkTasks = async (batchId: string) => {
    console.log('Starting to poll watermark tasks for batch:', batchId);
    let completed = 0;
    let failed = 0;
    let hasShownProgress = false;
    let pollCount = 0;

    const interval = setInterval(async () => {
      pollCount++;
      console.log(`Polling attempt ${pollCount} for batch ${batchId}`);

      try {
        const tasks = await watermarkApi.getTasks({ shop_id: selectedShop!, batch_id: batchId });
        console.log('Tasks received:', tasks);

        completed = tasks.filter(t => t.status === 'completed').length;
        failed = tasks.filter(t => t.status === 'failed').length;
        const processing = tasks.filter(t => t.status === 'processing').length;
        const pending = tasks.filter(t => t.status === 'pending').length;
        const total = tasks.length;

        console.log(`Status: ${completed} completed, ${failed} failed, ${processing} processing, ${pending} pending, total: ${total}`);

        // 显示进度
        if (!hasShownProgress && (completed > 0 || processing > 0)) {
          hasShownProgress = true;
          notifyInfo('水印处理中', `水印处理进度：${completed}/${total} 完成`);
        }

        // 如果所有任务都完成了（无论成功还是失败）
        if (total > 0 && completed + failed === total) {
          clearInterval(interval);

          // 使用通知而不是普通消息，更醒目
          if (failed > 0) {
            notifyWarning('水印批处理完成', `成功处理 ${completed} 个商品，失败 ${failed} 个商品`);
          } else {
            notifySuccess('水印批处理成功', `已成功为 ${completed} 个商品添加水印`);
          }

          queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          setWatermarkBatchId(null);
        }
      } catch (error: any) {
        console.error('Failed to poll watermark tasks:', error);

        // 如果连续失败3次，停止轮询
        if (pollCount >= 3) {
          clearInterval(interval);
          message.destroy(); // 清除loading消息

          notification.error({
            message: '任务状态查询失败',
            description: `无法获取水印处理进度：${error?.message || '网络错误'}。请刷新页面查看结果`,
            duration: 0, // 不自动关闭
            placement: 'topRight'
          });
        }
      }
    }, 3000);

    // 5分钟后自动停止轮询
    setTimeout(() => {
      clearInterval(interval);
      message.destroy(); // 清除所有消息

      if (completed + failed === 0) {
        notification.warning({
          message: '任务超时',
          description: '水印处理时间过长，请稍后刷新页面查看结果',
          duration: 0, // 不自动关闭
          placement: 'topRight'
        });
      }
    }, 300000);
  };

  // 轮询同步任务状态
  useEffect(() => {
    if (!syncTaskId || syncStatus?.status === 'completed' || syncStatus?.status === 'failed') {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const result = await ozonApi.getSyncStatus(syncTaskId);
        const status = result.data || result; // 兼容不同响应格式
        setSyncStatus(status);

        if (status.status === 'completed') {
          notifySuccess('同步完成', '商品同步已完成！');
          queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          // 刷新页面数据
          refetch();
          setSyncTaskId(null);
        } else if (status.status === 'failed') {
          notifyError('同步失败', `同步失败: ${status.error || '未知错误'}`);
          setSyncTaskId(null);
        }
      } catch (error) {
        console.error('Failed to fetch sync status:', error);
      }
    }, 2000); // 每2秒检查一次

    return () => clearInterval(interval);
  }, [syncTaskId, syncStatus?.status, queryClient]);

  // 处理图片点击
  const handleImageClick = (product: any, images: string[], index: number = 0) => {
    setCurrentPreviewProduct(product);
    setPreviewImages(images);
    setPreviewIndex(index);
    setPreviewVisible(true);
  };

  // 批量更新库存
  const updateStocksMutation = useMutation({
    mutationFn: (updates: ozonApi.StockUpdate[]) => ozonApi.updateStocks(updates, selectedShop || undefined),
    onSuccess: () => {
      notifySuccess('更新成功', '库存更新成功');
      setStockModalVisible(false);
      queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
    },
    onError: (error: any) => {
      notifyError('更新失败', `库存更新失败: ${error.message}`);
    },
  });

  // 表格列定义
  const allColumns: ColumnsType<ozonApi.Product> = [
    // 第一列：图片（80px）
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

        const productUrl = record.ozon_sku
          ? `https://ozon.ru/product/${generateOzonSlug(record.title)}-${record.ozon_sku}`
          : '';

        const imageUrl80 = record.images?.primary
          ? optimizeOzonImageUrl(record.images.primary, 80)
          : '';
        const imageUrl160 = record.images?.primary
          ? optimizeOzonImageUrl(record.images.primary, 160)
          : '';

        return (
          <div style={{ position: 'relative', width: '80px', height: '80px' }}>
            {record.images?.primary ? (
              <Popover
                content={<img src={imageUrl160} width={160} alt={record.title} />}
                trigger="hover"
              >
                <div style={{ position: 'relative', width: '80px', height: '80px' }}>
                  <Avatar
                    src={imageUrl80}
                    size={80}
                    shape="square"
                    style={{ border: '1px solid #f0f0f0' }}
                  />
                  {/* 左上角链接图标 */}
                  {productUrl && (
                    <Button
                      type="text"
                      size="small"
                      icon={<LinkOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        window.open(productUrl, '_blank');
                      }}
                      style={{
                        position: 'absolute',
                        top: '2px',
                        left: '2px',
                        width: '20px',
                        height: '20px',
                        padding: 0,
                        backgroundColor: 'rgba(255, 255, 255, 0.9)',
                        borderRadius: '2px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                      title="在OZON查看"
                    />
                  )}
                  {/* 右上角放大镜图标 */}
                  <Button
                    type="text"
                    size="small"
                    icon={<SearchOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleImageClick(record, allImages);
                    }}
                    style={{
                      position: 'absolute',
                      top: '2px',
                      right: '2px',
                      width: '20px',
                      height: '20px',
                      padding: 0,
                      backgroundColor: 'rgba(255, 255, 255, 0.9)',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                    title="查看图片"
                  />
                </div>
              </Popover>
            ) : (
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: '#f5f5f5',
                  border: '1px dashed #d9d9d9',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#bfbfbf',
                }}
              >
                <FileImageOutlined style={{ fontSize: '24px' }} />
              </div>
            )}
          </div>
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
        );

        return (
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            {/* 商品货号 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {record.offer_id}
              </span>
              <Button
                type="text"
                size="small"
                icon={copyIcon}
                onClick={() => handleCopyToClipboard(record.offer_id, '商品货号')}
                style={{ padding: '0 4px', height: '18px', minWidth: '18px' }}
                title="复制商品货号"
              />
            </div>
            {/* SKU */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', width: '100%' }}>
              <span style={{ fontSize: 12, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {record.ozon_sku || '-'}
              </span>
              {record.ozon_sku && (
                <Button
                  type="text"
                  size="small"
                  icon={copyIcon}
                  onClick={() => handleCopyToClipboard(String(record.ozon_sku), 'SKU')}
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
            {/* 定价（如果有old_price，显示它作为定价） */}
            {oldPrice && oldPrice > price && (
              <span style={{ fontSize: 11, color: '#999' }}>
                {formatPriceWithCurrency(oldPrice, record.currency_code)}
              </span>
            )}
            {/* 当前价格（绿色） */}
            <span style={{ fontWeight: 'bold', color: '#52c41a', fontSize: 13 }}>
              {formatPriceWithCurrency(price, record.currency_code)}
            </span>
            {/* 划线价（如果有） */}
            {oldPrice && oldPrice > price && (
              <span style={{ textDecoration: 'line-through', color: '#999', fontSize: 11 }}>
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
      render: (_, record) => (
        <Space direction="vertical" size={2} style={{ width: '100%' }}>
          <span style={{ fontSize: 12 }}>可售: {record.available}</span>
          <span style={{ fontSize: 12, color: '#999' }}>总: {record.stock}</span>
          <span style={{ fontSize: 12, color: '#999' }}>预留: {record.reserved}</span>
        </Space>
      ),
    },
    // 第六列：状态（80px）
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

        const statusDetails = record.status_reason || [
          record.ozon_archived && '已归档',
          record.ozon_has_fbo_stocks && '有FBO库存',
          record.ozon_has_fbs_stocks && '有FBS库存',
          record.ozon_is_discounted && '促销中',
        ].filter(Boolean).join(', ') || '状态正常';

        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Tag color={statusMap[status]?.color}>{statusMap[status]?.text || status}</Tag>
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
      render: (_, record) => (
        <Dropdown
          menu={{
            items: [
              {
                key: 'edit',
                icon: <EditOutlined />,
                label: '编辑',
              },
              {
                key: 'price',
                icon: <DollarOutlined />,
                label: '更新价格',
              },
              {
                key: 'stock',
                icon: <ShoppingOutlined />,
                label: '更新库存',
              },
              {
                type: 'divider',
              },
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
                case 'edit':
                  handleEdit(record);
                  break;
                case 'price':
                  handlePriceUpdate(record);
                  break;
                case 'stock':
                  handleStockUpdate(record);
                  break;
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
          <Button type="text" size="small" icon={<EllipsisOutlined />} />
        </Dropdown>
      ),
    },
  ];


  // 根据visibleColumns过滤显示的列
  const columns = allColumns.filter((col) => {
    const key = col.key as string;
    // 操作列始终显示
    if (key === 'action') return true;
    // 其他列根据配置显示
    return visibleColumns[key] !== false;
  });

  // 列显示配置变更处理
  const handleColumnVisibilityChange = (key: string, visible: boolean) => {
    setVisibleColumns((prev) => ({
      ...prev,
      [key]: visible,
    }));
  };

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
      notifyWarning('操作失败', '请先选择商品');
      return;
    }
    setPriceModalVisible(true);
  };

  const handleBatchStockUpdate = () => {
    if (selectedRows.length === 0) {
      notifyWarning('操作失败', '请先选择商品');
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
    filterForm.setFieldsValue({ status: 'on_sale' }); // 重置后保持"销售中"为默认值
    setFilterValues({ status: 'on_sale' });
    setCurrentPage(1);
    refetch();
  };

  // 复制到剪贴板
  const handleCopyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notifySuccess('复制成功', `${label} 已复制到剪贴板`);
    } catch (error) {
      // 降级方案：创建临时输入框
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      notifySuccess('复制成功', `${label} 已复制到剪贴板`);
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
            notifySuccess('同步成功', result.message || '商品同步成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('同步失败', result.message || '商品同步失败');
          }
        } catch (error: any) {
          notifyError('同步失败', `同步失败: ${error.message}`);
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
            notifySuccess('归档成功', result.message || '商品归档成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('归档失败', result.message || '商品归档失败');
          }
        } catch (error: any) {
          notifyError('归档失败', `归档失败: ${error.message}`);
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
            notifySuccess('删除成功', result.message || '商品删除成功');
            queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
          } else {
            notifyError('删除失败', result.message || '商品删除失败');
          }
        } catch (error: any) {
          notifyError('删除失败', `删除失败: ${error.message}`);
        }
      },
    });
  };

  // 计算大预览图上的水印样式
  const getPreviewWatermarkStyle = (position: string | undefined, config: any) => {
    if (!position || !config) return {};

    const scale = config.scale_ratio || 0.1;
    const opacity = config.opacity || 0.8;
    const margin = config.margin_pixels || 20;

    const styles: any = {
      opacity: opacity,
      width: `${scale * 100}%`,
      maxWidth: '200px', // 限制最大尺寸
      zIndex: 10,
      transition: 'all 0.2s ease'
    };

    // 根据位置设置对齐方式
    switch (position) {
      case 'top_left':
        styles.top = `${margin}px`;
        styles.left = `${margin}px`;
        break;
      case 'top_center':
        styles.top = `${margin}px`;
        styles.left = '50%';
        styles.transform = 'translateX(-50%)';
        break;
      case 'top_right':
        styles.top = `${margin}px`;
        styles.right = `${margin}px`;
        break;
      case 'center_left':
        styles.top = '50%';
        styles.left = `${margin}px`;
        styles.transform = 'translateY(-50%)';
        break;
      case 'center_right':
        styles.top = '50%';
        styles.right = `${margin}px`;
        styles.transform = 'translateY(-50%)';
        break;
      case 'bottom_left':
        styles.bottom = `${margin}px`;
        styles.left = `${margin}px`;
        break;
      case 'bottom_center':
        styles.bottom = `${margin}px`;
        styles.left = '50%';
        styles.transform = 'translateX(-50%)';
        break;
      case 'bottom_right':
      default:
        styles.bottom = `${margin}px`;
        styles.right = `${margin}px`;
        break;
    }

    return styles;
  };

  // 处理手动选择位置变更
  const handlePositionChange = async (productId: number, imageIndex: number, position: string) => {
    // 找到对应的预览数据并更新
    const updatedPreviews = watermarkPreviews.map(preview => {
      if (preview.product_id === productId) {
        return {
          ...preview,
          images: preview.images?.map((img: any, idx: number) => {
            if ((img.image_index || idx) === imageIndex) {
              // 这里可以触发重新生成预览，暂时只更新位置标记
              return {
                ...img,
                suggested_position: position,
                manual_position: position
              };
            }
            return img;
          })
        };
      }
      return preview;
    });

    setWatermarkPreviews(updatedPreviews);
  };

  const handleImport = () => {
    setImportModalVisible(true);
  };

  const handleExport = () => {
    if (!productsData?.data || productsData.data.length === 0) {
      notifyWarning('导出失败', '没有商品数据可以导出');
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

      notifySuccess('导出成功', `成功导出 ${csvData.length} 个商品的数据`);
    } catch (error) {
      console.error('Export error:', error);
      notifyError('导出失败', '导出失败，请重试');
    }
  };

  return (
    <div>
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
          style={{ marginBottom: 8 }}
        />
      )}

      {/* 统计卡片 */}
      <Row gutter={8} style={{ marginBottom: 8 }}>
        <Col span={6}>
          <Card>
            <Statistic
              title="总商品数"
              value={globalStats?.products?.total || 0}
              prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            className={`${styles.statsCard} ${styles.success}`}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'on_sale' });
              setFilterValues({ ...filterValues, status: 'on_sale' });
            }}
          >
            <Statistic
              title={<span className={styles.title}>销售中</span>}
              value={globalStats?.products?.on_sale || 0}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            className={`${styles.statsCard} ${styles.warning}`}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'ready_to_sell' });
              setFilterValues({ ...filterValues, status: 'ready_to_sell' });
            }}
          >
            <Statistic
              title={<span className={styles.title}>准备销售</span>}
              value={globalStats?.products?.ready_to_sell || 0}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            className={`${styles.statsCard} ${styles.error}`}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'error' });
              setFilterValues({ ...filterValues, status: 'error' });
            }}
          >
            <Statistic
              title={<span className={styles.title}>错误</span>}
              value={globalStats?.products?.error || 0}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            className={`${styles.statsCard} ${styles.info}`}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'pending_modification' });
              setFilterValues({ ...filterValues, status: 'pending_modification' });
            }}
          >
            <Statistic
              title={<span className={styles.title}>待修改</span>}
              value={globalStats?.products?.pending_modification || 0}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            className={`${styles.statsCard} ${styles.inactive}`}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'inactive' });
              setFilterValues({ ...filterValues, status: 'inactive' });
            }}
          >
            <Statistic
              title={<span className={styles.title}>已下架</span>}
              value={globalStats?.products?.inactive || 0}
            />
          </Card>
        </Col>
        <Col span={4}>
          <Card
            className={`${styles.statsCard} ${styles.archived}`}
            onClick={() => {
              filterForm.setFieldsValue({ status: 'archived' });
              setFilterValues({ ...filterValues, status: 'archived' });
            }}
          >
            <Statistic
              title={<span className={styles.title}>已归档</span>}
              value={globalStats?.products?.archived || 0}
            />
          </Card>
        </Col>
      </Row>

      {/* 搜索过滤 */}
      <Card className={styles.filterCard}>
        <Row className={styles.filterRow}>
          <Col flex="auto">
            <Space size="large">
              <span className={styles.shopLabel}>选择店铺:</span>
              <ShopSelector
                value={selectedShop}
                onChange={(shopId) => {
                  const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
                  setSelectedShop(normalized);
                  // 切换店铺时重置页码和选中的行
                  setCurrentPage(1);
                  setSelectedRows([]);
                  // 保存到localStorage
                  localStorage.setItem('ozon_selected_shop', normalized?.toString() || '');
                }}
                showAllOption={false}
                className={styles.shopSelector}
              />
            </Space>
          </Col>
        </Row>
        <Form form={filterForm} layout="inline" onFinish={handleFilter}>
          <Form.Item name="search">
            <Input placeholder="搜索 (SKU/标题/条码/产品ID)" prefix={<SearchOutlined />} style={{ width: 200 }} />
          </Form.Item>
          <Form.Item name="status">
            <Select placeholder="状态" style={{ width: 120 }} allowClear>
              <Option value="on_sale">销售中</Option>
              <Option value="ready_to_sell">准备销售</Option>
              <Option value="error">错误</Option>
              <Option value="pending_modification">待修改</Option>
              <Option value="inactive">下架</Option>
              <Option value="archived">已归档</Option>
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
      <Card className={styles.productListCard}>
        <div className={styles.actionWrapper}>
          <Space>
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
          <Tooltip title="列显示设置">
            <Button
              icon={<SettingOutlined />}
              onClick={() => setColumnConfigVisible(true)}
            >
              列设置
            </Button>
          </Tooltip>
        </div>

        {/* 商品表格 */}
        <Table
          columns={columns}
          dataSource={productsData?.data || []}
          rowKey="id"
          loading={isLoading}
          scroll={{ x: true }}
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
              formatter={getNumberFormatter(2)}
              parser={getNumberParser()}
              prefix={selectedProduct ? getCurrencySymbol(selectedProduct.currency_code) : (selectedRows.length > 0 ? getCurrencySymbol(selectedRows[0].currency_code) : '¥')}
              placeholder="请输入售价"
            />
          </Form.Item>
          <Form.Item name="old_price" label="原价">
            <InputNumber
              style={{ width: '100%' }}
              min={0}
              formatter={getNumberFormatter(2)}
              parser={getNumberParser()}
              prefix={selectedProduct ? getCurrencySymbol(selectedProduct.currency_code) : (selectedRows.length > 0 ? getCurrencySymbol(selectedRows[0].currency_code) : '¥')}
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
                  notifySuccess('更新成功', result.message || '商品信息更新成功');
                  queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
                  setEditModalVisible(false);
                } else {
                  notifyError('更新失败', result.message || '商品信息更新失败');
                }
              } catch (error: any) {
                notifyError('更新失败', `更新失败: ${error.message}`);
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
                    formatter={getNumberFormatter(2)}
              parser={getNumberParser()}
                    prefix={getCurrencySymbol(selectedProduct?.currency_code)}
                    placeholder="请输入售价"
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item name="old_price" label="原价">
                  <InputNumber
                    style={{ width: '100%' }}
                    min={0}
                    formatter={getNumberFormatter(2)}
              parser={getNumberParser()}
                    prefix={getCurrencySymbol(selectedProduct?.currency_code)}
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
                    formatter={getNumberFormatter(2)}
              parser={getNumberParser()}
                    prefix={getCurrencySymbol(selectedProduct?.currency_code)}
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
                notifyError('上传失败', '只支持 CSV 和 Excel 文件格式');
                return false;
              }

              const isLt10M = file.size / 1024 / 1024 < 10;
              if (!isLt10M) {
                notifyError('上传失败', '文件大小不能超过 10MB');
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
                      shop_id: selectedShop || undefined, // 使用当前选中的店铺
                    }),
                  });

                  const result = await response.json();

                  if (result.success) {
                    notifySuccess('导入成功', result.message || '商品导入成功');
                    if (result.warnings && result.warnings.length > 0) {
                      setTimeout(() => {
                        notifyWarning(
                          '导入警告',
                          `导入过程中发现问题：${result.warnings.slice(0, 3).join('; ')}`
                        );
                      }, 1000);
                    }
                    queryClient.invalidateQueries({ queryKey: ['ozonProducts'] });
                  } else {
                    notifyError('导入失败', result.message || '商品导入失败');
                  }
                } catch (error: any) {
                  notifyError('导入失败', `导入失败: ${error.message}`);
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

      {/* 水印应用模态框 */}
      <Modal
        title={watermarkStep === 'select' ? '选择水印配置' : '预览水印效果'}
        open={watermarkModalVisible}
        onCancel={() => {
          setWatermarkModalVisible(false);
          setWatermarkStep('select');
          setWatermarkPreviews([]);
          setManualPositions(new Map());
        }}
        onOk={async () => {
          if (watermarkStep === 'select') {
            if (!selectedWatermarkConfig) {
              notifyWarning('操作失败', '请选择水印配置');
              return;
            }
            // 进入预览步骤
            setPreviewLoading(true);
            try {
              const productIds = selectedRows.slice(0, 10).map(p => p.id); // 最多预览10个
              const result = await watermarkApi.previewWatermarkBatch(
                selectedShop!,
                productIds,
                selectedWatermarkConfig,
                watermarkAnalyzeMode === 'individual' // 根据选择的模式决定是否单独分析
              );
              setWatermarkPreviews(result.previews);
              setWatermarkStep('preview');
              // 初始化手动位置为空，使用算法推荐的位置
              setManualPositions(new Map());
              // 初始化每张图片的水印设置为空
              setImageWatermarkSettings(new Map());
            } catch (error) {
              notifyError('预览失败', '预览失败');
            } finally {
              setPreviewLoading(false);
            }
          } else {
            // 确认应用水印
            const productIds = selectedRows.map((p) => p.id);

            // 构建每张图片的独立配置映射
            const imageOverrides: any = {};
            imageWatermarkSettings.forEach((settings, key) => {
              const [productId, imageIndex] = key.split('_');
              if (!imageOverrides[productId]) {
                imageOverrides[productId] = {};
              }
              imageOverrides[productId][imageIndex] = {
                watermark_config_id: settings.watermarkId,
                position: settings.position
              };
            });

            // 如果没有独立设置，使用旧的位置映射逻辑
            if (Object.keys(imageOverrides).length === 0) {
              manualPositions.forEach((position, key) => {
                const [productId, imageIndex] = key.split('_');
                if (!imageOverrides[productId]) {
                  imageOverrides[productId] = {};
                }
                imageOverrides[productId][imageIndex] = {
                  watermark_config_id: selectedWatermarkConfig,
                  position: position
                };
              });
            }

            applyWatermarkMutation.mutate({
              productIds,
              configId: selectedWatermarkConfig!,
              analyzeMode: watermarkAnalyzeMode,
              positionOverrides: Object.keys(imageOverrides).length > 0 ? imageOverrides : undefined
            });
          }
        }}
        okText={watermarkStep === 'select' ? '预览效果' : '确认应用'}
        confirmLoading={applyWatermarkMutation.isPending || previewLoading}
        width={watermarkStep === 'preview' ? 1200 : 600}
      >
        <div>
          <Alert
            message={`已选择 ${selectedRows.length} 个商品`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />

          {/* 位置选择提示 */}
          <div style={{ marginBottom: 16 }}>
            <Alert
              message="位置选择说明"
              description={
                <div>
                  <p>• 预览时请点击图片上的9宫格选择水印位置</p>
                  <p>• 未手动选择的图片将在应用时自动分析最佳位置</p>
                  <p>• 蓝色高亮表示当前选择的位置</p>
                </div>
              }
              type="info"
              showIcon
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={{ marginRight: 8 }}>选择水印:</label>
            <Select
              style={{ width: '100%' }}
              placeholder="请选择水印配置"
              value={selectedWatermarkConfig}
              onChange={(value) => setSelectedWatermarkConfig(value)}
            >
              {watermarkConfigs.map((config) => (
                <Option key={config.id} value={config.id}>
                  <Space>
                    <img
                      src={optimizeOzonImageUrl(config.image_url, 20)}
                      alt={config.name}
                      style={{ width: 20, height: 20, objectFit: 'contain' }}
                    />
                    <span>{config.name}</span>
                    <Tag>{config.color_type}</Tag>
                    <span style={{ color: '#999', fontSize: 12 }}>
                      {(config.scale_ratio * 100).toFixed(0)}% / {(config.opacity * 100).toFixed(0)}%
                    </span>
                  </Space>
                </Option>
              ))}
            </Select>
          </div>

          {watermarkBatchId && (
            <Progress
              percent={50}
              status="active"
              showInfo={true}
              strokeColor={{ '0%': '#108ee9', '100%': '#87d068' }}
            />
          )}

          {/* 预览结果 */}
          {watermarkStep === 'preview' && watermarkPreviews.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <Divider>预览结果</Divider>
              <div style={{ maxHeight: 600, overflowY: 'auto' }}>
                {watermarkPreviews.map((preview) => (
                  <div key={preview.product_id} style={{ marginBottom: 24, padding: 16, border: '1px solid #f0f0f0', borderRadius: 8, backgroundColor: '#fafafa' }}>
                    <div style={{ marginBottom: 12, fontSize: 16, fontWeight: 500 }}>
                      <strong>{preview.sku}</strong> - {preview.title}
                      <Tag color="blue" style={{ marginLeft: 8 }}>
                        {preview.total_images || preview.images?.length || 0} 张图片
                      </Tag>
                    </div>

                    {preview.error ? (
                      <Alert message={preview.error} type="error" />
                    ) : preview.images && preview.images.length > 0 ? (
                      <div>
                        {/* 多图预览网格布局 */}
                        <div style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
                          gap: 12,
                          marginTop: 8
                        }}>
                          {preview.images.map((img, imgArrayIndex) => (
                            <div key={imgArrayIndex} style={{
                              border: '1px solid #e8e8e8',
                              borderRadius: 8,
                              padding: 8,
                              backgroundColor: 'white'
                            }}>
                              {/* 图片类型标签 */}
                              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <Tag color={img.image_type === 'primary' ? 'green' : 'default'}>
                                  {img.image_type === 'primary' ? '主图' : `附加图 ${img.image_index + 1}`}
                                </Tag>
                                {img.suggested_position && (
                                  <Tag color="blue">
                                    位置: {img.suggested_position}
                                  </Tag>
                                )}
                              </div>

                              {/* 水印选择器 */}
                              <div style={{ marginBottom: 8 }}>
                                <Select
                                  style={{ width: '100%' }}
                                  size="small"
                                  placeholder="选择水印"
                                  value={imageWatermarkSettings.get(`${preview.product_id}_${imgArrayIndex}`)?.watermarkId || selectedWatermarkConfig}
                                  onChange={(watermarkId) => {
                                    const key = `${preview.product_id}_${imgArrayIndex}`;
                                    const currentSettings = imageWatermarkSettings.get(key) || {};
                                    const newSettings = new Map(imageWatermarkSettings);
                                    newSettings.set(key, {
                                      ...currentSettings,
                                      watermarkId,
                                      position: manualPositions.get(key)
                                    });
                                    setImageWatermarkSettings(newSettings);
                                  }}
                                >
                                  {watermarkConfigs.map((config) => (
                                    <Option key={config.id} value={config.id}>
                                      <Space size="small">
                                        <img
                                          src={optimizeOzonImageUrl(config.image_url, 16)}
                                          alt={config.name}
                                          style={{ width: 16, height: 16, objectFit: 'contain' }}
                                        />
                                        <span style={{ fontSize: 12 }}>{config.name}</span>
                                      </Space>
                                    </Option>
                                  ))}
                                </Select>
                              </div>

                              {img.error ? (
                                <Alert message={`处理失败: ${img.error}`} type="error" showIcon />
                              ) : (
                                <div style={{
                                  position: 'relative',
                                  border: '1px solid #f0f0f0',
                                  borderRadius: 4,
                                  backgroundColor: '#f9f9f9',
                                  height: 300,
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}>
                                  {/* 图片和9宫格容器 - 确保两者尺寸完全一致 */}
                                  <div style={{
                                    position: 'relative',
                                    display: 'inline-block'
                                  }}>
                                    {/* 原图显示 */}
                                    <img
                                      src={optimizeOzonImageUrl(img.original_url, 300)}
                                      alt="原图预览"
                                      style={{
                                        display: 'block',
                                        maxWidth: '100%',
                                        maxHeight: '300px',
                                        objectFit: 'contain'
                                      }}
                                      onError={(e) => {
                                        console.error('原图加载失败:', img.original_url);
                                        e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwiPuWKoOi9veWksei0pTwvdGV4dD48L3N2Zz4=';
                                      }}
                                    />

                                    {/* 水印预览层 - 只在选中位置时显示 */}
                                    {(() => {
                                      const key = `${preview.product_id}_${imgArrayIndex}`;
                                      const settings = imageWatermarkSettings.get(key);
                                      const watermarkId = settings?.watermarkId || selectedWatermarkConfig;
                                      const position = settings?.position || manualPositions.get(key);

                                      if (watermarkId && position) {
                                        const watermarkConfig = watermarkConfigs.find(c => c.id === watermarkId);
                                        if (watermarkConfig) {
                                          return (
                                            <img
                                              src={optimizeOzonImageUrl(watermarkConfig.image_url, 100)}
                                              alt="水印预览"
                                              style={{
                                                position: 'absolute',
                                                ...getPreviewWatermarkStyle(position, watermarkConfig),
                                                pointerEvents: 'none'
                                              }}
                                            />
                                          );
                                        }
                                      }
                                      return null;
                                    })()}

                                    {/* 9宫格位置选择器 - 移到inline-block容器内 */}
                                    <div style={{
                                      position: 'absolute',
                                      top: 0,
                                      left: 0,
                                      right: 0,
                                      bottom: 0,
                                      display: 'grid',
                                      gridTemplateColumns: 'repeat(3, 1fr)',
                                      gridTemplateRows: 'repeat(3, 1fr)',
                                      gap: 0
                                    }}>
                                    {[
                                      'top_left', 'top_center', 'top_right',
                                      'center_left', null, 'center_right',
                                      'bottom_left', 'bottom_center', 'bottom_right'
                                    ].map((position, index) => {
                                      if (position === null) return <div key={index} />; // 中心格子跳过

                                      const positionKey = `${preview.product_id}_${imgArrayIndex}`;
                                      const currentSettings = imageWatermarkSettings.get(positionKey);
                                      const isSelected = (currentSettings?.position || manualPositions.get(positionKey)) === position;

                                      // 格子仅用于位置选择，水印显示在大预览图上

                                      return (
                                        <div
                                          key={index}
                                          onClick={() => {
                                            // 更新位置到 manualPositions
                                            const newPositions = new Map(manualPositions);
                                            newPositions.set(positionKey, position);
                                            setManualPositions(newPositions);

                                            // 同时更新到 imageWatermarkSettings
                                            const newSettings = new Map(imageWatermarkSettings);
                                            const watermarkId = currentSettings?.watermarkId || selectedWatermarkConfig;
                                            if (watermarkId) {
                                              newSettings.set(positionKey, {
                                                watermarkId,
                                                position
                                              });
                                              setImageWatermarkSettings(newSettings);
                                            }

                                            // TODO: 触发重新预览
                                            handlePositionChange(preview.product_id, imgArrayIndex, position);
                                          }}
                                          style={{
                                            cursor: 'pointer',
                                            backgroundColor: isSelected
                                              ? 'rgba(24, 144, 255, 0.15)'
                                              : 'transparent',
                                            border: '1px solid transparent',
                                            transition: 'all 0.2s',
                                            position: 'relative',
                                            overflow: 'hidden'
                                          }}
                                          onMouseEnter={(e) => {
                                            if (!isSelected) {
                                              e.currentTarget.style.backgroundColor = 'rgba(24, 144, 255, 0.08)';
                                            }
                                          }}
                                          onMouseLeave={(e) => {
                                            if (!isSelected) {
                                              e.currentTarget.style.backgroundColor = 'transparent';
                                            }
                                          }}
                                          title={`点击选择位置: ${position.replace('_', ' ')}`}
                                        >
                                          {/* 格子内容为空，仅通过边框显示选中状态 */}
                                        </div>
                                      );
                                    })}
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      // 旧版单图预览兼容
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <div style={{ width: '60%' }}>
                          <div style={{ marginBottom: 8, fontSize: 12, color: '#999', textAlign: 'center' }}>
                            水印预览
                            {preview.suggested_position && (
                              <Tag color="blue" style={{ marginLeft: 8 }}>
                                位置: {preview.suggested_position}
                              </Tag>
                            )}
                          </div>
                          <div style={{
                            border: '1px solid #f0f0f0',
                            borderRadius: 4,
                            padding: 8,
                            backgroundColor: '#f9f9f9'
                          }}>
                            <img
                              src={preview.preview_image}
                              alt="Preview"
                              style={{ width: '100%', maxHeight: 300, objectFit: 'contain' }}
                              onError={(e) => {
                                console.error('预览图片加载失败:', preview.preview_image?.substring(0, 50));
                                e.currentTarget.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMzAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2Y1ZjVmNSIvPjx0ZXh0IHg9IjUwJSIgeT0iNTAlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIiBmaWxsPSIjOTk5IiBmb250LXNpemU9IjE2IiBmb250LWZhbWlseT0iQXJpYWwiPuWKoOi9veWksei0pTwvdGV4dD48L3N2Zz4=';
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {selectedRows.length > 10 && (
                <Alert
                  message={`仅显示前10个商品的预览，共选中${selectedRows.length}个商品`}
                  type="info"
                  style={{ marginTop: 8 }}
                />
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* 图片预览组件 */}
      <ImagePreview
        images={previewImages}
        visible={previewVisible}
        initialIndex={previewIndex}
        onClose={() => setPreviewVisible(false)}
        productInfo={currentPreviewProduct}
        onWatermark={() => {
          if (watermarkConfigs.length === 0) {
            notifyWarning('操作失败', '请先配置水印');
            return;
          }
          setSelectedRows([currentPreviewProduct]);
          setWatermarkModalVisible(true);
          setPreviewVisible(false);
        }}
        onRestore={() => {
          confirm({
            title: '确认还原',
            content: `确定要还原商品 "${currentPreviewProduct?.sku}" 的原图吗？`,
            onOk: () => {
              restoreOriginalMutation.mutate([currentPreviewProduct.id]);
              setPreviewVisible(false);
            },
          });
        }}
      />

      {/* 列显示配置Modal */}
      <Modal
        title="列显示设置"
        open={columnConfigVisible}
        onCancel={() => setColumnConfigVisible(false)}
        onOk={() => setColumnConfigVisible(false)}
        width={400}
      >
        <div style={{ padding: '12px 0' }}>
          <Alert
            message="选择要显示的列"
            description="取消勾选可隐藏对应的列，设置会自动保存"
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <div>
              <Switch
                checked={visibleColumns.sku}
                onChange={(checked) => handleColumnVisibilityChange('sku', checked)}
                style={{ marginRight: 8 }}
              />
              <span>SKU/编码</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.info}
                onChange={(checked) => handleColumnVisibilityChange('info', checked)}
                style={{ marginRight: 8 }}
              />
              <span>商品信息</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.price}
                onChange={(checked) => handleColumnVisibilityChange('price', checked)}
                style={{ marginRight: 8 }}
              />
              <span>价格</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.stock}
                onChange={(checked) => handleColumnVisibilityChange('stock', checked)}
                style={{ marginRight: 8 }}
              />
              <span>库存</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.status}
                onChange={(checked) => handleColumnVisibilityChange('status', checked)}
                style={{ marginRight: 8 }}
              />
              <span>状态</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.visibility}
                onChange={(checked) => handleColumnVisibilityChange('visibility', checked)}
                style={{ marginRight: 8 }}
              />
              <span>可见性</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.created_at}
                onChange={(checked) => handleColumnVisibilityChange('created_at', checked)}
                style={{ marginRight: 8 }}
              />
              <span>创建时间</span>
            </div>
            <div>
              <Switch
                checked={visibleColumns.last_sync}
                onChange={(checked) => handleColumnVisibilityChange('last_sync', checked)}
                style={{ marginRight: 8 }}
              />
              <span>最后同步</span>
            </div>
            <Divider style={{ margin: '12px 0' }} />
            <div style={{ color: '#999', fontSize: 12 }}>
              <SettingOutlined /> 操作列始终显示
            </div>
          </Space>
        </div>
      </Modal>
    </div>
  );
};

export default ProductList;
