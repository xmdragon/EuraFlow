/**
 * 水印管理页面
 */
import React, { useState, useEffect } from 'react';
import {
  Card,
  Tabs,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Upload,
  message,
  Modal,
  Table,
  Space,
  Tag,
  Row,
  Col,
  Statistic,
  Divider,
  Spin,
  Image,
} from 'antd';
import {
  UploadOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SettingOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  PictureOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { UploadFile } from 'antd/es/upload/interface';
import * as watermarkApi from '@/services/watermarkApi';
import styles from './WatermarkManagement.module.scss';

const { Option } = Select;

const SCALE_RATIO_MIN: number = 0.01;
const SCALE_RATIO_MAX: number = 1;
const SCALE_RATIO_STEP: number = 0.01;
const OPACITY_MIN: number = 0.1;
const OPACITY_MAX: number = 1;
const OPACITY_STEP: number = 0.1;

const WatermarkManagement: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('watermarks');
  const [cloudinaryForm] = Form.useForm();
  const [watermarkForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [previewImage, setPreviewImage] = useState('');
  const [selectedWatermark, setSelectedWatermark] = useState<watermarkApi.WatermarkConfig | null>(null);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);

  // ============ Cloudinary配置查询（全局配置） ============
  const { data: cloudinaryConfig, isLoading: cloudinaryLoading, refetch: refetchCloudinary } = useQuery({
    queryKey: ['cloudinaryConfig'],
    queryFn: () => watermarkApi.getCloudinaryConfig(),
  });

  // ============ 水印配置查询 ============
  const { data: watermarkConfigs, isLoading: watermarksLoading, refetch: refetchWatermarks } = useQuery({
    queryKey: ['watermarkConfigs'],
    queryFn: () => watermarkApi.getWatermarkConfigs(),
  });

  // ============ 任务列表查询 ============
  const { data: tasks, isLoading: tasksLoading, refetch: refetchTasks } = useQuery({
    queryKey: ['watermarkTasks'],
    queryFn: () => watermarkApi.getTasks({ limit: 50 }),
    enabled: activeTab === 'tasks',
    refetchInterval: activeTab === 'tasks' ? 5000 : false,
  });

  // ============ Cloudinary配置保存（全局配置） ============
  const saveCloudinaryMutation = useMutation({
    mutationFn: (values: any) => watermarkApi.createCloudinaryConfig(values),
    onSuccess: () => {
      message.success('Cloudinary配置保存成功');
      refetchCloudinary();
    },
    onError: (error: any) => {
      message.error(`保存失败: ${error.message}`);
    },
  });

  // ============ Cloudinary连接测试（全局配置） ============
  const testCloudinaryMutation = useMutation({
    mutationFn: () => watermarkApi.testCloudinaryConnection(),
    onSuccess: (data) => {
      if (data.success) {
        message.success('连接测试成功');
        Modal.info({
          title: 'Cloudinary连接信息',
          content: (
            <div>
              <p>Cloud Name: {data.cloud_name}</p>
              {data.quota_usage_percent && (
                <p>配额使用: {data.quota_usage_percent.toFixed(2)}%</p>
              )}
              {data.usage && (
                <>
                  <p>存储使用: {(data.usage.storage_used_bytes / 1024 / 1024).toFixed(2)} MB</p>
                  <p>带宽使用: {(data.usage.bandwidth_used_bytes / 1024 / 1024).toFixed(2)} MB</p>
                </>
              )}
            </div>
          ),
        });
      } else {
        message.error(`连接测试失败: ${data.error}`);
      }
      refetchCloudinary();
    },
    onError: (error: any) => {
      message.error(`测试失败: ${error.message}`);
    },
  });

  // ============ 水印配置创建 ============
  const createWatermarkMutation = useMutation({
    mutationFn: (values: any) => {
      const { watermarkFile, ...options } = values;
      const payload = {
        ...options,
        positions: defaultPositions,
      };
      // watermarkFile现在是一个fileList数组，取第一个文件
      const file = watermarkFile?.[0]?.originFileObj || watermarkFile?.[0];
      return watermarkApi.createWatermarkConfig(
        values.name,
        file,
        payload
      );
    },
    onSuccess: () => {
      message.success('水印配置创建成功');
      watermarkForm.resetFields();
      refetchWatermarks();
    },
    onError: (error: any) => {
      message.error(`创建失败: ${error.message}`);
    },
  });

  // ============ 水印配置更新 ============
  const updateWatermarkMutation = useMutation({
    mutationFn: ({ configId, options }: { configId: number; options: any }) =>
      watermarkApi.updateWatermarkConfig(configId, options),
    onSuccess: () => {
      message.success('水印配置更新成功');
      setEditModalVisible(false);
      refetchWatermarks();
    },
    onError: (error: any) => {
      message.error(`更新失败: ${error.message}`);
    },
  });

  // ============ 水印配置删除 ============
  const deleteWatermarkMutation = useMutation({
    mutationFn: (configId: number) => watermarkApi.deleteWatermarkConfig(configId),
    onSuccess: () => {
      message.success('水印配置删除成功');
      refetchWatermarks();
    },
    onError: (error: any) => {
      message.error(`删除失败: ${error.message}`);
    },
  });

  // ============ 资源清理 ============
  const cleanupResourcesMutation = useMutation({
    mutationFn: ({ days, dryRun }: { days: number; dryRun: boolean }) =>
      watermarkApi.cleanupOldResources(days, dryRun),
    onSuccess: (data) => {
      if (data.success) {
        if (data.would_delete) {
          Modal.info({
            title: '模拟清理结果',
            content: `将删除 ${data.count} 个过期资源`,
          });
        } else {
          message.success(`成功清理 ${data.count} 个过期资源`);
        }
      } else {
        message.error(`清理失败: ${data.error}`);
      }
    },
    onError: (error: any) => {
      message.error(`清理失败: ${error.message}`);
    },
  });

  // 设置Cloudinary表单初始值
  useEffect(() => {
    if (cloudinaryConfig) {
      cloudinaryForm.setFieldsValue({
        cloud_name: cloudinaryConfig.cloud_name,
        api_key: cloudinaryConfig.api_key,
        folder_prefix: cloudinaryConfig.folder_prefix,
        auto_cleanup_days: cloudinaryConfig.auto_cleanup_days,
      });
    }
  }, [cloudinaryConfig, cloudinaryForm]);

  // 水印位置选项
  const positionOptions = [
    { label: '左上', value: 'top_left' },
    { label: '中上', value: 'top_center' },
    { label: '右上', value: 'top_right' },
    { label: '左中', value: 'center_left' },
    { label: '正中', value: 'center' },
    { label: '右中', value: 'center_right' },
    { label: '左下', value: 'bottom_left' },
    { label: '中下', value: 'bottom_center' },
    { label: '右下', value: 'bottom_right' },
  ];
  const defaultPositions = positionOptions
    .filter((option) => option.value !== 'center')
    .map((option) => option.value);

  const gridLayout: Array<Array<{ key: string; label: string }>> = [
    [
      { key: 'top_left', label: '左上' },
      { key: 'top_center', label: '中上' },
      { key: 'top_right', label: '右上' },
    ],
    [
      { key: 'center_left', label: '左中' },
      { key: 'center', label: '正中' },
      { key: 'center_right', label: '右中' },
    ],
    [
      { key: 'bottom_left', label: '左下' },
      { key: 'bottom_center', label: '中下' },
      { key: 'bottom_right', label: '右下' },
    ],
  ];

  // 任务状态标签
  const getTaskStatusTag = (status: string) => {
    const statusMap: Record<string, { color: string; text: string }> = {
      pending: { color: 'default', text: '待处理' },
      processing: { color: 'processing', text: '处理中' },
      completed: { color: 'success', text: '已完成' },
      failed: { color: 'error', text: '失败' },
      cancelled: { color: 'warning', text: '已取消' },
    };
    const config = statusMap[status] || { color: 'default', text: status };
    return <Tag color={config.color}>{config.text}</Tag>;
  };

  // 水印配置表格列
  const watermarkColumns = [
    {
      title: '预览',
      dataIndex: 'image_url',
      key: 'preview',
      width: 80,
      render: (url: string) => (
        <Image
          src={url}
          alt="水印"
          width={50}
          height={50}
          className={styles.previewImage}
        />
      ),
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
    },
    {
      title: '颜色类型',
      dataIndex: 'color_type',
      key: 'color_type',
      render: (type: string) => {
        const colorMap: Record<string, string> = {
          white: '白色',
          blue: '蓝色',
          black: '黑色',
          transparent: '透明',
        };
        return colorMap[type] || type;
      },
    },
    {
      title: '缩放比例',
      dataIndex: 'scale_ratio',
      key: 'scale_ratio',
      render: (ratio: number) => `${(ratio * 100).toFixed(0)}%`,
    },
    {
      title: '透明度',
      dataIndex: 'opacity',
      key: 'opacity',
      render: (opacity: number) => `${(opacity * 100).toFixed(0)}%`,
    },
    {
      title: '状态',
      dataIndex: 'is_active',
      key: 'is_active',
      render: (active: boolean) => (
        <Tag color={active ? 'green' : 'red'}>
          {active ? '激活' : '停用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_: any, record: watermarkApi.WatermarkConfig) => (
        <Space>
          <Button
            size="small"
            icon={<EyeOutlined />}
            onClick={() => {
              setSelectedWatermark(record);
              setPreviewModalVisible(true);
            }}
          >
            预览
          </Button>
          <Button
            size="small"
            icon={<SettingOutlined />}
            onClick={() => {
              setSelectedWatermark(record);
              setSelectedPositions(record.positions || []);
              editForm.setFieldsValue({
                scale_ratio: record.scale_ratio,
                opacity: record.opacity,
                margin_pixels: record.margin_pixels,
                color_type: record.color_type,
                is_active: record.is_active,
              });
              setEditModalVisible(true);
            }}
          >
            编辑
          </Button>
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => {
              Modal.confirm({
                title: '确认删除',
                content: `确定要删除水印配置 "${record.name}" 吗？`,
                onOk: () => deleteWatermarkMutation.mutate(record.id),
              });
            }}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  // 任务表格列
  const taskColumns = [
    {
      title: '任务ID',
      dataIndex: 'id',
      key: 'id',
      width: 120,
      ellipsis: true,
    },
    {
      title: '类型',
      dataIndex: 'task_type',
      key: 'task_type',
      render: (type: string) => (
        <Tag color={type === 'apply' ? 'blue' : 'green'}>
          {type === 'apply' ? '应用水印' : '还原原图'}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: getTaskStatusTag,
    },
    {
      title: '批次',
      key: 'batch',
      render: (record: watermarkApi.WatermarkTask) => {
        if (!record.batch_id) return '-';
        return `${record.batch_position}/${record.batch_total}`;
      },
    },
    {
      title: '重试次数',
      dataIndex: 'retry_count',
      key: 'retry_count',
    },
    {
      title: '错误信息',
      dataIndex: 'error_message',
      key: 'error_message',
      ellipsis: true,
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      render: (time: string) => new Date(time).toLocaleString(),
    },
  ];

  return (
    <div className="watermark-management">
      {/* Cloudinary全局配置 */}
      <Card title="Cloudinary全局配置" className={styles.cloudinaryCard}>
        <Spin spinning={cloudinaryLoading}>
          <Form
            form={cloudinaryForm}
            layout="vertical"
            onFinish={(values) => saveCloudinaryMutation.mutate(values)}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="cloud_name"
                  label="Cloud Name"
                  rules={[{ required: true, message: '请输入Cloud Name' }]}
                >
                  <Input placeholder="your-cloud-name" />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="api_key"
                  label="API Key"
                  rules={[{ required: true, message: '请输入API Key' }]}
                >
                  <Input placeholder="123456789012345" />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="api_secret"
                  label="API Secret"
                  rules={[{ required: !cloudinaryConfig, message: '请输入API Secret' }]}
                >
                  <Input.Password placeholder="保存后不显示" />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="folder_prefix"
                  label="文件夹前缀"
                  initialValue="euraflow"
                >
                  <Input />
                </Form.Item>
              </Col>
              <Col span={6}>
                <Form.Item
                  name="auto_cleanup_days"
                  label="自动清理天数"
                  initialValue={30}
                >
                  <InputNumber min={1} max={365} className={styles.fullWidthInput} />
                </Form.Item>
              </Col>
            </Row>
            <Space>
              <Button type="primary" htmlType="submit" loading={saveCloudinaryMutation.isPending}>
                保存配置
              </Button>
              <Button onClick={() => testCloudinaryMutation.mutate()} loading={testCloudinaryMutation.isPending}>
                测试连接
              </Button>
            </Space>
          </Form>

          {cloudinaryConfig && (
            <div className={styles.configStatus}>
              <Divider orientation="left">配置状态</Divider>
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic
                    title="连接状态"
                    value={cloudinaryConfig.last_test_success ? '正常' : '异常'}
                    prefix={
                      cloudinaryConfig.last_test_success ? (
                        <CheckCircleOutlined className={styles.statusSuccess} />
                      ) : (
                        <CloseCircleOutlined className={styles.statusError} />
                      )
                    }
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="存储使用"
                    value={(cloudinaryConfig.storage_used_bytes || 0) / 1024 / 1024}
                    precision={2}
                    suffix="MB"
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="带宽使用"
                    value={(cloudinaryConfig.bandwidth_used_bytes || 0) / 1024 / 1024}
                    precision={2}
                    suffix="MB"
                  />
                </Col>
                <Col span={6}>
                  <Button
                    type="default"
                    icon={<DeleteOutlined />}
                          onClick={() => {
                            Modal.confirm({
                              title: '资源清理',
                              content: (
                                <div>
                                  <p>清理多少天前的资源？</p>
                                  <InputNumber
                                    id="cleanup-days"
                                    defaultValue={30}
                                    min={1}
                                    max={365}
                                    className={styles.smallInput}
                                  />
                                </div>
                              ),
                              onOk: () => {
                                const input = document.getElementById('cleanup-days') as HTMLInputElement | null;
                                const days = input ? Number(input.value) || 30 : 30;
                                cleanupResourcesMutation.mutate({ days, dryRun: false });
                              },
                            });
                          }}
                  >
                    清理过期资源
                  </Button>
                </Col>
              </Row>
            </div>
          )}
        </Spin>
      </Card>

      {/* 水印管理（全局配置） */}
      <Card title="水印管理">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => setActiveTab(key)}
          items={[
            {
              key: 'watermarks',
              label: (
                <span>
                  <PictureOutlined /> 水印配置
                </span>
              ),
              children: (
                <>
                  <Form
                    form={watermarkForm}
                    layout="inline"
                    onFinish={(values) => createWatermarkMutation.mutate(values)}
                    className={styles.watermarkForm}
                  >
                    <Form.Item
                      name="name"
                      rules={[{ required: true, message: '请输入水印名称' }]}
                    >
                      <Input placeholder="水印名称" className={styles.mediumInput} />
                    </Form.Item>
                    <Form.Item
                      name="watermarkFile"
                      rules={[{ required: true, message: '请上传水印图片' }]}
                      valuePropName="fileList"
                      getValueFromEvent={(e) => {
                        if (Array.isArray(e)) {
                          return e;
                        }
                        return e?.fileList;
                      }}
                    >
                      <Upload maxCount={1} beforeUpload={() => false} accept="image/*">
                        <Button icon={<UploadOutlined />}>选择图片</Button>
                      </Upload>
                    </Form.Item>
                    <Form.Item name="color_type" initialValue="white">
                      <Select className={styles.smallInput}>
                        <Option value="white">白色</Option>
                        <Option value="blue">蓝色</Option>
                        <Option value="black">黑色</Option>
                        <Option value="transparent">透明</Option>
                      </Select>
                    </Form.Item>
                    <Form.Item name="scale_ratio" label="缩放比例" initialValue={0.1}>
                      <InputNumber
                        min={SCALE_RATIO_MIN}
                        max={SCALE_RATIO_MAX}
                        step={SCALE_RATIO_STEP}
                        formatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
                        parser={(value) => Number(value?.replace('%', '')) / 100}
                        placeholder="缩放比例"
                        className={styles.smallInput}
                      />
                    </Form.Item>
                    <Form.Item name="opacity" label="透明度" initialValue={0.8}>
                      <InputNumber
                        min={OPACITY_MIN}
                        max={OPACITY_MAX}
                        step={OPACITY_STEP}
                        formatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
                        parser={(value) => Number(value?.replace('%', '')) / 100}
                        placeholder="透明度"
                        className={styles.smallInput}
                      />
                    </Form.Item>
                    <Form.Item>
                      <Button type="primary" htmlType="submit" loading={createWatermarkMutation.isPending}>
                        创建水印
                      </Button>
                    </Form.Item>
                  </Form>

                  <Table
                    columns={watermarkColumns}
                    dataSource={watermarkConfigs || []}
                    rowKey="id"
                    loading={watermarksLoading}
                    pagination={false}
                  />
                </>
              ),
            },
            {
              key: 'tasks',
              label: (
                <span>
                  <SyncOutlined /> 任务监控
                </span>
              ),
              children: (
                <>
                  <Space className={styles.taskToolbar}>
                    <Button icon={<ReloadOutlined />} onClick={() => refetchTasks()}>
                      刷新
                    </Button>
                  </Space>

                  <Table
                    columns={taskColumns}
                    dataSource={tasks || []}
                    rowKey="id"
                    loading={tasksLoading}
                    pagination={{
                      pageSize: 20,
                      showSizeChanger: true,
                      showTotal: (total) => `共 ${total} 条`,
                    }}
                  />
                </>
              ),
            },
          ]}
        />
      </Card>

      {/* 编辑模态框 */}
      <Modal
        title="编辑水印配置"
        open={editModalVisible}
        onCancel={() => {
          setEditModalVisible(false);
          setSelectedPositions([]);
        }}
        onOk={() => {
          editForm.validateFields().then((values) => {
            if (selectedWatermark) {
              updateWatermarkMutation.mutate({
                configId: selectedWatermark.id,
                options: {
                  ...values,
                  positions: selectedPositions,
                },
              });
            }
          });
        }}
        confirmLoading={updateWatermarkMutation.isPending}
        width={600}
      >
        {selectedWatermark && (
          <Form
            form={editForm}
            layout="vertical"
          >
            <Row gutter={16}>
              <Col span={8}>
                <Form.Item
                  name="scale_ratio"
                  label="缩放比例"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    min={SCALE_RATIO_MIN}
                    max={SCALE_RATIO_MAX}
                    step={SCALE_RATIO_STEP}
                    formatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={(value) => Number(value?.replace('%', '')) / 100}
                    className={styles.fullWidthInput}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="opacity"
                  label="透明度"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    min={OPACITY_MIN}
                    max={OPACITY_MAX}
                    step={OPACITY_STEP}
                    formatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
                    parser={(value) => Number(value?.replace('%', '')) / 100}
                    className={styles.fullWidthInput}
                  />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="margin_pixels"
                  label="边距(像素)"
                  rules={[{ required: true }]}
                >
                  <InputNumber
                    min={0}
                    max={100}
                    className={styles.fullWidthInput}
                  />
                </Form.Item>
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="color_type"
                  label="颜色类型"
                  rules={[{ required: true }]}
                >
                  <Select>
                    <Option value="white">白色</Option>
                    <Option value="blue">蓝色</Option>
                    <Option value="black">黑色</Option>
                    <Option value="transparent">透明</Option>
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="is_active"
                  label="状态"
                  rules={[{ required: true }]}
                >
                  <Select>
                    <Option value={true}>激活</Option>
                    <Option value={false}>停用</Option>
                  </Select>
                </Form.Item>
              </Col>
            </Row>
            <Form.Item label="水印位置（点击选择）">
              <div className={styles.positionGrid}>
                {gridLayout.flat().map(({ key, label }) => {
                  const isSelected = selectedPositions.includes(key);
                  return (
                    <div
                      key={key}
                      onClick={() => {
                        if (isSelected) {
                          setSelectedPositions(selectedPositions.filter(p => p !== key));
                        } else {
                          setSelectedPositions([...selectedPositions, key]);
                        }
                      }}
                      className={`${styles.positionCell} ${isSelected ? styles.selected : ''}`}
                    >
                      {label}
                    </div>
                  );
                })}
              </div>
              {selectedPositions.length === 0 && (
                <div className={styles.positionError}>
                  请至少选择一个位置
                </div>
              )}
            </Form.Item>
          </Form>
        )}
      </Modal>

      {/* 预览模态框 */}
      <Modal
        title="水印预览设置"
        open={previewModalVisible}
        onCancel={() => setPreviewModalVisible(false)}
        footer={null}
        width={400}
      >
        {selectedWatermark && (
          <div>
            <div className={styles.previewContainer}>
              <Image
                src={selectedWatermark.image_url}
                alt="水印预览"
                className={styles.previewImageLarge}
              />
            </div>
            <Divider />
            <p><strong>名称:</strong> {selectedWatermark.name}</p>
            <p><strong>颜色类型:</strong> {selectedWatermark.color_type}</p>
            <p><strong>缩放比例:</strong> {(selectedWatermark.scale_ratio * 100).toFixed(0)}%</p>
            <p><strong>透明度:</strong> {(selectedWatermark.opacity * 100).toFixed(0)}%</p>
            <p><strong>边距:</strong> {selectedWatermark.margin_pixels}px</p>
            <p><strong>允许位置:</strong></p>
            <div className={styles.previewPositionGrid}>
              {gridLayout.flat().map(({ key, label }) => {
                const enabled = selectedWatermark.positions?.includes(key) ?? false;
                return (
                  <div
                    key={key}
                    className={`${styles.previewPositionCell} ${enabled ? styles.enabled : ''}`}
                  >
                    {label}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default WatermarkManagement;
