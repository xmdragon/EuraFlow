/**
 * 商品进货价格历史弹窗
 * 显示指定SKU的最近10次进货价格记录
 */
import { useQuery } from '@tanstack/react-query';
import { Modal, Table, Typography, Empty, Spin, Tag, Row, Col, Card } from 'antd';
import { QRCodeSVG } from 'qrcode.react';
import React from 'react';

import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import * as ozonApi from '@/services/ozonApi';
import { getCurrencySymbol } from '@/utils/currency';

const { Text } = Typography;

interface PurchasePriceHistoryModalProps {
  visible: boolean;
  onCancel: () => void;
  sku: string;
  productName?: string;
}

const PurchasePriceHistoryModal: React.FC<PurchasePriceHistoryModalProps> = ({
  visible,
  onCancel,
  sku,
  productName,
}) => {
  const { currency: userCurrency } = useCurrency();
  const { formatDate } = useDateTime();

  // 查询进货价格历史
  const { data, isLoading } = useQuery({
    queryKey: ['purchasePriceHistory', sku],
    queryFn: () => ozonApi.getProductPurchasePriceHistory(sku, 10),
    enabled: visible && !!sku,
    staleTime: 60000, // 1分钟缓存
  });

  const columns = [
    {
      title: 'Posting编号',
      dataIndex: 'posting_number',
      key: 'posting_number',
      width: 180,
      render: (text: string) => <Text copyable={{ text }}>{text}</Text>,
    },
    {
      title: '采购平台',
      dataIndex: 'source_platform',
      key: 'source_platform',
      width: 100,
      render: (platform: string | undefined) => {
        if (!platform) return '-';
        const colorMap: Record<string, string> = {
          '1688': 'orange',
          拼多多: 'magenta',
          咸鱼: 'cyan',
          淘宝: 'red',
        };
        return <Tag color={colorMap[platform] || 'default'}>{platform}</Tag>;
      },
    },
    {
      title: '进货价格',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: 120,
      render: (price: string | null) => {
        if (!price) return '-';
        const symbol = getCurrencySymbol(userCurrency);
        return (
          <Text strong>
            {symbol} {price}
          </Text>
        );
      },
    },
    {
      title: '日期',
      dataIndex: 'updated_at',
      key: 'date',
      width: 120,
      render: (time: string | null) => {
        if (!time) return '-';
        return formatDate(time);
      },
    },
  ];

  return (
    <Modal
      title="商品采购信息"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={900}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">商品名称: </Text>
          <Text strong>{data?.product_name || productName || '-'}</Text>
        </div>
        <div>
          <Text type="secondary">商品SKU: </Text>
          <Text strong copyable={{ text: sku }}>
            {sku}
          </Text>
        </div>
      </div>

      {/* 采购信息卡片 */}
      {data && (data.purchase_url || data.suggested_purchase_price) && (
        <Card title="采购信息" size="small" style={{ marginBottom: 16 }}>
          <Row gutter={16}>
            <Col span={12}>
              <div style={{ marginBottom: 8 }}>
                <Text type="secondary">建议采购价: </Text>
                <Text strong style={{ fontSize: 16, color: '#f5222d' }}>
                  {data.suggested_purchase_price
                    ? `${getCurrencySymbol(userCurrency)} ${parseFloat(data.suggested_purchase_price).toFixed(2)}`
                    : '-'}
                </Text>
              </div>
              <div>
                <Text type="secondary">采购地址: </Text>
                {data.purchase_url ? (
                  <a href={data.purchase_url} target="_blank" rel="noopener noreferrer">
                    {data.purchase_url.length > 40
                      ? `${data.purchase_url.substring(0, 40)}...`
                      : data.purchase_url}
                  </a>
                ) : (
                  <Text>-</Text>
                )}
              </div>
            </Col>
            <Col span={12}>
              {data.purchase_url && (
                <div style={{ textAlign: 'center' }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                    扫码打开采购链接
                  </Text>
                  <QRCodeSVG value={data.purchase_url} size={120} />
                </div>
              )}
            </Col>
          </Row>
        </Card>
      )}

      {/* 进货价格历史 */}
      <div style={{ marginTop: 16 }}>
        <Text strong style={{ fontSize: 14 }}>
          进货价格历史
        </Text>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="加载中..." />
        </div>
      ) : !data || data.history.length === 0 ? (
        <Empty description="暂无进货价格记录" style={{ marginTop: 16 }} />
      ) : (
        <Table
          columns={columns}
          dataSource={data.history}
          rowKey="posting_number"
          pagination={false}
          size="small"
          scroll={{ y: 400 }}
          style={{ marginTop: 8 }}
        />
      )}
    </Modal>
  );
};

export default PurchasePriceHistoryModal;
