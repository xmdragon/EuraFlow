/**
 * 图床资源管理页面
 * 独立于水印管理，提供图床资源的浏览、删除等功能
 */
import { CloudOutlined, DeleteOutlined, ReloadOutlined, DatabaseOutlined, FileOutlined } from '@ant-design/icons';
import { App, Button, Space, Spin, Collapse, Tag, Card, Row, Col, Statistic } from 'antd';
import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import PageTitle from '@/components/PageTitle';
import * as watermarkApi from '@/services/watermarkApi';
import { notifySuccess, notifyError } from '@/utils/notification';
import { usePermission } from '@/hooks/usePermission';
import { loggers } from '@/utils/logger';

import styles from './ImageStorageResources.module.scss';

/**
 * 生成缩略图URL（支持多图床）
 */
const generateThumbnailUrl = (originalUrl: string, width = 160, height = 160): string => {
  // 判断是否为Cloudinary URL
  if (originalUrl.includes('cloudinary.com')) {
    return originalUrl.replace(
      '/upload/',
      `/upload/w_${width},h_${height},c_fill,q_auto/`
    );
  }

  // 判断是否为阿里云OSS URL
  if (originalUrl.includes('aliyuncs.com')) {
    return `${originalUrl}?x-oss-process=image/resize,w_${width},h_${height},m_fill`;
  }

  // 其他图床，返回原URL
  return originalUrl;
};

/**
 * 从URL或public_id提取文件扩展名
 */
const getFileFormat = (url: string, publicId: string): string => {
  // 先尝试从URL提取
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(\?|$)/);
  if (urlMatch) {
    return urlMatch[1].toLowerCase();
  }

  // 再尝试从public_id提取
  const idMatch = publicId.match(/\.([a-zA-Z0-9]+)$/);
  if (idMatch) {
    return idMatch[1].toLowerCase();
  }

  return 'unknown';
};

/**
 * 格式化字节数为人类可读格式
 */
const formatBytes = (bytes: number | null | undefined): string => {
  if (bytes === null || bytes === undefined) return 'N/A';
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const ImageStorageResources: React.FC = () => {
  const { modal } = App.useApp();
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const [selectedResources, setSelectedResources] = useState<string[]>([]);

  // ============ 获取当前激活的图床配置 ============
  const { data: cloudinaryConfig } = useQuery({
    queryKey: ['cloudinaryConfig'],
    queryFn: async () => {
      try {
        return await watermarkApi.getCloudinaryConfig();
      } catch {
        return null;
      }
    },
    retry: false,
  });

  const { data: ossConfig } = useQuery({
    queryKey: ['aliyunOssConfig'],
    queryFn: async () => {
      try {
        return await watermarkApi.getAliyunOssConfig();
      } catch {
        return null;
      }
    },
    retry: false,
  });

  // 判断当前激活的图床
  const activeProvider =
    cloudinaryConfig?.is_default
      ? 'cloudinary'
      : ossConfig?.is_default && ossConfig?.enabled
        ? 'aliyun_oss'
        : 'none';

  // ============ 图床统计查询 ============
  const { data: usageData, isLoading: usageLoading } = useQuery({
    queryKey: ['imageStorageUsage', activeProvider],
    queryFn: async () => {
      if (activeProvider === 'cloudinary') {
        const result = await watermarkApi.testCloudinaryConnection();
        loggers.storage.info('[ImageStorageResources] Cloudinary usage data:', result);
        return result;
      } else if (activeProvider === 'aliyun_oss') {
        const result = await watermarkApi.testAliyunOssConnection();
        loggers.storage.info('[ImageStorageResources] Aliyun OSS usage data:', result);
        return result;
      }
      return { success: false } as const;
    },
    enabled: activeProvider !== 'none',
    staleTime: 5 * 60 * 1000, // 5分钟缓存
  });

  // ============ 资源列表查询 ============
  const {
    data: resourcesData,
    isLoading: resourcesLoading,
    refetch: refetchResources,
  } = useQuery({
    queryKey: ['imageStorageResources'],
    queryFn: () => watermarkApi.listCloudinaryResources({ max_results: 20 }),
  });

  // ============ 删除资源 ============
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

  return (
    <div className={styles.pageWrapper}>
      <PageTitle icon={<CloudOutlined />} title="图床资源管理" />

      <div className={styles.container}>
        <div className={styles.header}>
          <h3>图床资源浏览</h3>
          <p className={styles.description}>
            管理所有已上传到图床的图片资源，包括水印图片、商品图片等。
            {activeProvider !== 'none' && (
              <span style={{ marginLeft: '10px', color: '#1890ff' }}>
                (当前图床: {activeProvider === 'cloudinary' ? 'Cloudinary' : '阿里云 OSS'})
              </span>
            )}
          </p>
        </div>

        {/* 存储统计卡片 */}
        {usageData && 'usage' in usageData && usageData.usage && (
          <Row gutter={16} style={{ marginBottom: '24px' }}>
            <Col xs={24} sm={12} md={8}>
              <Card>
                <Statistic
                  title={
                    <span>
                      存储量
                      {activeProvider === 'aliyun_oss' && 'storage_used_bytes' in usageData.usage && usageData.usage.storage_used_bytes === 0 && (
                        <span style={{ fontSize: '12px', fontWeight: 'normal', marginLeft: '8px', color: '#999' }}>
                          (统计有延迟)
                        </span>
                      )}
                    </span>
                  }
                  value={formatBytes('storage_used_bytes' in usageData.usage ? usageData.usage.storage_used_bytes : undefined)}
                  prefix={<DatabaseOutlined />}
                  valueStyle={{ fontSize: '20px' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Card>
                <Statistic
                  title="文件数量"
                  value={'object_count' in usageData.usage ? usageData.usage.object_count || 0 : 0}
                  prefix={<FileOutlined />}
                  valueStyle={{ fontSize: '20px' }}
                />
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Card>
                <Statistic
                  title={activeProvider === 'cloudinary' ? '本月带宽' : '本月流量'}
                  value={
                    activeProvider === 'cloudinary' && 'bandwidth_used_bytes' in usageData.usage
                      ? formatBytes(usageData.usage.bandwidth_used_bytes)
                      : undefined
                  }
                  valueStyle={{
                    fontSize: activeProvider === 'cloudinary' ? '20px' : '14px',
                    color: activeProvider === 'cloudinary' ? undefined : '#999',
                  }}
                  formatter={
                    activeProvider === 'aliyun_oss'
                      ? () => (
                          <>
                            需在{' '}
                            <a
                              href="https://oss.console.aliyun.com/overview"
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: '#1890ff' }}
                            >
                              阿里云控制台
                            </a>{' '}
                            查看
                          </>
                        )
                      : undefined
                  }
                />
              </Card>
            </Col>
          </Row>
        )}

        <div className={styles.toolbar}>
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
                      onOk: () => deleteResourcesMutation.mutate(selectedResources),
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
          {/* 按文件夹分组显示 */}
          {resourcesData?.folders && resourcesData.folders.length > 0 ? (
            <Collapse
              defaultActiveKey={resourcesData.folders.map((folder) => folder.folder_path)}
              style={{ marginBottom: '16px' }}
            >
              {resourcesData.folders.map((folder) => (
                <Collapse.Panel
                  key={folder.folder_path}
                  header={
                    <Space>
                      <strong>{folder.folder}</strong>
                      <Tag color="blue">{folder.resource_count} 个资源</Tag>
                    </Space>
                  }
                >
                  <div className={styles.resourceGrid}>
                    {folder.resources.map((resource) => {
                      const isSelected = selectedResources.includes(resource.public_id);
                      // 获取文件格式（兼容缺失format字段的情况）
                      const format = resource.format || getFileFormat(resource.url, resource.public_id);
                      const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(
                        format.toLowerCase()
                      );

                      return (
                        <div
                          key={resource.public_id}
                          className={`${styles.resourceCard} ${isSelected ? styles.selected : ''}`}
                        >
                          <div className={styles.resourceThumbnail}>
                            {isImage && (
                              <img
                                src={generateThumbnailUrl(resource.url)}
                                alt={resource.public_id}
                                className={styles.thumbnailImage}
                              />
                            )}
                          </div>
                          <div className={styles.resourceCheckbox}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => {
                                if (isSelected) {
                                  setSelectedResources(
                                    selectedResources.filter((id) => id !== resource.public_id)
                                  );
                                } else {
                                  setSelectedResources([...selectedResources, resource.public_id]);
                                }
                              }}
                              aria-label={`选择资源 ${resource.public_id}`}
                            />
                          </div>
                          <div className={styles.resourceInfo}>
                            {/* 尺寸信息（可选字段，阿里云OSS不返回） */}
                            {resource.width && resource.height && (
                              <div className={styles.resourceInfoItem}>
                                <strong>尺寸:</strong> {resource.width}x{resource.height}
                              </div>
                            )}
                            <div className={styles.resourceInfoItem}>
                              <strong>大小:</strong> {(resource.bytes / 1024).toFixed(2)} KB
                            </div>
                            {resource.created_at && (
                              <div className={styles.resourceInfoItem}>
                                <strong>上传:</strong>{' '}
                                {new Date(resource.created_at).toLocaleDateString()}
                              </div>
                            )}
                            <div className={styles.resourceInfoItem}>
                              <strong>格式:</strong> {format.toUpperCase()}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Collapse.Panel>
              ))}
            </Collapse>
          ) : (
            <div className={styles.emptyState}>
              <CloudOutlined style={{ fontSize: '48px', color: '#ccc' }} />
              <p>暂无图床资源</p>
            </div>
          )}
        </Spin>
      </div>
    </div>
  );
};

export default ImageStorageResources;
