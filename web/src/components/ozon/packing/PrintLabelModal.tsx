/**
 * 打印标签弹窗组件
 * 显示PDF格式的快递面单，并支持包装重量录入
 */
import React, { useState, useMemo, useEffect } from "react";
import { Modal, Button, Spin, Table, InputNumber, Tooltip } from "antd";
import { PrinterOutlined } from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import type { PostingWithOrder, OrderItem } from "@/services/ozon/types/order";

interface PrintLabelModalProps {
  visible: boolean;
  pdfUrl: string;
  postings: PostingWithOrder[];  // 当前打印的 posting 列表
  onClose: () => void;
  onAfterClose?: () => void;
  onPrint: (weights: Record<string, number>) => void;  // 打印时传递重量
  onMarkPrinted: () => void;
}

// 表格行数据结构
interface WeightTableRow {
  key: string;
  posting_number: string;
  items: OrderItem[];
  weight?: number;
}

// 生成 SKU 签名（用于自动填充判断）
const generateSkuSignature = (items: OrderItem[]): string => {
  if (!items || items.length === 0) return "";
  const sorted = [...items].sort((a, b) => a.sku.localeCompare(b.sku));
  return sorted.map(item => `${item.sku}:${item.quantity}`).join("|");
};

const PrintLabelModal: React.FC<PrintLabelModalProps> = ({
  visible,
  pdfUrl,
  postings,
  onClose,
  onAfterClose,
  onPrint,
  onMarkPrinted,
}) => {
  const [weights, setWeights] = useState<Record<string, number | undefined>>({});

  // 弹窗关闭时清空重量状态
  useEffect(() => {
    if (!visible) {
      setWeights({});
    }
  }, [visible]);

  // 构建 SKU 签名到 posting_numbers 的映射
  const skuSignatureMap = useMemo(() => {
    const map: Record<string, string[]> = {};
    postings.forEach(posting => {
      const items = posting.items || posting.products || [];
      const signature = generateSkuSignature(items);
      if (signature) {
        if (!map[signature]) {
          map[signature] = [];
        }
        map[signature].push(posting.posting_number);
      }
    });
    return map;
  }, [postings]);

  // 处理重量变化
  const handleWeightChange = (postingNumber: string, value: number | null) => {
    const newWeights = { ...weights };

    if (value === null) {
      delete newWeights[postingNumber];
    } else {
      newWeights[postingNumber] = value;

      // 自动填充相同 SKU 签名的其他 Posting
      const posting = postings.find(p => p.posting_number === postingNumber);
      if (posting) {
        const items = posting.items || posting.products || [];
        const signature = generateSkuSignature(items);
        const relatedPostings = skuSignatureMap[signature] || [];

        relatedPostings.forEach(pn => {
          if (pn !== postingNumber && newWeights[pn] === undefined) {
            newWeights[pn] = value;
          }
        });
      }
    }

    setWeights(newWeights);
  };

  // 检查所有重量是否已填写
  const allWeightsFilled = useMemo(() => {
    if (postings.length === 0) return true;
    return postings.every(posting => {
      const weight = weights[posting.posting_number];
      return weight !== undefined && weight > 0;
    });
  }, [postings, weights]);

  // 表格数据
  const tableData: WeightTableRow[] = useMemo(() => {
    return postings.map(posting => ({
      key: posting.posting_number,
      posting_number: posting.posting_number,
      items: posting.items || posting.products || [],
      weight: weights[posting.posting_number],
    }));
  }, [postings, weights]);

  // 表格列定义
  const columns: ColumnsType<WeightTableRow> = [
    {
      title: "货件编号",
      dataIndex: "posting_number",
      key: "posting_number",
      width: 180,
    },
    {
      title: "SKU",
      key: "sku",
      render: (_, record) => (
        <div>
          {record.items.map((item, idx) => (
            <div key={idx}>
              {item.sku} ×{item.quantity}
            </div>
          ))}
        </div>
      ),
    },
    {
      title: "重量(g)",
      key: "weight",
      width: 140,
      render: (_, record) => (
        <InputNumber
          min={1}
          precision={0}
          placeholder="必填"
          value={record.weight}
          onChange={(value) => handleWeightChange(record.posting_number, value)}
          style={{ width: 120 }}
        />
      ),
    },
  ];

  const handlePrint = () => {
    if (!allWeightsFilled) return;

    // 构建重量数据
    const weightData: Record<string, number> = {};
    postings.forEach(posting => {
      const weight = weights[posting.posting_number];
      if (weight) {
        weightData[posting.posting_number] = weight;
      }
    });

    // 调用打印回调
    onPrint(weightData);

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
        <Tooltip
          key="print-tooltip"
          title={!allWeightsFilled ? "请先填写所有货件的包装重量" : undefined}
        >
          <Button
            key="print"
            type="default"
            icon={<PrinterOutlined />}
            onClick={handlePrint}
            disabled={!allWeightsFilled}
          >
            打印
          </Button>
        </Tooltip>,
        <Tooltip
          key="mark-tooltip"
          title={!allWeightsFilled ? "请先填写所有货件的包装重量" : undefined}
        >
          <Button
            key="mark-printed"
            type="primary"
            onClick={onMarkPrinted}
            disabled={!allWeightsFilled}
          >
            标记已打印
          </Button>
        </Tooltip>,
      ]}
    >
      <div
        style={{
          width: "100%",
          height: "400px",
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

      {/* 重量输入表格 */}
      {postings.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <Table
            dataSource={tableData}
            columns={columns}
            pagination={false}
            size="small"
            bordered
          />
        </div>
      )}
    </Modal>
  );
};

export default PrintLabelModal;
