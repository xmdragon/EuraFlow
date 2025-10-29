/* eslint-disable no-unused-vars */
/**
 * 水印管理页面
 */
import {
  UploadOutlined,
  DeleteOutlined,
  EyeOutlined,
  ReloadOutlined,
  SettingOutlined,
  PictureOutlined,
  SyncOutlined,
  CloudOutlined,
  FileImageOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Tabs,
  Button,
  Form,
  Input,
  InputNumber,
  Select,
  Upload,
  Modal,
  Table,
  Space,
  Tag,
  Row,
  Col,
  Divider,
  Spin,
  Image,
  App,
} from 'antd';
import React, { useState } from 'react';

import styles from './WatermarkManagement.module.scss';

import PageTitle from '@/components/PageTitle';
import { usePermission } from '@/hooks/usePermission';
import * as watermarkApi from '@/services/watermarkApi';
import type { FormValues } from '@/types/common';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Option } = Select;

const SCALE_RATIO_MIN: number = 0.01;
const SCALE_RATIO_MAX: number = 1;
const SCALE_RATIO_STEP: number = 0.01;
const OPACITY_MIN: number = 0.1;
const OPACITY_MAX: number = 1;
const OPACITY_STEP: number = 0.1;

const WatermarkManagement: React.FC = () => {
  const { modal } = App.useApp(); // 使用 App.useApp() hook 获取 modal 实例
  const _queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const [activeTab, setActiveTab] = useState('watermarks');
  const [watermarkForm] = Form.useForm();
  const [editForm] = Form.useForm();
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedWatermark, setSelectedWatermark] = useState<watermarkApi.WatermarkConfig | null>(
    null
  );
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [selectedResources, setSelectedResources] = useState<string[]>([]);
  const [resourcesPage] = useState(0);

  // ============ 水印配置查询 ============
  const {
    data: watermarkConfigs,
    isLoading: watermarksLoading,
    refetch: refetchWatermarks,
  } = useQuery({
    queryKey: ['watermarkConfigs'],
    queryFn: () => watermarkApi.getWatermarkConfigs(),
  });

  // ============ 任务列表查询 ============
  const {
    data: tasks,
    isLoading: tasksLoading,
    refetch: refetchTasks,
  } = useQuery({
    queryKey: ['watermarkTasks'],
    queryFn: () => watermarkApi.getTasks({ limit: 20 }),
    enabled: activeTab === 'tasks',
    refetchInterval: activeTab === 'tasks' ? 5000 : false,
  });

  // ============ Cloudinary资源列表查询 ============
  const {
    data: resourcesData,
    isLoading: resourcesLoading,
    refetch: refetchResources,
  } = useQuery({
    queryKey: ['cloudinaryResources', resourcesPage],
    queryFn: () => watermarkApi.listCloudinaryResources({ max_results: 50 }),
    enabled: activeTab === 'resources',
  });

  // ============ 水印配置创建 ============
  const createWatermarkMutation = useMutation({
    mutationFn: (values: FormValues) => {
      const { watermarkFile, ...options } = values;
      const payload = {
        ...options,
        positions: defaultPositions,
      };
      // watermarkFile现在是一个fileList数组，取第一个文件
      const file = watermarkFile?.[0]?.originFileObj || watermarkFile?.[0];
      return watermarkApi.createWatermarkConfig(values.name as string, file, payload);
    },
    onSuccess: () => {
      notifySuccess('创建成功', '水印配置创建成功');
      watermarkForm.resetFields();
      refetchWatermarks();
    },
    onError: (error: Error) => {
      notifyError('创建失败', `创建失败: ${error.message}`);
    },
  });

  // ============ 水印配置更新 ============
  const updateWatermarkMutation = useMutation({
    mutationFn: ({ configId, options }: { configId: number; options: unknown }) =>
      watermarkApi.updateWatermarkConfig(configId, options),
    onSuccess: () => {
      notifySuccess('更新成功', '水印配置更新成功');
      setEditModalVisible(false);
      refetchWatermarks();
    },
    onError: (error: Error) => {
      notifyError('更新失败', `更新失败: ${error.message}`);
    },
  });

  // ============ 水印配置删除 ============
  const deleteWatermarkMutation = useMutation({
    mutationFn: (configId: number) => watermarkApi.deleteWatermarkConfig(configId),
    onSuccess: () => {
      notifySuccess('删除成功', '水印配置删除成功');
      refetchWatermarks();
    },
    onError: (error: Error) => {
      notifyError('删除失败', `删除失败: ${error.message}`);
    },
  });

  // ============ 资源清理 ============
  const _cleanupResourcesMutation = useMutation({
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
          notifySuccess('清理成功', `成功清理 ${data.count} 个过期资源`);
        }
      } else {
        notifyError('清理失败', `清理失败: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      notifyError('清理失败', `清理失败: ${error.message}`);
    },
  });

  // ============ 删除Cloudinary资源 ============
  const deleteResourcesMutation = useMutation({
    mutationFn: (publicIds: string[]) => watermarkApi.deleteCloudinaryResources(publicIds),
    onSuccess: (data) => {
      notifySuccess('删除成功', `成功删除 ${data.deleted_count} 个资源`);
      setSelectedResources([]);
      refetchResources();
    },
    onError: (error: Error) => {
      notifyError('删除失败', `删除失败: ${error.message}`);
    },
  });

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
        <Image src={url} alt="水印" width={50} height={50} className={styles.previewImage} />
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
        <Tag color={active ? 'green' : 'red'}>{active ? '激活' : '停用'}</Tag>
      ),
    },
    ...(canOperate
      ? [
          {
            title: '操作',
            key: 'actions',
            render: (_, record: watermarkApi.WatermarkConfig) => (
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
                    modal.confirm({
                      title: '确认删除',
                      content: `确定要删除水印配置 "${record.name}" 吗？`,
                      okText: '确认',
                      cancelText: '取消',
                      okButtonProps: { danger: true },
                      onOk: () => deleteWatermarkMutation.mutate(record.id)
                    });
                  }}
                >
                  删除
                </Button>
              </Space>
            ),
          },
        ]
      : []),
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
    <div>
      {/* 页面标题 */}
      <PageTitle icon={<PictureOutlined />} title="水印管理" />

      <div className={styles.contentContainer}>
        {/* 水印管理 */}
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
                    {canOperate && (
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
                            controls={false}
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
                            controls={false}
                          />
                        </Form.Item>
                        <Form.Item>
                          <Button
                            type="primary"
                            htmlType="submit"
                            loading={createWatermarkMutation.isPending}
                          >
                            创建水印
                          </Button>
                        </Form.Item>
                      </Form>
                    )}

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
              {
                key: 'resources',
                label: (
                  <span>
                    <CloudOutlined /> 资源管理
                  </span>
                ),
                children: (
                  <>
                    <div className={styles.resourceToolbar}>
                      <Space>
                        <span>已选中: {selectedResources.length} 个</span>
                        {canOperate && (
                          <Button
                            danger
                            icon={<DeleteOutlined />}
                            disabled={selectedResources.length === 0}
                            loading={deleteResourcesMutation.isPending}
                            onClick={() => {
                              if (selectedResources.length > 0) {
                                modal.confirm({
                                  title: '确认删除',
                                  content: `确定要删除选中的 ${selectedResources.length} 个资源吗？此操作不可恢复。`,
                                  okText: '确认',
                                  cancelText: '取消',
                                  okButtonProps: { danger: true },
                                  onOk: () => deleteResourcesMutation.mutate(selectedResources)
                                });
                              }
                            }}
                          >
                            删除选中
                          </Button>
                        )}
                        <Button icon={<ReloadOutlined />} onClick={() => refetchResources()}>
                          刷新
                        </Button>
                      </Space>
                    </div>

                    <Spin spinning={resourcesLoading}>
                      <div className={styles.resourceGrid}>
                        {resourcesData?.resources?.map((resource) => {
                          const isSelected = selectedResources.includes(resource.public_id);
                          const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(
                            resource.format?.toLowerCase() || ''
                          );
                          const isVideo = ['mp4', 'mov', 'avi', 'webm'].includes(
                            resource.format?.toLowerCase() || ''
                          );

                          return (
                            <div
                              key={resource.public_id}
                              className={`${styles.resourceCard} ${isSelected ? styles.selected : ''}`}
                              onClick={() => {
                                if (isSelected) {
                                  setSelectedResources(
                                    selectedResources.filter((id) => id !== resource.public_id)
                                  );
                                } else {
                                  setSelectedResources([...selectedResources, resource.public_id]);
                                }
                              }}
                            >
                              <div className={styles.resourceThumbnail}>
                                {isImage && (
                                  <img
                                    src={resource.url.replace(
                                      '/upload/',
                                      '/upload/w_160,h_160,c_fill,q_auto/'
                                    )}
                                    alt={resource.public_id}
                                    className={styles.thumbnailImage}
                                  />
                                )}
                                {isVideo && (
                                  <div className={styles.videoPlaceholder}>
                                    <VideoCameraOutlined className={styles.videoIcon} />
                                  </div>
                                )}
                                {!isImage && !isVideo && (
                                  <div className={styles.filePlaceholder}>
                                    <FileImageOutlined className={styles.fileIcon} />
                                  </div>
                                )}
                              </div>
                              <div className={styles.resourceCheckbox}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}}
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </div>
                              <div className={styles.resourceInfo}>
                                <div className={styles.resourceInfoItem}>
                                  <strong>尺寸:</strong> {resource.width}x{resource.height}
                                </div>
                                <div className={styles.resourceInfoItem}>
                                  <strong>大小:</strong> {(resource.bytes / 1024).toFixed(2)} KB
                                </div>
                                <div className={styles.resourceInfoItem}>
                                  <strong>上传:</strong>{' '}
                                  {new Date(resource.created_at).toLocaleDateString()}
                                </div>
                                <div className={styles.resourceInfoItem}>
                                  <strong>格式:</strong> {resource.format?.toUpperCase()}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>

                      {(!resourcesData || resourcesData.resources?.length === 0) && (
                        <div className={styles.emptyState}>
                          <CloudOutlined className={styles.emptyIcon} />
                          <p>暂无资源</p>
                        </div>
                      )}
                    </Spin>
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
            <Form form={editForm} layout="vertical">
              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item name="scale_ratio" label="缩放比例" rules={[{ required: true }]}>
                    <InputNumber
                      min={SCALE_RATIO_MIN}
                      max={SCALE_RATIO_MAX}
                      step={SCALE_RATIO_STEP}
                      formatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
                      parser={(value) => Number(value?.replace('%', '')) / 100}
                      className={styles.fullWidthInput}
                      controls={false}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="opacity" label="透明度" rules={[{ required: true }]}>
                    <InputNumber
                      min={OPACITY_MIN}
                      max={OPACITY_MAX}
                      step={OPACITY_STEP}
                      formatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
                      parser={(value) => Number(value?.replace('%', '')) / 100}
                      className={styles.fullWidthInput}
                      controls={false}
                    />
                  </Form.Item>
                </Col>
                <Col span={8}>
                  <Form.Item name="margin_pixels" label="边距(像素)" rules={[{ required: true }]}>
                    <InputNumber
                      min={0}
                      max={100}
                      className={styles.fullWidthInput}
                      controls={false}
                    />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="color_type" label="颜色类型" rules={[{ required: true }]}>
                    <Select>
                      <Option value="white">白色</Option>
                      <Option value="blue">蓝色</Option>
                      <Option value="black">黑色</Option>
                      <Option value="transparent">透明</Option>
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="is_active" label="状态" rules={[{ required: true }]}>
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
                            setSelectedPositions(selectedPositions.filter((p) => p !== key));
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
                  <div className={styles.positionError}>请至少选择一个位置</div>
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
              <p>
                <strong>名称:</strong> {selectedWatermark.name}
              </p>
              <p>
                <strong>颜色类型:</strong> {selectedWatermark.color_type}
              </p>
              <p>
                <strong>缩放比例:</strong> {(selectedWatermark.scale_ratio * 100).toFixed(0)}%
              </p>
              <p>
                <strong>透明度:</strong> {(selectedWatermark.opacity * 100).toFixed(0)}%
              </p>
              <p>
                <strong>边距:</strong> {selectedWatermark.margin_pixels}px
              </p>
              <p>
                <strong>允许位置:</strong>
              </p>
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
    </div>
  );
};

export default WatermarkManagement;
