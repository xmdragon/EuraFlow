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
} from 'antd';
import {
  UploadOutlined,
  SearchOutlined,
  ReloadOutlined,
  DownloadOutlined,
  ShoppingOutlined,
  DollarOutlined,
  FieldTimeOutlined,
  WeightOutlined,
  StarOutlined,
  FileExcelOutlined,
  HistoryOutlined,
  FilterOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '@/services/productSelectionApi';
import type { UploadFile } from 'antd/es/upload/interface';
import ImagePreview from '@/components/ImagePreview';

const { Option } = Select;
const { Title, Text, Link, Paragraph } = Typography;

const ProductSelection: React.FC = () => {
  const queryClient = useQueryClient();
  const [form] = Form.useForm();

  // 状态管理
  const [activeTab, setActiveTab] = useState('search');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
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
  const { data: historyData, refetch: refetchHistory } = useQuery({
    queryKey: ['productSelectionHistory', historyPage],
    queryFn: () => api.getImportHistory(historyPage, 10),
    enabled: activeTab === 'history',
  });


  // 处理搜索
  const handleSearch = (values: any) => {
    const params: api.ProductSearchParams = {};

    if (values.brand) params.brand = values.brand;
    if (values.rfbs_low_max) params.rfbs_low_max = values.rfbs_low_max;
    if (values.rfbs_mid_max) params.rfbs_mid_max = values.rfbs_mid_max;
    if (values.fbp_low_max) params.fbp_low_max = values.fbp_low_max;
    if (values.fbp_mid_max) params.fbp_mid_max = values.fbp_mid_max;
    if (values.monthly_sales_min) params.monthly_sales_min = values.monthly_sales_min;
    if (values.monthly_sales_max) params.monthly_sales_max = values.monthly_sales_max;
    if (values.weight_max) params.weight_max = values.weight_max;
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
    try {
      const response = await api.getProductDetail(product.product_id);
      if (response.success && response.data.images.length > 0) {
        // 提取图片URL数组
        const imageUrls = response.data.images.map((img: any) => img.url);
        setSelectedProductImages(imageUrls);
        setCurrentImageIndex(0);
        setImageModalVisible(true);
      } else {
        message.info('该商品暂无更多图片');
      }
    } catch (error) {
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
              style={{
                height: 160,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f0f0f0',
                cursor: 'pointer'
              }}
              onClick={() => showProductImages(product)}
            >
              <img
                alt={product.product_name_cn}
                src={product.image_url}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
              />
            </div>
          ) : (
            <div
              style={{
                height: 160,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#f0f0f0',
                cursor: 'pointer'
              }}
              onClick={() => showProductImages(product)}
            >
              <ShoppingOutlined style={{ fontSize: 40, color: '#ccc' }} />
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
            style={{ fontSize: '12px' }}
          >
            查看
          </Button>,
        ]}
      >
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {/* 商品名称 */}
          <Paragraph ellipsis={{ rows: 2, tooltip: product.product_name_cn }} style={{ fontSize: '12px', lineHeight: '1.4', marginBottom: 0 }}>
            {product.product_name_cn || product.product_name_ru}
          </Paragraph>
          {/* 价格信息 */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text strong style={{ fontSize: 16, color: '#ff4d4f' }}>
                ¥{formatPrice(product.current_price)}
              </Text>
              {product.original_price && (
                <Text delete style={{ color: '#999', fontSize: '12px' }}>
                  ¥{formatPrice(product.original_price)}
                </Text>
              )}
              {product.original_price && discount > 0 && (
                <Tag color="red" style={{ margin: 0, padding: '0 4px', fontSize: '11px', lineHeight: '18px' }}>
                  -{discount}%
                </Tag>
              )}
            </div>
          </div>

          {/* 品牌 */}
          <div style={{ fontSize: '11px', lineHeight: '1.2' }}>
            <Text type="secondary">品牌: </Text>
            <Text strong>{product.brand || '无品牌'}</Text>
          </div>

          {/* 佣金率 - 紧凑布局 */}
          <div style={{ background: '#f5f5f5', padding: '3px 4px', borderRadius: '2px', marginTop: '2px' }}>
            <Row gutter={4} style={{ marginBottom: '2px' }}>
              <Col span={12}>
                <Text style={{ fontSize: '10px', color: '#666' }}>rFBS≤1500:</Text>
                <Text strong style={{ fontSize: '11px', marginLeft: '2px' }}>{product.rfbs_commission_low}%</Text>
              </Col>
              <Col span={12}>
                <Text style={{ fontSize: '10px', color: '#666' }}>FBP≤1500:</Text>
                <Text strong style={{ fontSize: '11px', marginLeft: '2px' }}>{product.fbp_commission_low}%</Text>
              </Col>
            </Row>
            <Row gutter={4}>
              <Col span={12}>
                <Text style={{ fontSize: '10px', color: '#666' }}>rFBS(1.5-5k):</Text>
                <Text strong style={{ fontSize: '11px', marginLeft: '2px' }}>{product.rfbs_commission_mid}%</Text>
              </Col>
              <Col span={12}>
                <Text style={{ fontSize: '10px', color: '#666' }}>FBP(1.5-5k):</Text>
                <Text strong style={{ fontSize: '11px', marginLeft: '2px' }}>{product.fbp_commission_mid}%</Text>
              </Col>
            </Row>
          </div>

          {/* 销量和重量 */}
          <Row gutter={4} style={{ marginTop: '4px' }}>
            <Col span={12}>
              <div style={{ fontSize: '11px' }}>
                <Text type="secondary">月销: </Text>
                <Text strong>{product.monthly_sales_volume}</Text>
              </div>
            </Col>
            <Col span={12}>
              <div style={{ fontSize: '11px' }}>
                <Text type="secondary">重量: </Text>
                <Text strong>{product.package_weight}g</Text>
              </div>
            </Col>
          </Row>

          {/* 竞争对手数据 */}
          <div style={{ marginTop: '4px' }}>
            <Row gutter={4}>
              <Col span={12}>
                <div style={{ fontSize: '11px' }}>
                  <Text type="secondary">跟卖者: </Text>
                  {product.competitor_count !== null && product.competitor_count !== undefined ? (
                    <Text
                      strong
                      style={{ color: '#fa8c16', cursor: product.competitor_count > 0 ? 'pointer' : 'default' }}
                      onClick={() => product.competitor_count && product.competitor_count > 0 && showCompetitorsList(product)}
                    >
                      {product.competitor_count}家
                    </Text>
                  ) : (
                    <Text style={{ color: '#999' }}>-</Text>
                  )}
                </div>
              </Col>
              <Col span={12}>
                <div style={{ fontSize: '11px' }}>
                  <Text type="secondary">跟卖最低价: </Text>
                  {product.competitor_min_price !== null && product.competitor_min_price !== undefined ? (
                    <Text strong style={{ color: '#fa8c16' }}>
                      ¥{formatPrice(product.competitor_min_price)}
                    </Text>
                  ) : (
                    <Text style={{ color: '#999' }}>-</Text>
                  )}
                </div>
              </Col>
            </Row>
          </div>

          {/* 评分 - 更紧凑 */}
          {product.rating && (
            <div style={{ fontSize: '11px', marginTop: '2px' }}>
              <StarOutlined style={{ color: '#faad14', fontSize: '11px' }} />
              <Text strong style={{ marginLeft: 2 }}>{product.rating}</Text>
              <Text type="secondary" style={{ marginLeft: 2 }}>({product.review_count})</Text>
            </div>
          )}
        </div>
      </Card>
    );
  };

  return (
    <Card title="选品助手" style={{ margin: 24 }}>
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
          <Card style={{ marginBottom: 24 }}>
            <Form
              form={form}
              layout="vertical"
              onFinish={handleSearch}
              initialValues={{ sort_by: 'sales_desc' }}
            >
              <Row gutter={16}>
                <Col xs={24} sm={12} md={8} lg={6}>
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

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="rFBS(≤1500₽) 佣金率≤" name="rfbs_low_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={2}
                      style={{ width: '100%' }}
                      placeholder="最大佣金率%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="rFBS(1501-5000₽) 佣金率≤" name="rfbs_mid_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={2}
                      style={{ width: '100%' }}
                      placeholder="最大佣金率%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="FBP(≤1500₽) 佣金率≤" name="fbp_low_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={2}
                      style={{ width: '100%' }}
                      placeholder="最大佣金率%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="FBP(1501-5000₽) 佣金率≤" name="fbp_mid_max">
                    <InputNumber
                      min={0}
                      max={100}
                      precision={2}
                      style={{ width: '100%' }}
                      placeholder="最大佣金率%"
                      suffix="%"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="月销量范围">
                    <Space.Compact style={{ width: '100%' }}>
                      <Form.Item name="monthly_sales_min" noStyle>
                        <InputNumber
                          min={0}
                          style={{ width: '50%' }}
                          placeholder="最小"
                        />
                      </Form.Item>
                      <Form.Item name="monthly_sales_max" noStyle>
                        <InputNumber
                          min={0}
                          style={{ width: '50%' }}
                          placeholder="最大"
                        />
                      </Form.Item>
                    </Space.Compact>
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="包装重量≤(g)" name="weight_max">
                    <InputNumber
                      min={0}
                      style={{ width: '100%' }}
                      placeholder="最大重量"
                      suffix="g"
                    />
                  </Form.Item>
                </Col>

                <Col xs={24} sm={12} md={8} lg={6}>
                  <Form.Item label="排序方式" name="sort_by">
                    <Select>
                      <Option value="sales_desc">销量从高到低</Option>
                      <Option value="sales_asc">销量从低到高</Option>
                      <Option value="weight_asc">重量从低到高</Option>
                      <Option value="price_asc">价格从低到高</Option>
                      <Option value="price_desc">价格从高到低</Option>
                    </Select>
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

          {/* 搜索结果统计 */}
          {productsData?.data && (
            <Row gutter={16} style={{ marginBottom: 16 }}>
              <Col>
                <Statistic
                  title="搜索结果"
                  value={productsData.data.total}
                  suffix="件商品"
                />
              </Col>
              <Col>
                <Text type="secondary">
                  第 {productsData.data.page} 页，共 {productsData.data.total_pages} 页
                </Text>
              </Col>
            </Row>
          )}

          {/* 商品列表 */}
          <Spin spinning={productsLoading}>
            {productsData?.data?.items && productsData.data.items.length > 0 ? (
              <Row gutter={[16, 16]}>
                {productsData.data.items.map((product) => (
                  <Col key={product.id} xs={24} sm={12} md={8} lg={6} xl={4}>
                    {renderProductCard(product)}
                  </Col>
                ))}
              </Row>
            ) : (
              <Empty description="暂无商品数据" />
            )}
          </Spin>

          {/* 分页 */}
          {productsData?.data && productsData.data.total > 0 && (
            <div style={{ marginTop: 24, textAlign: 'center' }}>
              <Space.Compact>
                <Button
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(currentPage - 1)}
                >
                  上一页
                </Button>
                <Button>
                  {currentPage} / {productsData.data.total_pages}
                </Button>
                <Button
                  disabled={currentPage === productsData.data.total_pages}
                  onClick={() => setCurrentPage(currentPage + 1)}
                >
                  下一页
                </Button>
              </Space.Compact>
            </div>
          )}
              </>
            )
          },
          {
            key: 'import',
            label: <span><UploadOutlined /> 数据导入</span>,
            children: (
          <Card>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              <Alert
                message="导入说明"
                description={
                  <div>
                    <p>1. 支持 Excel (.xlsx) 和 CSV (.csv) 文件格式</p>
                    <p>2. 文件需包含必要列：商品ID、商品名称等</p>
                    <p>3. 系统会自动进行数据清洗和格式转换</p>
                    <p>4. 可选择导入策略：跳过重复、更新已有、追加记录</p>
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
                  <FileExcelOutlined style={{ fontSize: 48, color: '#40a9ff' }} />
                </p>
                <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
                <p className="ant-upload-hint">
                  支持 Excel 和 CSV 文件，文件大小不超过 10MB
                </p>
              </Upload.Dragger>
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
            <div style={{ marginBottom: 16 }}>
              <Text strong>{selectedProductCompetitors.product_name_cn || selectedProductCompetitors.product_name_ru}</Text>
            </div>
            <Alert
              message={`共发现 ${selectedProductCompetitors.competitor_count || 0} 个跟卖者`}
              type="info"
              style={{ marginBottom: 16 }}
            />
            <div style={{ textAlign: 'center', padding: '20px' }}>
              {selectedProductCompetitors.competitor_min_price ? (
                <>
                  <Text type="secondary">跟卖者数据已从选品导入中获取</Text>
                  <div style={{ marginTop: 10 }}>
                    <Text>最低跟卖价: </Text>
                    <Text strong style={{ color: '#fa8c16', fontSize: '18px' }}>
                      ¥{formatPrice(selectedProductCompetitors.competitor_min_price)}
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
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            <Alert
              message={`文件包含 ${previewData.total_rows} 行数据`}
              type="info"
            />

            <div>
              <Text strong>导入策略：</Text>
              <Select
                value={importStrategy}
                onChange={setImportStrategy}
                style={{ width: 200, marginLeft: 8 }}
              >
                <Option value="skip">跳过重复记录</Option>
                <Option value="update">更新已有记录</Option>
                <Option value="append">追加为新记录</Option>
              </Select>
            </div>

            <div>
              <Text strong>数据预览（前5行）：</Text>
              <div style={{ overflowX: 'auto', marginTop: 8 }}>
                <pre style={{ fontSize: 12 }}>
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