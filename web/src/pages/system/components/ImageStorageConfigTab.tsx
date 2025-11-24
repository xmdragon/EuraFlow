/**
 * 图床配置 Tab - Cloudinary 和阿里云 OSS
 */
import { CloudServerOutlined, ApartmentOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Alert,
  Tabs,
  Spin,
  Tag,
  Row,
  Col,
  Statistic,
} from 'antd';
import React, { useEffect } from 'react';

import { usePermission } from '@/hooks/usePermission';
import * as watermarkApi from '@/services/watermarkApi';
import { notifySuccess, notifyError } from '@/utils/notification';

const ImageStorageConfigTab: React.FC = () => {
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const [cloudinaryForm] = Form.useForm();
  const [ossForm] = Form.useForm();

  // ============ Cloudinary 配置查询 ============
  const {
    data: cloudinaryConfig,
    isLoading: cloudinaryLoading,
  } = useQuery({
    queryKey: ['cloudinaryConfig'],
    queryFn: async () => {
      try {
        return await watermarkApi.getCloudinaryConfig();
      } catch (error: unknown) {
        // 404 或其他错误，返回 null（未配置）
        console.error('Failed to load Cloudinary config:', error);
        return null;
      }
    },
    retry: false,
  });

  // ============ 阿里云 OSS 配置查询 ============
  const {
    data: ossConfig,
    isLoading: ossLoading,
  } = useQuery({
    queryKey: ['aliyunOssConfig'],
    queryFn: async () => {
      try {
        return await watermarkApi.getAliyunOssConfig();
      } catch (error: unknown) {
        // 404 或其他错误，返回 null（未配置）
        console.error('Failed to load Aliyun OSS config:', error);
        return null;
      }
    },
    retry: false,
  });

  // ============ 创建/更新 Cloudinary 配置 ============
  const saveCloudinaryMutation = useMutation({
    mutationFn: (values: watermarkApi.CloudinaryConfig) =>
      watermarkApi.createCloudinaryConfig(values),
    onSuccess: () => {
      notifySuccess('Cloudinary 配置保存成功');
      queryClient.invalidateQueries({ queryKey: ['cloudinaryConfig'] });
    },
    onError: (error: Error) => {
      notifyError(`保存失败: ${error.message}`);
    },
  });

  // ============ 测试 Cloudinary 连接 ============
  const testCloudinaryMutation = useMutation({
    mutationFn: () => watermarkApi.testCloudinaryConnection(),
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('Cloudinary 连接测试成功');
        queryClient.invalidateQueries({ queryKey: ['cloudinaryConfig'] });
      } else {
        notifyError(`测试失败: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      notifyError(`测试失败: ${error.message}`);
    },
  });

  // ============ 设置 Cloudinary 为默认 ============
  const setCloudinaryDefaultMutation = useMutation({
    mutationFn: () => watermarkApi.setCloudinaryDefault(),
    onSuccess: () => {
      notifySuccess('已切换到 Cloudinary 图床');
      queryClient.invalidateQueries({ queryKey: ['cloudinaryConfig'] });
      queryClient.invalidateQueries({ queryKey: ['aliyunOssConfig'] });
    },
    onError: (error: Error) => {
      notifyError(`切换失败: ${error.message}`);
    },
  });

  // ============ 创建/更新阿里云 OSS 配置 ============
  const saveOssMutation = useMutation({
    mutationFn: (values: watermarkApi.AliyunOssConfig) =>
      watermarkApi.createAliyunOssConfig(values),
    onSuccess: () => {
      notifySuccess('阿里云 OSS 配置保存成功');
      queryClient.invalidateQueries({ queryKey: ['aliyunOssConfig'] });
    },
    onError: (error: Error) => {
      notifyError(`保存失败: ${error.message}`);
    },
  });

  // ============ 测试阿里云 OSS 连接 ============
  const testOssMutation = useMutation({
    mutationFn: () => watermarkApi.testAliyunOssConnection(),
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('阿里云 OSS 连接测试成功');
        queryClient.invalidateQueries({ queryKey: ['aliyunOssConfig'] });
        queryClient.invalidateQueries({ queryKey: ['aliyunOssUsage'] });
      } else {
        notifyError(`测试失败: ${data.error}`);
      }
    },
    onError: (error: Error) => {
      notifyError(`测试失败: ${error.message}`);
    },
  });

  // ============ 阿里云 OSS 存储统计查询 ============
  const {
    data: ossUsageData,
    isLoading: _ossUsageLoading,
  } = useQuery({
    queryKey: ['aliyunOssUsage'],
    queryFn: () => watermarkApi.testAliyunOssConnection(),
    enabled: !!ossConfig && ossConfig.enabled,
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });

  // ============ 设置阿里云 OSS 为默认 ============
  const setOssDefaultMutation = useMutation({
    mutationFn: () => watermarkApi.setAliyunOssDefault(true),
    onSuccess: () => {
      notifySuccess('已切换到阿里云 OSS 图床');
      queryClient.invalidateQueries({ queryKey: ['cloudinaryConfig'] });
      queryClient.invalidateQueries({ queryKey: ['aliyunOssConfig'] });
    },
    onError: (error: Error) => {
      notifyError(`切换失败: ${error.message}`);
    },
  });

  // 自动填充表单
  useEffect(() => {
    if (cloudinaryConfig) {
      cloudinaryForm.setFieldsValue({
        cloud_name: cloudinaryConfig.cloud_name || '',
        api_key: cloudinaryConfig.api_key || '',
        product_images_folder: cloudinaryConfig.product_images_folder || 'products',
        product_videos_folder: cloudinaryConfig.product_videos_folder || 'videos',
        watermark_images_folder: cloudinaryConfig.watermark_images_folder || 'watermarks',
        auto_cleanup_days: cloudinaryConfig.auto_cleanup_days || 30,
      });
    }
  }, [cloudinaryConfig, cloudinaryForm]);

  useEffect(() => {
    if (ossConfig) {
      ossForm.setFieldsValue({
        access_key_id: ossConfig.access_key_id || '',
        bucket_name: ossConfig.bucket_name || '',
        endpoint: ossConfig.endpoint || '',
        region_id: ossConfig.region_id || 'cn-shanghai',
        product_images_folder: ossConfig.product_images_folder || 'products',
        product_videos_folder: ossConfig.product_videos_folder || 'videos',
        watermark_images_folder: ossConfig.watermark_images_folder || 'watermarks',
      });
    }
  }, [ossConfig, ossForm]);

  // 当前激活的图床
  const activeProvider =
    cloudinaryConfig?.is_default
      ? 'cloudinary'
      : ossConfig?.is_default && ossConfig?.enabled
        ? 'aliyun_oss'
        : 'none';

  return (
    <div>
      {/* 图床状态概览 */}
      <Alert
        message={
          <Space>
            <span>当前激活的图床:</span>
            {activeProvider === 'cloudinary' && (
              <Tag color="blue" icon={<CloudServerOutlined />}>
                Cloudinary
              </Tag>
            )}
            {activeProvider === 'aliyun_oss' && (
              <Tag color="green" icon={<ApartmentOutlined />}>
                阿里云 OSS
              </Tag>
            )}
            {activeProvider === 'none' && <Tag>未配置</Tag>}
          </Space>
        }
        type={activeProvider === 'none' ? 'warning' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Tabs
        defaultActiveKey="cloudinary"
        items={[
          {
            key: 'cloudinary',
            label: (
              <Space>
                <CloudServerOutlined />
                Cloudinary
                {cloudinaryConfig?.is_default && (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                )}
              </Space>
            ),
            children: (
              <Card>
                <Alert
                  message="Cloudinary 图床"
                  description="国际 CDN 服务，支持服务端图片转换和水印叠加。免费额度：25 GB存储，25 GB带宽"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {cloudinaryConfig?.is_default && (
                  <Alert
                    message="当前激活"
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Spin spinning={cloudinaryLoading}>
                  <Form
                    form={cloudinaryForm}
                    layout="vertical"
                    onFinish={(values) => saveCloudinaryMutation.mutate(values)}
                  >
                      <Form.Item
                        label="Cloud Name"
                        name="cloud_name"
                        rules={[{ required: true, message: '请输入 Cloud Name' }]}
                      >
                        <Input placeholder="your-cloud-name" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        label="API Key"
                        name="api_key"
                        rules={[{ required: true, message: '请输入 API Key' }]}
                      >
                        <Input placeholder="123456789012345" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        label="API Secret"
                        name="api_secret"
                        rules={[{ required: !cloudinaryConfig, message: '请输入 API Secret' }]}
                      >
                        <Input.Password
                          placeholder={cloudinaryConfig ? '留空表示不修改' : '输入 API Secret'}
                          style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="商品图片文件夹" name="product_images_folder">
                        <Input placeholder="products" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="商品视频文件夹" name="product_videos_folder">
                        <Input placeholder="videos" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="水印图片文件夹" name="watermark_images_folder">
                        <Input placeholder="watermarks" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="自动清理天数" name="auto_cleanup_days">
                        <InputNumber
                          min={1}
                          max={365}
                          controls={false}
                          style={{ width: 300 }}
                        />
                      </Form.Item>

                      {cloudinaryConfig && (
                        <Row gutter={16} style={{ marginTop: 16 }}>
                          <Col span={8}>
                            <Statistic
                              title="存储已用"
                              value={(cloudinaryConfig.storage_used_bytes || 0) / 1024 / 1024}
                              precision={2}
                              suffix="MB"
                            />
                          </Col>
                          <Col span={8}>
                            <Statistic
                              title="带宽已用"
                              value={(cloudinaryConfig.bandwidth_used_bytes || 0) / 1024 / 1024}
                              precision={2}
                              suffix="MB"
                            />
                          </Col>
                        </Row>
                      )}

                      {canOperate && (
                        <Form.Item style={{ marginTop: 16 }}>
                          <Space>
                            <Button
                              type="primary"
                              htmlType="submit"
                              loading={saveCloudinaryMutation.isPending}
                            >
                              保存配置
                            </Button>
                            <Button
                              onClick={() => testCloudinaryMutation.mutate()}
                              loading={testCloudinaryMutation.isPending}
                            >
                              测试连接
                            </Button>
                            {!cloudinaryConfig?.is_default && cloudinaryConfig && (
                              <Button
                                type="link"
                                onClick={() => setCloudinaryDefaultMutation.mutate()}
                                loading={setCloudinaryDefaultMutation.isPending}
                              >
                                设为默认图床
                              </Button>
                            )}
                          </Space>
                        </Form.Item>
                      )}

                      {cloudinaryConfig && (
                        <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
                          最后测试:{' '}
                          {cloudinaryConfig.last_test_at
                            ? new Date(cloudinaryConfig.last_test_at).toLocaleString()
                            : '未测试'}
                        </div>
                      )}
                    </Form>
                </Spin>
              </Card>
            ),
          },
          {
            key: 'aliyun-oss',
            label: (
              <Space>
                <ApartmentOutlined />
                阿里云 OSS
                {ossConfig?.is_default && ossConfig?.enabled && (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                )}
              </Space>
            ),
            children: (
              <Card>
                <Alert
                  message="阿里云 OSS"
                  description="国内对象存储服务，访问速度快，成本较低。适合象寄翻译等国内服务访问"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {ossConfig?.is_default && ossConfig?.enabled && (
                  <Alert
                    message="当前激活"
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Spin spinning={ossLoading}>
                  <Form
                    form={ossForm}
                    layout="vertical"
                    onFinish={(values) => saveOssMutation.mutate(values)}
                  >
                      <Form.Item
                        label="AccessKey ID"
                        name="access_key_id"
                        rules={[{ required: true, message: '请输入 AccessKey ID' }]}
                      >
                        <Input placeholder="LTAI..." style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        label="AccessKey Secret"
                        name="access_key_secret"
                        rules={[{ required: !ossConfig, message: '请输入 AccessKey Secret' }]}
                      >
                        <Input.Password
                          placeholder={ossConfig ? '留空表示不修改' : '输入 AccessKey Secret'}
                          style={{ width: 300 }}
                        />
                      </Form.Item>

                      <Form.Item
                        label="Bucket 名称"
                        name="bucket_name"
                        rules={[{ required: true, message: '请输入 Bucket 名称' }]}
                      >
                        <Input placeholder="euraflow-images" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        label="Endpoint"
                        name="endpoint"
                        rules={[{ required: true, message: '请输入 Endpoint' }]}
                      >
                        <Input placeholder="oss-cn-shanghai.aliyuncs.com" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="区域 ID" name="region_id">
                        <Input placeholder="cn-shanghai" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="商品图片文件夹" name="product_images_folder">
                        <Input placeholder="products" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="商品视频文件夹" name="product_videos_folder">
                        <Input placeholder="videos" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item label="水印图片文件夹" name="watermark_images_folder">
                        <Input placeholder="watermarks" style={{ width: 300 }} />
                      </Form.Item>

                      {ossUsageData?.usage && (
                        <Row gutter={16} style={{ marginTop: 16 }}>
                          <Col span={8}>
                            <Statistic
                              title={
                                <span>
                                  存储已用
                                  {ossUsageData.usage.storage_used_bytes === 0 && (
                                    <span style={{ fontSize: '12px', fontWeight: 'normal', marginLeft: '8px', color: '#999' }}>
                                      (统计有延迟)
                                    </span>
                                  )}
                                </span>
                              }
                              value={(ossUsageData.usage.storage_used_bytes || 0) / 1024 / 1024}
                              precision={2}
                              suffix="MB"
                            />
                          </Col>
                          <Col span={8}>
                            <Statistic
                              title="文件数量"
                              value={ossUsageData.usage.object_count || 0}
                            />
                          </Col>
                        </Row>
                      )}

                      {canOperate && (
                        <Form.Item style={{ marginTop: 16 }}>
                          <Space>
                            <Button
                              type="primary"
                              htmlType="submit"
                              loading={saveOssMutation.isPending}
                            >
                              保存配置
                            </Button>
                            <Button
                              onClick={() => testOssMutation.mutate()}
                              loading={testOssMutation.isPending}
                            >
                              测试连接
                            </Button>
                            {(!ossConfig?.is_default || !ossConfig?.enabled) && ossConfig && (
                              <Button
                                type="link"
                                onClick={() => setOssDefaultMutation.mutate()}
                                loading={setOssDefaultMutation.isPending}
                              >
                                设为默认图床
                              </Button>
                            )}
                          </Space>
                        </Form.Item>
                      )}

                      {ossConfig && (
                        <div style={{ marginTop: 16, fontSize: 12, color: '#666' }}>
                          最后测试:{' '}
                          {ossConfig.last_test_at
                            ? new Date(ossConfig.last_test_at).toLocaleString()
                            : '未测试'}
                        </div>
                      )}
                    </Form>
                </Spin>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default ImageStorageConfigTab;
