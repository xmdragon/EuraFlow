/**
 * 打印错误弹窗组件
 * 显示批量打印的成功和失败结果
 */
import React from 'react';
import { Modal, Space, Alert, Table, Button } from 'antd';
import { Typography } from 'antd';

const { Text } = Typography;

export interface FailedPosting {
  posting_number: string;
  error: string;
  suggestion: string;
}

interface PrintErrorModalProps {
  visible: boolean;
  onClose: () => void;
  printSuccessPostings: string[];
  printErrors: FailedPosting[];
  selectedPostingNumbers: string[];
  onRemoveFailedPostings: (failedNumbers: string[]) => void;
}

const PrintErrorModal: React.FC<PrintErrorModalProps> = ({
  visible,
  onClose,
  printSuccessPostings,
  printErrors,
  selectedPostingNumbers,
  onRemoveFailedPostings,
}) => {
  const handleRemoveFailed = () => {
    const failedNumbers = printErrors.map((e) => e.posting_number);
    onRemoveFailedPostings(failedNumbers);
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
        printSuccessPostings.length > 0 && (
          <Button key="retry-failed" type="primary" onClick={handleRemoveFailed}>
            移除失败订单继续
          </Button>
        ),
      ]}
      width={700}
    >
      <Space direction="vertical" style={{ width: '100%' }}>
        {/* 成功统计 */}
        {printSuccessPostings.length > 0 && (
          <Alert
            message={`成功打印 ${printSuccessPostings.length} 个订单`}
            type="success"
            showIcon
          />
        )}

        {/* 失败列表 */}
        {printErrors.length > 0 && (
          <>
            <Alert
              message={`失败 ${printErrors.length} 个订单`}
              description="以下订单打印失败，请根据提示操作"
              type="error"
              showIcon
            />

            <Table
              dataSource={printErrors}
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
