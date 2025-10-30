/**
 * 打印标签弹窗组件
 * 显示PDF格式的快递面单
 */
import React from "react";
import { Modal, Button, Spin } from "antd";
import { PrinterOutlined } from "@ant-design/icons";

interface PrintLabelModalProps {
  visible: boolean;
  pdfUrl: string;
  onClose: () => void;
  onAfterClose?: () => void;
  onMarkPrinted: () => void;
}

const PrintLabelModal: React.FC<PrintLabelModalProps> = ({
  visible,
  pdfUrl,
  onClose,
  onAfterClose,
  onMarkPrinted,
}) => {
  const handlePrint = () => {
    // 触发浏览器打印对话框
    const iframe = document.getElementById(
      "print-label-iframe",
    ) as HTMLIFrameElement;
    if (iframe?.contentWindow) {
      iframe.contentWindow.print();
    }
  };

  return (
    <Modal
      title="快递面单"
      open={visible}
      onCancel={onClose}
      afterClose={onAfterClose}
      width={900}
      footer={[
        <Button key="cancel" onClick={onClose}>
          关闭
        </Button>,
        <Button
          key="print"
          type="default"
          icon={<PrinterOutlined />}
          onClick={handlePrint}
        >
          打印
        </Button>,
        <Button key="mark-printed" type="primary" onClick={onMarkPrinted}>
          标记已打印
        </Button>,
      ]}
    >
      <div
        style={{
          width: "100%",
          height: "600px",
          display: "flex",
          justifyContent: "center",
        }}
      >
        {pdfUrl ? (
          <iframe
            id="print-label-iframe"
            src={pdfUrl}
            style={{
              width: "100%",
              height: "100%",
              border: "none",
            }}
            title="快递面单"
          />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            <Spin size="large" tip="加载PDF中..." />
          </div>
        )}
      </div>
    </Modal>
  );
};

export default PrintLabelModal;
