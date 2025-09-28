import React, { useState } from 'react';
import { Modal, Button, Input, message, Alert, Space, Typography } from 'antd';
import { CopyOutlined, ImportOutlined } from '@ant-design/icons';

const { TextArea } = Input;
const { Paragraph, Text } = Typography;

interface OzonManualDataImportProps {
  productId: string;
  productName?: string;
  onDataImported?: (data: any) => void;
}

const OzonManualDataImport: React.FC<OzonManualDataImportProps> = ({
  productId,
  productName,
  onDataImported
}) => {
  const [visible, setVisible] = useState(false);
  const [jsonInput, setJsonInput] = useState('');
  const [parsing, setParsing] = useState(false);

  // API URL
  const apiUrl = `https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fmodal%2FotherOffersFromSellers%3Fproduct_id%3D${productId}%26page_changed%3Dtrue`;

  const handleParseJson = () => {
    setParsing(true);

    try {
      // 解析 JSON
      const data = JSON.parse(jsonInput);
      console.log('解析成功:', data);

      // 提取竞争者数据
      let competitorCount = 0;
      let minPrice = null;
      const sellers = [];

      if (data.widgetStates) {
        for (const [key, value] of Object.entries(data.widgetStates)) {
          if (typeof value === 'string') {
            try {
              const widget = JSON.parse(value);

              // 查找跟卖者数量
              if (widget.totalCount !== undefined) {
                competitorCount = widget.totalCount;
              }

              // 查找最低价
              if (widget.minPrice !== undefined) {
                minPrice = widget.minPrice;
              }

              // 查找卖家列表
              if (widget.items && Array.isArray(widget.items)) {
                widget.items.forEach((item: any) => {
                  if (item.price && item.sellerName) {
                    sellers.push({
                      seller: item.sellerName,
                      price: item.price
                    });
                  }
                });
              }

              // 查找其他可能的字段
              if (widget.sellers && Array.isArray(widget.sellers)) {
                widget.sellers.forEach((seller: any) => {
                  sellers.push({
                    seller: seller.name || 'Unknown',
                    price: seller.price
                  });
                });
              }
            } catch (e) {
              // 忽略单个 widget 的解析错误
            }
          }
        }
      }

      const extractedData = {
        product_id: productId,
        competitor_count: competitorCount,
        competitor_min_price: minPrice,
        sellers: sellers.slice(0, 10), // 只保留前10个
        timestamp: new Date().toISOString()
      };

      console.log('提取的数据:', extractedData);

      if (competitorCount > 0 || sellers.length > 0) {
        message.success(`成功提取: ${competitorCount || sellers.length} 个跟卖者，最低价 ${minPrice || '未知'}`);

        // 发送到后端
        saveToBackend(extractedData);

        // 回调
        onDataImported?.(extractedData);

        // 清空输入
        setJsonInput('');
        setVisible(false);
      } else {
        message.warning('未找到跟卖者数据，请检查 JSON 内容');
      }

    } catch (error: any) {
      console.error('解析失败:', error);
      message.error(`JSON 解析失败: ${error.message}`);
    } finally {
      setParsing(false);
    }
  };

  const saveToBackend = async (data: any) => {
    try {
      const response = await fetch('/api/ef/v1/ozon/product-selection/browser-extension/competitor-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data)
      });

      if (response.ok) {
        message.success('数据已保存到数据库');
      }
    } catch (err) {
      console.error('保存失败:', err);
    }
  };

  const copyUrl = () => {
    navigator.clipboard.writeText(apiUrl);
    message.success('URL 已复制到剪贴板');
  };

  return (
    <>
      <Button
        icon={<ImportOutlined />}
        size="small"
        onClick={() => setVisible(true)}
        type="primary"
      >
        手动导入
      </Button>

      <Modal
        title={`手动导入跟卖者数据 - ${productName || productId}`}
        open={visible}
        onCancel={() => setVisible(false)}
        width={900}
        footer={[
          <Button key="cancel" onClick={() => setVisible(false)}>
            取消
          </Button>,
          <Button
            key="parse"
            type="primary"
            onClick={handleParseJson}
            loading={parsing}
            disabled={!jsonInput.trim()}
          >
            解析并导入
          </Button>
        ]}
      >
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <Alert
            message="手动获取跟卖者数据步骤"
            description={
              <ol style={{ marginBottom: 0, paddingLeft: 20 }}>
                <li>点击下方"复制 URL"按钮</li>
                <li>在新标签页粘贴并访问该 URL</li>
                <li>如果遇到反机器人验证，完成验证</li>
                <li>页面显示 JSON 数据后，全选并复制（Ctrl+A, Ctrl+C）</li>
                <li>粘贴到下方文本框</li>
                <li>点击"解析并导入"</li>
              </ol>
            }
            type="info"
            showIcon
          />

          <div>
            <Text strong>API URL:</Text>
            <Paragraph
              copyable={{ text: apiUrl, tooltips: ['复制', '已复制'] }}
              style={{
                background: '#f5f5f5',
                padding: '8px 12px',
                borderRadius: 4,
                fontFamily: 'monospace',
                fontSize: 12,
                wordBreak: 'break-all',
                marginTop: 8
              }}
            >
              {apiUrl}
            </Paragraph>
            <Button icon={<CopyOutlined />} onClick={copyUrl}>
              复制 URL
            </Button>
          </div>

          <div>
            <Text strong>粘贴 JSON 数据:</Text>
            <TextArea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder='粘贴从 Ozon 页面复制的 JSON 数据...'
              rows={10}
              style={{
                fontFamily: 'monospace',
                fontSize: 12,
                marginTop: 8
              }}
            />
          </div>

          {jsonInput && (
            <Alert
              message="提示"
              description={`已输入 ${jsonInput.length} 个字符`}
              type="success"
            />
          )}
        </Space>
      </Modal>
    </>
  );
};

export default OzonManualDataImport;