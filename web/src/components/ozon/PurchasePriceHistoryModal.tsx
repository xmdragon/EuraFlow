/**
 * 商品进货价格历史弹窗
 * 显示指定SKU的最近10次进货价格记录
 */
import React from 'react';
import { Modal, Table, Typography, Empty, Spin, Tag, message } from 'antd';
import { useQuery } from '@tanstack/react-query';
import moment from 'moment';
import * as ozonApi from '@/services/ozonApi';
import { useCurrency } from '@/hooks/useCurrency';
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
      render: (text: string) => (
        <Text copyable={{ text }}>{text}</Text>
      ),
    },
    {
      title: '进货价格',
      dataIndex: 'purchase_price',
      key: 'purchase_price',
      width: 120,
      render: (price: string | null) => {
        if (!price) return '-';
        const symbol = getCurrencySymbol(userCurrency);
        return <Text strong>{symbol} {price}</Text>;
      },
    },
    {
      title: '日期',
      dataIndex: 'updated_at',
      key: 'date',
      width: 100,
      render: (time: string | null) => {
        if (!time) return '-';
        return moment(time).format('MM-DD');
      },
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
          '拼多多': 'magenta',
          '咸鱼': 'cyan',
          '淘宝': 'red',
        };
        return <Tag color={colorMap[platform] || 'default'}>{platform}</Tag>;
      },
    },
    {
      title: '更新时间',
      dataIndex: 'updated_at',
      key: 'updated_at',
      width: 160,
      render: (time: string | null) => {
        if (!time) return '-';
        return moment(time).format('YYYY-MM-DD HH:mm:ss');
      },
    },
  ];

  return (
    <Modal
      title="进货价格历史"
      open={visible}
      onCancel={onCancel}
      footer={null}
      width={700}
      destroyOnClose
    >
      <div style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          <Text type="secondary">商品名称: </Text>
          <Text strong>{data?.product_name || productName || '-'}</Text>
        </div>
        <div>
          <Text type="secondary">商品SKU: </Text>
          <Text strong copyable={{ text: sku }}>{sku}</Text>
        </div>
      </div>

      {isLoading ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <Spin tip="加载中..." />
        </div>
      ) : !data || data.history.length === 0 ? (
        <Empty description="暂无进货价格记录" />
      ) : (
        <Table
          columns={columns}
          dataSource={data.history}
          rowKey="posting_number"
          pagination={false}
          size="small"
          scroll={{ y: 400 }}
        />
      )}
    </Modal>
  );
};

export default PurchasePriceHistoryModal;
