/**
 * 视频管理弹窗组件
 *
 * 功能：
 * - 添加视频（URL输入 或 文件上传）
 * - 设置/取消封面视频
 * - 删除视频
 * - 视频预览
 */
import {
  PlusOutlined,
  DeleteOutlined,
  VideoCameraOutlined,
  StarOutlined,
  StarFilled,
  UploadOutlined,
} from '@ant-design/icons';
import {
  Modal,
  Form,
  Input,
  Button,
  List,
  Tag,
  Space,
  Typography,
  Empty,
  Radio,
  Tooltip,
  Upload,
} from 'antd';
import type { UploadFile } from 'antd';
import React, { useState } from 'react';

import type { VideoInfo } from '@/services/ozon';
import { uploadMediaFile } from '@/services/ozon';
import { notifyError, notifySuccess } from '@/utils/notification';

const { Text } = Typography;

interface VideoManagerModalProps {
  /** 是否显示弹窗 */
  visible: boolean;

  /** 视频列表 */
  videos: VideoInfo[];

  /** 店铺ID（用于上传视频） */
  shopId?: number;

  /** Offer ID（货号） */
  offerId?: string;

  /** 添加视频回调 */
  onAddVideo: (_video: VideoInfo) => void;

  /** 删除视频回调 */
  onDeleteVideo: (_index: number) => void;

  /** 设置封面视频回调 */
  onSetCoverVideo: (_index: number) => void;

  /** 关闭弹窗回调 */
  onClose: () => void;

  /** 最大视频数量 */
  maxVideos?: number;
}

const VideoManagerModal: React.FC<VideoManagerModalProps> = ({
  visible,
  videos,
  shopId,
  offerId,
  onAddVideo,
  onDeleteVideo,
  onSetCoverVideo,
  onClose,
  maxVideos = 10,
}) => {
  const [form] = Form.useForm();
  const [uploadType, setUploadType] = useState<'url' | 'file'>('url');
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [uploading, setUploading] = useState(false);

  /**
   * 处理添加视频（URL方式）
   */
  const handleAddVideoByUrl = async () => {
    try {
      const values = await form.validateFields();
      onAddVideo({
        url: values.url,
        name: '',
        is_cover: false,
      });
      form.resetFields();
    } catch {
      // 表单验证失败，不做处理
    }
  };

  /**
   * 处理文件上传前的验证
   */
  const beforeUpload = (file: File) => {
    const isVideo = file.type === 'video/mp4' || file.type === 'video/quicktime';
    if (!isVideo) {
      notifyError('文件格式错误', '只支持 MP4 和 MOV 格式的视频');
      return Upload.LIST_IGNORE;
    }

    const isLt100M = file.size / 1024 / 1024 < 100;
    if (!isLt100M) {
      notifyError('文件过大', '视频大小不能超过 100MB');
      return Upload.LIST_IGNORE;
    }

    return false; // 阻止自动上传，手动控制
  };

  /**
   * 处理文件上传
   */
  const handleUpload = async () => {
    if (fileList.length === 0) {
      notifyError('请选择文件', '请先选择要上传的视频文件');
      return;
    }

    if (!shopId) {
      notifyError('缺少店铺信息', '无法上传视频，请重新打开页面');
      return;
    }

    const uploadFile = fileList[0];
    const file = uploadFile.originFileObj as File;

    setUploading(true);
    try {
      // 调用真实的上传API
      const response = await uploadMediaFile(file, shopId, 'video');

      if (response.success && response.url) {
        onAddVideo({
          url: response.url,
          name: file.name,
          is_cover: false,
        });
        notifySuccess(
          '上传成功',
          `视频已成功上传到图床 (${response.size_mb}MB, ${response.source})`
        );
        setFileList([]);
      } else {
        notifyError('上传失败', response.error || '未知错误');
      }
    } catch (error) {
      notifyError('上传失败', error instanceof Error ? error.message : '未知错误');
    } finally {
      setUploading(false);
    }
  };

  return (
    <Modal
      title={
        <Space>
          <VideoCameraOutlined />
          <span>视频编辑{offerId ? `(货号：${offerId})` : ''}</span>
          <Tag color="blue">
            {videos.length} / {maxVideos}
          </Tag>
        </Space>
      }
      open={visible}
      onCancel={onClose}
      width={800}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
      ]}
    >
      {/* 添加视频表单 */}
      <div style={{ marginBottom: 16 }}>
        <Radio.Group
          value={uploadType}
          onChange={(e) => setUploadType(e.target.value)}
          style={{ marginBottom: 12 }}
        >
          <Radio value="url">URL 输入</Radio>
          <Radio value="file">文件上传</Radio>
        </Radio.Group>

        {uploadType === 'url' ? (
          <Form form={form} layout="inline" onFinish={handleAddVideoByUrl}>
            <Form.Item
              name="url"
              rules={[
                { required: true, message: '请输入视频URL' },
                { type: 'url', message: '请输入有效的URL地址' },
              ]}
              style={{ flex: 1 }}
            >
              <Input placeholder="输入视频URL" disabled={videos.length >= maxVideos} />
            </Form.Item>
            <Form.Item>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                htmlType="submit"
                disabled={videos.length >= maxVideos}
              >
                添加
              </Button>
            </Form.Item>
          </Form>
        ) : (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Upload
              fileList={fileList}
              beforeUpload={beforeUpload}
              onChange={({ fileList }) => setFileList(fileList)}
              maxCount={1}
              accept="video/mp4,video/quicktime,.mp4,.mov"
            >
              <Button icon={<UploadOutlined />} disabled={videos.length >= maxVideos}>
                选择视频文件
              </Button>
            </Upload>
            {fileList.length > 0 && (
              <Button
                type="primary"
                onClick={handleUpload}
                loading={uploading}
                disabled={videos.length >= maxVideos}
              >
                上传
              </Button>
            )}
          </Space>
        )}
      </div>

      {/* 视频列表 */}
      {videos.length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无视频，请添加视频" />
      ) : (
        <List
          dataSource={videos}
          renderItem={(video, index) => {
            return (
              <List.Item
                key={index}
                style={{
                  padding: '12px 16px',
                  border: '1px solid #f0f0f0',
                  borderRadius: '4px',
                  marginBottom: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                {/* 左侧：视频URL */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Text type="secondary" style={{ fontSize: 12 }} ellipsis={{ tooltip: video.url }}>
                    {video.url}
                  </Text>
                </div>

                {/* 右侧：操作按钮 */}
                <Space size="small">
                  <Tooltip title="查看视频">
                    <Button
                      size="small"
                      icon={<VideoCameraOutlined />}
                      onClick={() => window.open(video.url, '_blank')}
                    />
                  </Tooltip>
                  <Tooltip title={video.is_cover ? '取消封面' : '设为封面'}>
                    <Button
                      type={video.is_cover ? 'primary' : 'default'}
                      size="small"
                      icon={video.is_cover ? <StarFilled /> : <StarOutlined />}
                      onClick={() => onSetCoverVideo(index)}
                    />
                  </Tooltip>
                  <Tooltip title="删除">
                    <Button
                      danger
                      size="small"
                      icon={<DeleteOutlined />}
                      onClick={() => onDeleteVideo(index)}
                    />
                  </Tooltip>
                </Space>
              </List.Item>
            );
          }}
        />
      )}

      {/* 提示信息 */}
      <div style={{ marginTop: 16, padding: '8px 12px', background: '#f6f6f6', borderRadius: 4 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          提示：
          <br />
          1. 每个商品最多可添加 {maxVideos} 个视频。
          <br />
          2. 只能设置 1 个封面视频（封面视频会在商品详情页突出显示）。
          <br />
          3. 格式：MP4,MOV，大小不能超过 100MB；视频封面将替代商品主图，格式： MP4， MOV；大小不超过
          20 MB；时长小于 30 秒。
          <br />
          <Text type="warning" strong>
            注意：文件上传需要经过服务器中转，速度较慢（约2-5分钟），建议使用URL输入方式（先上传到视频平台，再粘贴链接）。
          </Text>
        </Text>
      </div>
    </Modal>
  );
};

export default VideoManagerModal;
