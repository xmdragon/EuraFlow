/**
 * 选品助手页面
 */
import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Upload,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Alert,
  message,
  notification,
  Spin,
  Empty,
  Tag,
  Progress,
  Modal,
  Table,
  Typography,
  Divider,
  Badge,
  Statistic,
  Tabs,
  Steps,
  Timeline,
  Collapse,
} from 'antd';
import {
  UploadOutlined,
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ShoppingOutlined,
  DollarOutlined,
  FieldTimeOutlined,
  StarOutlined,
  FileExcelOutlined,
  HistoryOutlined,
  FilterOutlined,
  SyncOutlined,
  DeleteOutlined,
  BookOutlined,
  CheckCircleOutlined,
  QuestionCircleOutlined,
  LinkOutlined,
  CodeOutlined,
  RocketOutlined,
  PlusOutlined,
  SettingOutlined,
  LoadingOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/services/productSelectionApi';
import type { UploadFile } from 'antd/es/upload/interface';
import ImagePreview from '@/components/ImagePreview';
import { useCurrency } from '../../hooks/useCurrency';
import styles from './ProductSelection.module.scss';

const { Option } = Select;
const { Title, Text, Link, Paragraph } = Typography;

// 字段配置接口
interface FieldConfig {
  brand: boolean;
  originalPrice: boolean;
  rfbsCommission: boolean;
  fbpCommission: boolean;
  monthlySales: boolean;
  weight: boolean;
  competitors: boolean;
  rating: boolean;
}

// 默认字段配置（全部显示）
const defaultFieldConfig: FieldConfig = {
  brand: true,
  originalPrice: true,
  rfbsCommission: true,
  fbpCommission: true,
  monthlySales: true,
  weight: true,
  competitors: true,
  rating: true,
};

const ProductSelection: React.FC = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const { currency: userCurrency, symbol: userSymbol } = useCurrency();

  // 状态管理
  const [activeTab, setActiveTab] = useState('search');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(1000); // 改为一次获取更多数据用于无限滚动
  const [historyPage, setHistoryPage] = useState(1);  // 导入历史分页
  const [searchParams, setSearchParams] = useState<api.ProductSearchParams>({});
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [previewData, setPreviewData] = useState<api.PreviewResponse | null>(null);
  const [importStrategy, setImportStrategy] = useState<'skip' | 'update' | 'append'>('update');
  const [importLoading, setImportLoading] = useState(false);
  const [competitorModalVisible, setCompetitorModalVisible] = useState(false);
  const [selectedProductCompetitors, setSelectedProductCompetitors] = useState<any>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);
  const [selectedProductImages, setSelectedProductImages] = useState<string[]>([]);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);

  // 无限滚动相关状态
  const [displayCount, setDisplayCount] = useState(0); // 当前显示的商品数量
  const [itemsPerRow, setItemsPerRow] = useState(6); // 每行显示数量（动态计算）
  const [isLoadingMore, setIsLoadingMore] = useState(false); // 是否正在加载更多

  // 字段配置状态
  const [fieldConfig, setFieldConfig] = useState<FieldConfig>(() => {
    const saved = localStorage.getItem('productFieldConfig');
    return saved ? JSON.parse(saved) : defaultFieldConfig;
  });
  const [fieldConfigVisible, setFieldConfigVisible] = useState(false);

  // 查询品牌列表
  const { data: brandsData } = useQuery({
    queryKey: ['productSelectionBrands'],
    queryFn: api.getBrands,
  });

  // 查询商品列表
  const { data: productsData, isLoading: productsLoading, refetch: refetchProducts } = useQuery({
    queryKey: ['productSelectionProducts', searchParams, currentPage, pageSize],
    queryFn: () => api.searchProducts({
      ...searchParams,
      page: currentPage,
      page_size: pageSize,
    }),
    enabled: activeTab === 'search',
  });

  // 查询导入历史
  const { data: historyData, refetch: refetchHistory} = useQuery({
    queryKey: ['productSelectionHistory', historyPage],
    queryFn: () => api.getImportHistory(historyPage, 10),
    enabled: activeTab === 'history',
  });

  // 计算每行显示数量（根据容器宽度）
  useEffect(() => {
    const calculateItemsPerRow = () => {
      const container = document.querySelector(`.${styles.productGrid}`);
      if (container) {
        const containerWidth = container.clientWidth;
        const itemWidth = 160; // 固定宽度
        const gap = 16; // 间距
        const columns = Math.max(1, Math.floor((containerWidth + gap) / (itemWidth + gap)));
        setItemsPerRow(columns);
      }
    };

    calculateItemsPerRow();
    window.addEventListener('resize', calculateItemsPerRow);
    return () => window.removeEventListener('resize', calculateItemsPerRow);
  }, []);

  // 初始显示4行商品
  useEffect(() => {
    if (productsData?.data?.items) {
      const initialCount = itemsPerRow * 4;
      setDisplayCount(Math.min(initialCount, productsData.data.items.length));
    }
  }, [productsData?.data?.items, itemsPerRow]);

  // 滚动监听：滚动到80%加载2行
  useEffect(() => {
    const handleScroll = () => {
      if (!productsData?.data?.items || isLoadingMore) return;

      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const windowHeight = window.innerHeight;
      const documentHeight = document.documentElement.scrollHeight;
      const scrollPercent = (scrollTop + windowHeight) / documentHeight;

      if (scrollPercent > 0.8 && displayCount < productsData.data.items.length) {
        setIsLoadingMore(true);
        // 延迟一下模拟加载效果
        setTimeout(() => {
          setDisplayCount(prev => {
            const newCount = Math.min(prev + itemsPerRow * 2, productsData.data.items.length);
            setIsLoadingMore(false);
            return newCount;
          });
        }, 300);
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [displayCount, productsData?.data?.items, itemsPerRow, isLoadingMore]);

  // 清空数据mutation
  const clearDataMutation = useMutation({
    mutationFn: api.clearAllData,
    onSuccess: (data) => {
      if (data.success) {
        notification.success({
          message: '数据清空成功',
          description: `已清空 ${data.data.deleted_products} 个商品和 ${data.data.deleted_history} 条导入历史`,
          duration: 3,
        });
        // 刷新所有相关数据
        refetchProducts();
        refetchHistory();
        queryClient.invalidateQueries({ queryKey: ['productSelectionBrands'] });
      } else {
        message.error(data.error || '清空数据失败');
      }
    },
    onError: (error: any) => {
      message.error('清空数据失败: ' + error.message);
    },
  });

  // 处理清空数据
  const handleClearData = () => {
    Modal.confirm({
      title: '确认清空所有数据？',
      content: (
        <div>
          <p className={styles.dangerText}>
            ⚠️ 此操作将永久删除您账号下的所有选品数据，无法恢复！
          </p>
          <p>包括：</p>
          <ul>
            <li>所有商品选品记录</li>
            <li>所有导入历史记录</li>
          </ul>
          <p>请确认是否继续？</p>
        </div>
      ),
      okText: '确认清空',
      cancelText: '取消',
      okType: 'danger',
      onOk: () => {
        clearDataMutation.mutate();
      },
    });
  };

  // 处理搜索
  const handleSearch = (values: any) => {
    const params: api.ProductSearchParams = {};

    if (values.product_name) params.product_name = values.product_name;
    if (values.brand) params.brand = values.brand;
    if (values.rfbs_low_max) params.rfbs_low_max = values.rfbs_low_max;
    if (values.rfbs_mid_max) params.rfbs_mid_max = values.rfbs_mid_max;
    if (values.fbp_low_max) params.fbp_low_max = values.fbp_low_max;
    if (values.fbp_mid_max) params.fbp_mid_max = values.fbp_mid_max;
    if (values.monthly_sales_min) params.monthly_sales_min = values.monthly_sales_min;
    if (values.monthly_sales_max) params.monthly_sales_max = values.monthly_sales_max;
    if (values.weight_max) params.weight_max = values.weight_max;
    if (values.competitor_count_min) params.competitor_count_min = values.competitor_count_min;
    if (values.competitor_count_max) params.competitor_count_max = values.competitor_count_max;
    if (values.competitor_min_price_min) params.competitor_min_price_min = values.competitor_min_price_min;
    if (values.competitor_min_price_max) params.competitor_min_price_max = values.competitor_min_price_max;
    if (values.sort_by) params.sort_by = values.sort_by;

    setSearchParams(params);
    setCurrentPage(1);
  };

  // 处理重置
  const handleReset = () => {
    form.resetFields();
    setSearchParams({});
    setCurrentPage(1);
  };

  // 处理文件上传 - 直接导入，不预览
  const handleBeforeUpload = async (file: any) => {
    setFileList([file]);

    // 直接执行导入
    setImportLoading(true);
    try {
      const result = await api.importProducts(file, 'update');  // 默认使用更新策略
      if (result.success) {
        notification.success({
          message: '导入完成',
          description: (
            <div>
              <p>总行数: {result.total_rows}</p>
              <p>成功: {result.success_rows} 条</p>
              {result.updated_rows! > 0 && <p>更新: {result.updated_rows} 条</p>}
              {result.skipped_rows! > 0 && <p>跳过: {result.skipped_rows} 条</p>}
              {result.failed_rows! > 0 && <p>失败: {result.failed_rows} 条</p>}
              <p>耗时: {result.duration} 秒</p>
            </div>
          ),
          duration: 5,  // 5秒后自动消失
        });

        setFileList([]);
        refetchProducts();
        refetchHistory();  // 刷新历史记录
      } else {
        message.error(result.error || '导入失败');
        if (result.missing_columns) {
          notification.error({
            message: '文件格式错误',
            description: `缺少必需列: ${result.missing_columns.join(', ')}`,
            duration: 0,
          });
        }
      }
    } catch (error: any) {
      message.error('导入失败: ' + error.message);
    } finally {
      setImportLoading(false);
      setFileList([]);
    }

    return false; // 阻止自动上传
  };


  // 显示跟卖者列表
  const showCompetitorsList = (product: api.ProductSelectionItem) => {
    setSelectedProductCompetitors(product);
    setCompetitorModalVisible(true);
  };

  // 显示商品图片
  const showProductImages = async (product: api.ProductSelectionItem) => {
    // 立即打开Modal，显示加载状态
    setSelectedProductImages([]);
    setCurrentImageIndex(0);
    setImageModalVisible(true);

    // 异步加载图片
    try {
      const response = await api.getProductDetail(product.product_id);
      if (response.success && response.data.images.length > 0) {
        // 提取图片URL数组
        const imageUrls = response.data.images.map((img: any) => img.url);
        setSelectedProductImages(imageUrls);
      } else {
        // 如果没有图片，关闭Modal并提示
        setImageModalVisible(false);
        message.info('该商品暂无更多图片');
      }
    } catch (error) {
      // 出错时关闭Modal并提示
      setImageModalVisible(false);
      message.error('获取商品图片失败');
      console.error('获取商品图片失败:', error);
    }
  };

  // 执行导入
  const handleImport = async () => {
    if (!fileList[0]) {
      message.error('请选择文件');
      return;
    }

    setImportLoading(true);
    try {
      const result = await api.importProducts(fileList[0] as any, importStrategy);
      if (result.success) {
        notification.success({
          message: '导入完成',
          description: (
            <div>
              <p>总行数: {result.total_rows}</p>
              <p>成功: {result.success_rows} 条</p>
              {result.updated_rows! > 0 && <p>更新: {result.updated_rows} 条</p>}
              {result.skipped_rows! > 0 && <p>跳过: {result.skipped_rows} 条</p>}
              {result.failed_rows! > 0 && <p>失败: {result.failed_rows} 条</p>}
              <p>耗时: {result.duration} 秒</p>
            </div>
          ),
          duration: 0,
        });

        setImportModalVisible(false);
        setFileList([]);
        setPreviewData(null);
        refetchProducts();
        refetchHistory();
      } else {
        message.error(result.error || '导入失败');
      }
    } catch (error: any) {
      message.error('导入失败: ' + error.message);
    } finally {
      setImportLoading(false);
    }
  };

  // 将分转换为卢布
  const formatPrice = (priceInKopecks: number | null | undefined): string => {
    if (priceInKopecks === null || priceInKopecks === undefined) return '0.00';
    return (priceInKopecks / 100).toFixed(2);
  };

  // 格式化百分比显示
  const formatPercentage = (value: number | null | undefined): string => {
    if (value === null || value === undefined || value === 0) return '-';
    return `${value}%`;
  };

  // 格式化数量显示
  const formatNumber = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '-';
    return value.toString();
  };

  // 格式化重量显示
  const formatWeight = (value: number | null | undefined): string => {
    if (value === null || value === undefined) return '-';
    return `${value}g`;
  };

  // 下载用户脚本
  const handleDownloadScript = () => {
    // 创建一个虚拟链接触发下载
    const scriptUrl = window.location.origin + '/scripts/ozon_product_selector.user.js';
    const link = document.createElement('a');
    link.href = scriptUrl;
    link.download = 'ozon_product_selector.user.js';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    message.success('脚本下载已开始');
  };

  // 保存字段配置
  const saveFieldConfig = (config: FieldConfig) => {
    setFieldConfig(config);
    localStorage.setItem('productFieldConfig', JSON.stringify(config));
    message.success('字段配置已保存');
    setFieldConfigVisible(false);
  };

  // 重置字段配置
  const resetFieldConfig = () => {
    setFieldConfig(defaultFieldConfig);
    localStorage.removeItem('productFieldConfig');
    message.success('已恢复默认配置');
  };

  // 渲染商品卡片
  const renderProductCard = (product: api.ProductSelectionItem) => {
    const discount = product.original_price
      ? Math.round((1 - product.current_price / product.original_price) * 100)
      : 0;

    return (
      <Card
        key={product.id}
        hoverable
        size="small"
        styles={{ body: { padding: '8px', minHeight: '240px', display: 'flex', flexDirection: 'column' } }}
        cover={
          product.image_url ? (
            <div
              className={styles.productCover}
              onClick={() => window.open(product.ozon_link, '_blank')}
            >
              <img
                alt={product.product_name_cn}
                src={product.image_url}
                className={styles.productImage}
              />
              <div
                className={styles.previewIconOverlay}
                onClick={(e) => {
                  e.stopPropagation();
                  showProductImages(product);
                }}
              >
                <PlusOutlined />
              </div>
            </div>
          ) : (
            <div
              className={styles.productImagePlaceholder}
              onClick={() => window.open(product.ozon_link, '_blank')}
            >
              <ShoppingOutlined />
            </div>
          )
        }
        actions={[
          <Button
            key="view"
            type="link"
            size="small"
            icon={<ShoppingOutlined />}
            onClick={() => window.open(product.ozon_link, '_blank')}
            className={styles.viewButton}
          >
            查看
          </Button>,
        ]}
      >
        <div className={styles.productCardBody}>
          {/* 商品名称 - 始终显示 */}
          <Paragraph ellipsis={{ rows: 2, tooltip: product.product_name_cn }} className={styles.productName}>
            {product.product_name_cn || product.product_name_ru}
          </Paragraph>

          {/* 价格信息 - 始终显示当前价 */}
          <div className={styles.priceContainer}>
            <div className={styles.priceRow}>
              <Text strong className={styles.currentPrice}>
                {userSymbol}{formatPrice(product.current_price)}
              </Text>
              {fieldConfig.originalPrice && product.original_price && (
                <>
                  <Text delete className={styles.originalPrice}>
                    {userSymbol}{formatPrice(product.original_price)}
                  </Text>
                  {discount > 0 && (
                    <Tag color="red" className={styles.discountTag}>
                      -{discount}%
                    </Tag>
                  )}
                </>
              )}
            </div>
          </div>

          {/* 品牌 */}
          {fieldConfig.brand && (
            <div className={styles.brandInfo}>
              <Text type="secondary">品牌: </Text>
              <Text strong>{product.brand || '无品牌'}</Text>
            </div>
          )}

          {/* 佣金率 - 紧凑布局 */}
          {(fieldConfig.rfbsCommission || fieldConfig.fbpCommission) && (
            <div className={styles.commissionBox}>
              {fieldConfig.rfbsCommission && (
                <Row gutter={4} className={styles.commissionRow}>
                  <Col span={12}>
                    <Text className={styles.commissionLabel}>rFBS≤1500:</Text>
                    <Text strong className={styles.commissionValue}>{formatPercentage(product.rfbs_commission_low)}</Text>
                  </Col>
                  <Col span={12}>
                    <Text className={styles.commissionLabel}>rFBS(1.5-5k):</Text>
                    <Text strong className={styles.commissionValue}>{formatPercentage(product.rfbs_commission_mid)}</Text>
                  </Col>
                </Row>
              )}
              {fieldConfig.fbpCommission && (
                <Row gutter={4}>
                  <Col span={12}>
                    <Text className={styles.commissionLabel}>FBP≤1500:</Text>
                    <Text strong className={styles.commissionValue}>{formatPercentage(product.fbp_commission_low)}</Text>
                  </Col>
                  <Col span={12}>
                    <Text className={styles.commissionLabel}>FBP(1.5-5k):</Text>
                    <Text strong className={styles.commissionValue}>{formatPercentage(product.fbp_commission_mid)}</Text>
                  </Col>
                </Row>
              )}
            </div>
          )}

          {/* 销量和重量 */}
          {(fieldConfig.monthlySales || fieldConfig.weight) && (
            <Row gutter={4} className={styles.statsRow}>
              {fieldConfig.monthlySales && (
                <Col span={fieldConfig.weight ? 12 : 24}>
                  <div className={styles.statsItem}>
                    <Text type="secondary">月销: </Text>
                    <Text strong>{formatNumber(product.monthly_sales_volume)}</Text>
                  </div>
                </Col>
              )}
              {fieldConfig.weight && (
                <Col span={fieldConfig.monthlySales ? 12 : 24}>
                  <div className={styles.statsItem}>
                    <Text type="secondary">重量: </Text>
                    <Text strong>{formatWeight(product.package_weight)}</Text>
                  </div>
                </Col>
              )}
            </Row>
          )}

          {/* 竞争对手数据 */}
          {fieldConfig.competitors && (
            <div className={styles.competitorSection}>
              <Row gutter={4}>
                <Col span={12}>
                  <div className={styles.competitorItem}>
                    <Text type="secondary">跟卖者: </Text>
                    {product.competitor_count !== null && product.competitor_count !== undefined ? (
                      <Text
                        strong
                        className={`${styles.competitorCount} ${product.competitor_count === 0 ? styles.disabled : ''}`}
                        onClick={() => product.competitor_count && product.competitor_count > 0 && showCompetitorsList(product)}
                      >
                        {product.competitor_count}家
                      </Text>
                    ) : (
                      <Text className={styles.placeholderText}>-</Text>
                    )}
                  </div>
                </Col>
                <Col span={12}>
                  <div className={styles.competitorItem}>
                    <Text type="secondary">跟卖最低价: </Text>
                    {product.competitor_min_price !== null && product.competitor_min_price !== undefined ? (
                      <Text strong className={styles.competitorPrice}>
                        {userSymbol}{formatPrice(product.competitor_min_price)}
                      </Text>
                    ) : (
                      <Text className={styles.placeholderText}>-</Text>
                    )}
                  </div>
                </Col>
              </Row>
            </div>
          )}

          {/* 评分 - 更紧凑 */}
          {fieldConfig.rating && product.rating && (
            <div className={styles.ratingSection}>
              <StarOutlined />
              <Text strong className={styles.ratingValue}>{product.rating}</Text>
              <Text type="secondary" className={styles.reviewCount}>({product.review_count})</Text>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <Card title="选品助手">
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          {
            key: 'search',
            label: <span><SearchOutlined /> 商品搜索</span>,
            children: (
              <>
          {/* 搜索表单 */}
          <Card className={styles.searchFormCard}>
            <Form
              form={form}
              layout="vertical"
              onFinish={handleSearch}
              initialValues={{ sort_by: 'created_desc' }}
            >
              <Row gutter={[16, 16]}>
                {/* 第一行：商品名称、品牌、排序 */}
                <Col xs={24} sm={24} md={8} lg={6} xl={6}>
                  <Form.Item label="商品名称" name="product_name">
                    <Input
                      placeholder="输入商品名称搜索"
                      allowClear
                      prefix={<SearchOutlined />}
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                  <Form.Item label="品牌" name="brand">
                    <Select
                      placeholder="选择品牌"
                      allowClear
                      showSearch
                      filterOption={(input, option) =>
                        (option?.children as string).toLowerCase().includes(input.toLowerCase())
                      }
                    >
                      {brandsData?.data?.map((brand) => (
                        <Option key={brand} value={brand}>
                          {brand}
                        </Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6} xl={4}>
                  <Form.Item label="排序" name="sort_by">
                    <Select placeholder="最新导入">
                      <Option value="created_desc">最新导入</Option>
                      <Option value="created_asc">最早导入</Option>
                      <Option value="sales_desc">销量↓</Option>
                      <Option value="sales_asc">销量↑</Option>
                      <Option value="weight_asc">重量↑</Option>
                      <Option value="price_asc">价格↑</Option>
                      <Option value="price_desc">价格↓</Option>
                    </Select>
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={24} lg={6} xl={4}>
                  <Form.Item label="rFBS≤1500" name="rfbs_low_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={1}
                      className={styles.fullWidthInput}
                      placeholder="%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                {/* 第二行：佣金率字段 */}
                <Col xs={24} sm={12} md={6} lg={6} xl={3}>
                  <Form.Item label="rFBS 1501-5000" name="rfbs_mid_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={1}
                      className={styles.fullWidthInput}
                      placeholder="%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={6} lg={6} xl={3}>
                  <Form.Item label="FBP≤1500" name="fbp_low_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={1}
                      className={styles.fullWidthInput}
                      placeholder="%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={6} lg={6} xl={3}>
                  <Form.Item label="FBP 1501-5000" name="fbp_mid_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={1}
                      className={styles.fullWidthInput}
                      placeholder="%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                {/* 第三行：月销量、重量 */}
                <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                  <Form.Item label="月销量">
                    <Space.Compact className={styles.fullWidthInput}>
                      <Form.Item name="monthly_sales_min" noStyle>
                        <InputNumber
                          min={0}
                          className={styles.halfWidthInput}
                          placeholder="最小"
                        />
                      </Form.Item>
                      <Form.Item name="monthly_sales_max" noStyle>
                        <InputNumber
                          min={0}
                          className={styles.halfWidthInput}
                          placeholder="最大"
                        />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={6} lg={4} xl={3}>
                  <Form.Item label="重量≤" name="weight_max">
                    <InputNumber
                      min={0}
                      className={styles.fullWidthInput}
                      placeholder="g"
                      suffix="g"
                    />
                  </Form.Item>
                </Col>

                {/* 第四行：跟卖者相关 */}
                <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                  <Form.Item label="跟卖者数量">
                    <Space.Compact className={styles.fullWidthInput}>
                      <Form.Item name="competitor_count_min" noStyle>
                        <InputNumber
                          min={0}
                          className={styles.halfWidthInput}
                          placeholder="最小"
                        />
                      </Form.Item>
                      <Form.Item name="competitor_count_max" noStyle>
                        <InputNumber
                          min={0}
                          className={styles.halfWidthInput}
                          placeholder="最大"
                        />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={12} lg={8} xl={6}>
                  <Form.Item label="最低跟卖价">
                    <Space.Compact className={styles.fullWidthInput}>
                      <Form.Item name="competitor_min_price_min" noStyle>
                        <InputNumber
                          min={0}
                          className={styles.halfWidthInput}
                          placeholder={`最小${userSymbol}`}
                        />
                      </Form.Item>
                      <Form.Item name="competitor_min_price_max" noStyle>
                        <InputNumber
                          min={0}
                          className={styles.halfWidthInput}
                          placeholder={`最大${userSymbol}`}
                        />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                </Col>
              </Row>

              <Row>
                <Col span={24}>
                  <Space>
                    <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>
                      搜索
                    </Button>
                    <Button onClick={handleReset} icon={<ReloadOutlined />}>
                      重置
                    </Button>
                  </Space>
                </Col>
              </Row>
            </Form>
          </Card>

          {/* 搜索结果统计和配置按钮 */}
          {productsData?.data && (
            <Row justify="space-between" align="middle" className={styles.searchStats}>
              <Col>
                <Space>
                  <Statistic
                    title="已加载"
                    value={displayCount}
                    suffix={`/ ${productsData.data.total} 件商品`}
                  />
                </Space>
              </Col>
              <Col>
                <Button
                  icon={<SettingOutlined />}
                  onClick={() => setFieldConfigVisible(true)}
                >
                  配置字段
                </Button>
              </Col>
            </Row>
          )}

          {/* 商品列表 - CSS Grid布局 */}
          <Spin spinning={productsLoading}>
            {productsData?.data?.items && productsData.data.items.length > 0 ? (
              <>
                <div className={styles.productGrid}>
                  {productsData.data.items.slice(0, displayCount).map((product) => (
                    <div key={product.id}>
                      {renderProductCard(product)}
                    </div>
                  ))}
                </div>
                {/* 加载更多提示 */}
                {isLoadingMore && (
                  <div className={styles.loadingMore}>
                    <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                    <Text type="secondary" style={{ marginLeft: 12 }}>加载中...</Text>
                  </div>
                )}
                {/* 已加载完所有数据 */}
                {!isLoadingMore && displayCount >= productsData.data.items.length && productsData.data.items.length > 0 && (
                  <div className={styles.loadingMore}>
                    <Text type="secondary">已显示全部 {productsData.data.items.length} 件商品</Text>
                  </div>
                )}
              </>
            ) : (
              <Empty description="暂无商品数据" />
            )}
          </Spin>
              </>
            )
          },
          {
            key: 'import',
            label: <span><UploadOutlined /> 数据导入</span>,
            children: (
          <Card>
            <Space direction="vertical" size="large" className={styles.fullWidthInput}>
              <Alert
                message="导入说明"
                description={
                  <div>
                    <p>1. 支持 Excel (.xlsx) 和 CSV (.csv) 文件格式</p>
                    <p>2. 文件需包含必要列：商品ID、商品名称等</p>
                    <p>3. 系统会自动进行数据清洗和格式转换</p>
                    <p>4. 导入策略：以"商品名称+商品ID"作为唯一标识，存在则更新，不存在则追加</p>
                  </div>
                }
                type="info"
                showIcon
              />

              <Upload.Dragger
                fileList={fileList}
                beforeUpload={handleBeforeUpload}
                onRemove={() => setFileList([])}
                accept=".csv,.xlsx,.xls"
                maxCount={1}
              >
                <p className="ant-upload-drag-icon">
                  <FileExcelOutlined className={styles.uploadIcon} />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                  支持 Excel 和 CSV 文件，文件大小不超过 10MB
                </p>
              </Upload.Dragger>

              <Divider />

              <Alert
                message="数据管理"
                description="如需重新开始，可以清空所有当前账号的选品数据"
                type="warning"
                showIcon
                action={
                  <Button
                    danger
                    type="text"
                    icon={<DeleteOutlined />}
                    onClick={handleClearData}
                    loading={clearDataMutation.isPending}
                  >
                    清空所有数据
                  </Button>
                }
              />
            </Space>
          </Card>
            )
          },
          {
            key: 'history',
            label: <span><HistoryOutlined /> 导入历史</span>,
            children: (
          <Table
            dataSource={historyData?.data?.items}
            rowKey="id"
            pagination={{
              current: historyPage,
              pageSize: 10,
              total: historyData?.data?.total,
              onChange: (page) => setHistoryPage(page),
            }}
            columns={[
              {
                title: '文件名',
                dataIndex: 'file_name',
                key: 'file_name',
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
            ]}
          />
            )
          },
          {
            key: 'guide',
            label: <span><BookOutlined /> 使用指南</span>,
            children: (
              <Space direction="vertical" size="large" className={styles.fullWidthInput}>
                {/* 脚本介绍 */}
                <Card>
                  <Title level={4}>
                    <RocketOutlined /> Ozon选品助手用户脚本
                  </Title>
                  <Paragraph>
                    智能采集Ozon商品数据的浏览器插件，支持自动滚动、虚拟列表适配、自动上传到EuraFlow平台。
                  </Paragraph>
                  <Row gutter={[16, 16]}>
                    <Col span={8}>
                      <Card size="small">
                        <Statistic
                          title="采集字段"
                          value={42}
                          suffix="个"
                          valueStyle={{ color: '#3f8600' }}
                        />
                      </Card>
                    </Col>
                    <Col span={8}>
                      <Card size="small">
                        <Statistic
                          title="脚本版本"
                          value="4.3"
                          valueStyle={{ color: '#1890ff' }}
                        />
                      </Card>
                    </Col>
                    <Col span={8}>
                      <Card size="small">
                        <Statistic
                          title="适配平台"
                          value="Ozon.ru"
                          valueStyle={{ color: '#722ed1' }}
                        />
                      </Card>
                    </Col>
                  </Row>
                </Card>

                {/* 功能特性 */}
                <Card title="✨ 功能特性">
                  <Row gutter={[16, 16]}>
                    <Col span={12}>
                      <Alert
                        message="智能采集"
                        description="自动滚动加载，适配Ozon虚拟滚动机制，智能等待上品帮数据注入"
                        type="success"
                        showIcon
                        icon={<CheckCircleOutlined />}
                      />
                    </Col>
                    <Col span={12}>
                      <Alert
                        message="自动上传"
                        description="采集完成后自动上传到EuraFlow，无需手动导出CSV"
                        type="success"
                        showIcon
                        icon={<CheckCircleOutlined />}
                      />
                    </Col>
                    <Col span={12}>
                      <Alert
                        message="数据验证"
                        description="实时验证数据完整性，过滤推广商品，确保数据质量"
                        type="success"
                        showIcon
                        icon={<CheckCircleOutlined />}
                      />
                    </Col>
                    <Col span={12}>
                      <Alert
                        message="友好界面"
                        description="可视化控制面板，实时统计，进度显示，操作简单"
                        type="success"
                        showIcon
                        icon={<CheckCircleOutlined />}
                      />
                    </Col>
                  </Row>
                </Card>

                {/* 安装步骤 */}
                <Card title="📥 安装步骤">
                  <Steps
                    direction="vertical"
                    current={-1}
                    items={[
                      {
                        title: '安装浏览器扩展',
                        description: (
                          <div>
                            <Paragraph>
                              安装 Tampermonkey 或 Greasemonkey 浏览器扩展：
                            </Paragraph>
                            <Space wrap>
                              <Link href="https://www.tampermonkey.net/" target="_blank">
                                <Button type="link" icon={<LinkOutlined />}>
                                  Chrome/Edge - Tampermonkey
                                </Button>
                              </Link>
                              <Link href="https://addons.mozilla.org/zh-CN/firefox/addon/greasemonkey/" target="_blank">
                                <Button type="link" icon={<LinkOutlined />}>
                                  Firefox - Greasemonkey
                                </Button>
                              </Link>
                            </Space>
                          </div>
                        ),
                        icon: <DownloadOutlined />,
                      },
                      {
                        title: '下载用户脚本',
                        description: (
                          <Space direction="vertical">
                            <Paragraph>
                              点击下方按钮下载用户脚本文件：
                            </Paragraph>
                            <Button
                              type="primary"
                              icon={<DownloadOutlined />}
                              onClick={handleDownloadScript}
                            >
                              下载 ozon_product_selector.user.js
                            </Button>
                            <Alert
                              message="提示"
                              description="脚本文件路径：/scripts/ozon_product_selector.user.js"
                              type="info"
                              showIcon
                            />
                          </Space>
                        ),
                        icon: <CodeOutlined />,
                      },
                      {
                        title: '安装脚本',
                        description: (
                          <div>
                            <Paragraph>
                              将下载的 .user.js 文件拖拽到浏览器窗口，Tampermonkey 会自动识别并弹出安装确认窗口。
                            </Paragraph>
                            <Paragraph>
                              点击"安装"按钮完成安装。
                            </Paragraph>
                          </div>
                        ),
                        icon: <CheckCircleOutlined />,
                      },
                    ]}
                  />
                </Card>

                {/* 使用配置 */}
                <Card title="⚙️ 配置和使用">
                  <Collapse
                    items={[
                      {
                        key: 'api-config',
                        label: '1️⃣ API配置',
                        children: (
                          <Space direction="vertical" className={styles.fullWidthInput}>
                            <Alert
                              message="配置API连接信息"
                              description='在Ozon商品列表页面，点击右下角的🎯图标打开控制面板，展开"API设置"部分。'
                              type="info"
                              showIcon
                            />
                            <Paragraph>
                              <Text strong>API地址：</Text>
                              <Text code>{window.location.origin}</Text>
                            </Paragraph>
                            <Paragraph>
                              <Text strong>API Key：</Text>
                              <Link href="/dashboard/ozon/api-keys">前往API Keys页面获取 →</Link>
                            </Paragraph>
                            <Paragraph>
                              配置完成后，点击"保存配置"，然后点击"测试连接"确保配置正确。
                            </Paragraph>
                          </Space>
                        ),
                      },
                      {
                        key: 'usage-flow',
                        label: '2️⃣ 采集流程',
                        children: (
                          <Timeline
                            items={[
                              {
                                children: '访问 https://www.ozon.ru 并搜索或浏览商品',
                                color: 'blue',
                              },
                              {
                                children: '点击页面右下角的 🎯 图标打开控制面板',
                                color: 'blue',
                              },
                              {
                                children: '设置目标商品数量（默认100个）',
                                color: 'blue',
                              },
                              {
                                children: '点击"🚀 开始收集"按钮',
                                color: 'green',
                              },
                              {
                                children: '脚本会自动滚动页面，收集商品数据',
                                color: 'green',
                              },
                              {
                                children: '采集完成后，数据自动上传到EuraFlow',
                                color: 'green',
                              },
                              {
                                children: '在"商品搜索"标签页查看导入的数据',
                                color: 'green',
                              },
                            ]}
                          />
                        ),
                      },
                      {
                        key: 'data-fields',
                        label: '3️⃣ 采集字段说明',
                        children: (
                          <div>
                            <Paragraph>
                              脚本会采集以下42个字段的商品数据：
                            </Paragraph>
                            <Row gutter={[8, 8]}>
                              {[
                                '商品ID', '商品名称', '商品链接', '商品图片', '品牌',
                                '销售价格', '原价', '商品评分', '评价次数',
                                'rFBS各档佣金', 'FBP各档佣金',
                                '月销量', '月销售额', '日销量', '日销售额',
                                '包装重量', '包装尺寸', '商品体积',
                                '跟卖者数量', '最低跟卖价',
                                '成交率', '商品可用性', '广告费用份额',
                                '配送时间', '卖家类型', '商品创建日期',
                              ].map((field) => (
                                <Col span={6} key={field}>
                                  <Tag color="blue">{field}</Tag>
                                </Col>
                              ))}
                            </Row>
                          </div>
                        ),
                      },
                    ]}
                    defaultActiveKey={['api-config']}
                  />
                </Card>

                {/* 常见问题 */}
                <Card title="❓ 常见问题">
                  <Collapse
                    items={[
                      {
                        key: 'faq-1',
                        label: 'Q: API连接测试失败？',
                        children: (
                          <div>
                            <Paragraph>请检查以下几点：</Paragraph>
                            <ul>
                              <li>API地址是否正确（不要包含 /api 等路径）</li>
                              <li>API Key是否有效（可在API Keys页面重新生成）</li>
                              <li>网络是否通畅（检查VPN或代理设置）</li>
                              <li>浏览器控制台是否有CORS错误</li>
                            </ul>
                          </div>
                        ),
                      },
                      {
                        key: 'faq-2',
                        label: 'Q: 数据上传失败？',
                        children: (
                          <div>
                            <Paragraph>可能的原因：</Paragraph>
                            <ul>
                              <li>API Key权限不足 - 确保有"产品选品上传"权限</li>
                              <li>数据格式不正确 - 检查浏览器控制台错误信息</li>
                              <li>服务器响应超时 - 稍后重试或联系管理员</li>
                            </ul>
                          </div>
                        ),
                      },
                      {
                        key: 'faq-3',
                        label: 'Q: 采集数据不完整？',
                        children: (
                          <div>
                            <Paragraph>可能的原因：</Paragraph>
                            <ul>
                              <li>等待时间不足 - 增加滚动等待时间（默认2.5秒）</li>
                              <li>上品帮插件未安装或未工作 - 确保上品帮正常运行</li>
                              <li>Ozon页面结构变化 - 联系技术支持更新脚本</li>
                            </ul>
                          </div>
                        ),
                      },
                      {
                        key: 'faq-4',
                        label: 'Q: 如何查看采集到的数据？',
                        children: (
                          <Paragraph>
                            数据上传成功后，切换到"商品搜索"标签页即可查看和筛选导入的商品。
                            您也可以在"导入历史"标签页查看每次导入的详细记录。
                          </Paragraph>
                        ),
                      },
                    ]}
                  />
                </Card>

                {/* 技术支持 */}
                <Card>
                  <Alert
                    message="需要帮助？"
                    description={
                      <div>
                        <Paragraph>
                          如果遇到问题或需要技术支持，请联系管理员或查看项目文档。
                        </Paragraph>
                        <Paragraph>
                          <Text type="secondary">
                            脚本版本：v4.3 | 更新时间：2024-10-05
                          </Text>
                        </Paragraph>
                      </div>
                    }
                    type="info"
                    showIcon
                    icon={<QuestionCircleOutlined />}
                  />
                </Card>
              </Space>
            )
          }
        ]}
      />

      {/* 跟卖者列表弹窗 */}
      <Modal
        title="跟卖者列表"
        open={competitorModalVisible}
        onCancel={() => setCompetitorModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setCompetitorModalVisible(false)}>
            关闭
          </Button>
        ]}
        width={600}
      >
        {selectedProductCompetitors && (
          <div>
            <div className={styles.competitorModalHeader}>
              <Text strong>{selectedProductCompetitors.product_name_cn || selectedProductCompetitors.product_name_ru}</Text>
            </div>
            <Alert
              message={`共发现 ${selectedProductCompetitors.competitor_count || 0} 个跟卖者`}
              type="info"
              className={styles.competitorModalAlert}
            />
            <div className={styles.competitorModalContent}>
              {selectedProductCompetitors.competitor_min_price ? (
                <>
                  <Text type="secondary">跟卖者数据已从选品导入中获取</Text>
                  <div className={styles.competitorMinPrice}>
                    <Text>最低跟卖价: </Text>
                    <Text strong className={styles.competitorMinPriceValue}>
                      {userSymbol}{formatPrice(selectedProductCompetitors.competitor_min_price)}
                    </Text>
                  </div>
                </>
              ) : (
                <Text type="secondary">暂无跟卖者价格数据</Text>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* 商品图片浏览 */}
      <ImagePreview
        images={selectedProductImages}
        visible={imageModalVisible}
        initialIndex={currentImageIndex}
        onClose={() => setImageModalVisible(false)}
      />

      {/* 字段配置Modal */}
      <Modal
        title="配置显示字段"
        open={fieldConfigVisible}
        onOk={() => saveFieldConfig(fieldConfig)}
        onCancel={() => setFieldConfigVisible(false)}
        okText="保存"
        cancelText="取消"
        width={500}
      >
        <div className={styles.fieldConfigList}>
          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.brand}
                onChange={(e) => setFieldConfig({ ...fieldConfig, brand: e.target.checked })}
                id="field-brand"
              />
              <label htmlFor="field-brand">品牌</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.originalPrice}
                onChange={(e) => setFieldConfig({ ...fieldConfig, originalPrice: e.target.checked })}
                id="field-originalPrice"
              />
              <label htmlFor="field-originalPrice">原价和折扣</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.rfbsCommission}
                onChange={(e) => setFieldConfig({ ...fieldConfig, rfbsCommission: e.target.checked })}
                id="field-rfbsCommission"
              />
              <label htmlFor="field-rfbsCommission">rFBS佣金率</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.fbpCommission}
                onChange={(e) => setFieldConfig({ ...fieldConfig, fbpCommission: e.target.checked })}
                id="field-fbpCommission"
              />
              <label htmlFor="field-fbpCommission">FBP佣金率</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.monthlySales}
                onChange={(e) => setFieldConfig({ ...fieldConfig, monthlySales: e.target.checked })}
                id="field-monthlySales"
              />
              <label htmlFor="field-monthlySales">月销量</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.weight}
                onChange={(e) => setFieldConfig({ ...fieldConfig, weight: e.target.checked })}
                id="field-weight"
              />
              <label htmlFor="field-weight">重量</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.competitors}
                onChange={(e) => setFieldConfig({ ...fieldConfig, competitors: e.target.checked })}
                id="field-competitors"
              />
              <label htmlFor="field-competitors">竞争对手信息</label>
            </Space>
          </div>

          <div className={styles.fieldConfigItem}>
            <Space>
              <input
                type="checkbox"
                checked={fieldConfig.rating}
                onChange={(e) => setFieldConfig({ ...fieldConfig, rating: e.target.checked })}
                id="field-rating"
              />
              <label htmlFor="field-rating">评分和评价</label>
            </Space>
          </div>
        </div>

        <Divider />

        <Space>
          <Button onClick={resetFieldConfig} size="small">
            恢复默认
          </Button>
          <Text type="secondary" style={{ fontSize: '12px' }}>
            注意：商品名称和当前价格始终显示
          </Text>
        </Space>
      </Modal>

      {/* 导入预览和确认弹窗 */}
      <Modal
        title="导入预览"
        open={importModalVisible}
        onOk={handleImport}
        onCancel={() => {
          setImportModalVisible(false);
          setPreviewData(null);
        }}
        confirmLoading={importLoading}
        width={800}
      >
        {previewData && (
          <Space direction="vertical" size="middle" className={styles.fullWidthInput}>
            <Alert
              message={`文件包含 ${previewData.total_rows} 行数据`}
              type="info"
            />

            <div>
              <Text strong>导入策略：</Text>
              <Select
                value={importStrategy}
                onChange={setImportStrategy}
                className={styles.importStrategySelector}
              >
                <Option value="skip">跳过重复记录</Option>
                <Option value="update">更新已有记录</Option>
                <Option value="append">追加为新记录</Option>
              </Select>
            </div>

            <div>
              <Text strong>数据预览（前5行）：</Text>
              <div className={styles.dataPreview}>
                <pre>
                  {JSON.stringify(previewData.preview?.slice(0, 5), null, 2)}
                </pre>
              </div>
            </div>
          </Space>
        )}
      </Modal>
    </Card>
  );
};

export default ProductSelection;