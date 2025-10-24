/**
 * Cloudinary全局配置卡片组件
 */
import { DeleteOutlined, CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  Row,
  Col,
  Statistic,
  Divider,
  Spin,
  Modal,
  FormInstance,
} from 'antd';
import React from 'react';

import styles from '../../../pages/ozon/WatermarkManagement.module.scss';

export interface CloudinaryConfigCardProps {
  cloudinaryConfig: any;
  cloudinaryLoading: boolean;
  cloudinaryForm: FormInstance;
  canOperate: boolean;
  saveCloudinaryMutation: any;
  testCloudinaryMutation: any;
  cleanupResourcesMutation: any;
}

export const CloudinaryConfigCard: React.FC<CloudinaryConfigCardProps> = ({
  cloudinaryConfig,
  cloudinaryLoading,
  cloudinaryForm,
  canOperate,
  saveCloudinaryMutation,
  testCloudinaryMutation,
  cleanupResourcesMutation,
}) => {
  return (
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
              <Form.Item name="folder_prefix" label="文件夹前缀" initialValue="euraflow">
                <Input />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item name="auto_cleanup_days" label="自动清理天数" initialValue={30}>
                <InputNumber min={1} max={365} className={styles.fullWidthInput} controls={false} />
              </Form.Item>
            </Col>
          </Row>
          {canOperate && (
            <Space>
              <Button type="primary" htmlType="submit" loading={saveCloudinaryMutation.isPending}>
                保存配置
              </Button>
              <Button
                onClick={() => testCloudinaryMutation.mutate()}
                loading={testCloudinaryMutation.isPending}
              >
                测试连接
              </Button>
            </Space>
          )}
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
              {canOperate && (
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
                              controls={false}
                            />
                          </div>
                        ),
                        onOk: () => {
                          const input = document.getElementById(
                            'cleanup-days'
                          ) as HTMLInputElement | null;
                          const days = input ? Number(input.value) || 30 : 30;
                          cleanupResourcesMutation.mutate({
                            days,
                            dryRun: false,
                          });
                        },
                      });
                    }}
                  >
                    清理过期资源
                  </Button>
                </Col>
              )}
            </Row>
          </div>
        )}
      </Spin>
    </Card>
  );
};

export default CloudinaryConfigCard;
