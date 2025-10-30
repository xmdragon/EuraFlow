/**
 * 商品导入Modal组件
 */
import { UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Modal, Space, Upload } from 'antd';
import React from 'react';

import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

export interface ProductImportModalProps {
  visible: boolean;
  onCancel: () => void;
  selectedShop: number | null;
  onSuccess: () => void;
  onDownloadTemplate: () => void;
}

/**
 * 商品导入Modal组件
 */
export const ProductImportModal: React.FC<ProductImportModalProps> = ({
  visible,
  onCancel,
  selectedShop,
  onSuccess,
  onDownloadTemplate,
}) => {
  const handleBeforeUpload = (file: File) => {
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
            shop_id: selectedShop || undefined,
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
          onSuccess();
        } else {
          notifyError('导入失败', result.message || '商品导入失败');
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : '导入失败';
        notifyError('导入失败', `导入失败: ${errorMsg}`);
      }
    };

    reader.readAsText(file, 'UTF-8');
    onCancel();
    return false; // 阻止自动上传
  };

  return (
    <Modal title="导入商品" open={visible} onCancel={onCancel} footer={null} width={600}>
      <div style={{ textAlign: 'center', padding: '20px 0' }}>
        <Upload.Dragger
          name="file"
          accept=".csv,.xlsx,.xls"
          showUploadList={false}
          beforeUpload={handleBeforeUpload}
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
            <Button onClick={onCancel}>取消</Button>
            <Button type="link" onClick={onDownloadTemplate}>
              下载模板
            </Button>
          </Space>
        </div>
      </div>
    </Modal>
  );
};
