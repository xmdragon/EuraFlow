/**
 * 打印错误结果展示Modal
 * 展示批量打印标签时的成功/失败结果
 */
import { Modal, Button, Space, Alert, Table, Typography } from 'antd';
import React from 'react';

const { Text } = Typography;

export interface PrintError {
  posting_number: string;
  error: string;
  suggestion: string;
}

export interface PrintErrorModalProps {
  /** Modal是否可见 */
  visible: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 打印成功的货件编号列表 */
  successPostings: string[];
  /** 打印失败的错误列表 */
  errors: PrintError[];
  /** 当前选中的货件编号列表 */
  selectedPostingNumbers: string[];
  /** 移除失败订单后的回调 */
  onRemoveFailedAndContinue: (postings: string[]) => void;
}

/**
 * 打印错误结果展示Modal
 */
export const PrintErrorModal: React.FC<PrintErrorModalProps> = ({
  visible,
  onClose,
  successPostings,
  errors,
  selectedPostingNumbers,
  onRemoveFailedAndContinue,
}) => {
  const handleRemoveFailed = () => {
    // 移除失败的，保留成功的，重新选择
    const failedNumbers = errors.map((e) => e.posting_number);
    const remaining = selectedPostingNumbers.filter((pn) => !failedNumbers.includes(pn));
    onRemoveFailedAndContinue(remaining);
    onClose();
  };

  return (
    <Modal
      title="打印结果"
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        successPostings.length > 0 && (
          <Button key="retry-failed" type="primary" onClick={handleRemoveFailed}>
            移除失败订单继续
          </Button>
        ),
      ]}
      width={700}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {/* 成功统计 */}
        {successPostings.length > 0 && (
          <Alert message={`成功打印 ${successPostings.length} 个订单`} type="success" showIcon />
        )}

        {/* 失败列表 */}
        {errors.length > 0 && (
          <>
            <Alert
              message={`失败 ${errors.length} 个订单`}
              description="以下订单打印失败，请根据提示操作"
              type="error"
              showIcon
            />

            <Table
              dataSource={errors}
              rowKey="posting_number"
              pagination={false}
              size="small"
              columns={[
                {
                  title: '货件编号',
                  dataIndex: 'posting_number',
                  width: 180,
                  render: (text) => <Text strong>{text}</Text>,
                },
                {
                  title: '错误原因',
                  dataIndex: 'error',
                  render: (text) => <Text type="danger">{text}</Text>,
                },
                {
                  title: '建议',
                  dataIndex: 'suggestion',
                  render: (text) => <Text type="secondary">{text}</Text>,
                },
              ]}
            />
          </>
        )}
      </Space>
    </Modal>
  );
};

export default PrintErrorModal;
