/**
 * 商品进货价格历史弹窗
 * 显示指定SKU的最近10次进货价格记录
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Table,
  Typography,
  Empty,
  Spin,
  Tag,
  Row,
  Col,
  Card,
  Button,
  Form,
  Input,
  InputNumber,
} from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import React, { useState } from 'react';

import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import authService from '@/services/authService';
import * as ozonApi from '@/services/ozonApi';
import { getCurrencySymbol } from '@/utils/currency';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { notifySuccess, notifyError } from '@/utils/notification';

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
  const queryClient = useQueryClient();
  const [form] = Form.useForm();
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // 查询进货价格历史
  const { data, isLoading } = useQuery({
    queryKey: ['purchasePriceHistory', sku],
    queryFn: () => ozonApi.getProductPurchasePriceHistory(sku, 10),
    enabled: visible && !!sku,
    staleTime: 60000, // 1分钟缓存
  });

  // 进入编辑模式
  const handleEdit = () => {
    form.setFieldsValue({
      purchase_url: data?.purchase_url || '',
      suggested_purchase_price: data?.suggested_purchase_price
        ? parseFloat(data.suggested_purchase_price)
        : undefined,
      purchase_note: data?.purchase_note || '',
    });
    setIsEditing(true);
  };

  // 取消编辑
  const handleCancelEdit = () => {
    form.resetFields();
    setIsEditing(false);
  };

  // 保存编辑
  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setIsSaving(true);

      const authHeaders = authService.getAuthHeader();
      const response = await fetch(`/api/ef/v1/ozon/products/${sku}/purchase-info`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          purchase_url: values.purchase_url || null,
          suggested_purchase_price: values.suggested_purchase_price
            ? values.suggested_purchase_price.toString()
            : null,
          purchase_note: values.purchase_note || null,
        }),
      });

      const result = await response.json();

      if (result.success) {
        notifySuccess('更新成功', '采购信息已更新');
        // 刷新数据
        queryClient.invalidateQueries({ queryKey: ['purchasePriceHistory', sku] });
        setIsEditing(false);
      } else {
        notifyError('更新失败', result.message || '采购信息更新失败');
      }
    } catch (error: any) {
      notifyError('更新失败', `更新失败: ${error.message}`);
    } finally {
      setIsSaving(false);
    }
  };

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
      {data && (
        <Card
          title="采购信息"
          size="small"
          style={{ marginBottom: 16 }}
          extra={
            !isEditing ? (
              <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>
                编辑
              </Button>
            ) : (
              <div>
                <Button
                  size="small"
                  icon={<CloseOutlined />}
                  onClick={handleCancelEdit}
                  style={{ marginRight: 8 }}
                >
                  取消
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  onClick={handleSave}
                  loading={isSaving}
                >
                  保存
                </Button>
              </div>
            )
          }
        >
          {!isEditing ? (
            <>
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
                  <div style={{ marginBottom: 8 }}>
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
                  <div>
                    <Text type="secondary">采购备注: </Text>
                    <Text>{data.purchase_note || '-'}</Text>
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
            </>
          ) : (
            <Form form={form} layout="vertical">
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item name="suggested_purchase_price" label="建议采购价">
                    <InputNumber
                      style={{ width: '100%' }}
                      min={0}
                      formatter={getNumberFormatter(2)}
                      parser={getNumberParser()}
                      prefix={getCurrencySymbol(userCurrency)}
                      placeholder="请输入建议采购价"
                    />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item name="purchase_url" label="采购地址">
                    <Input placeholder="https://..." />
                  </Form.Item>
                </Col>
              </Row>
              <Form.Item name="purchase_note" label="采购备注">
                <Input.TextArea rows={3} placeholder="请输入采购备注（可选）" />
              </Form.Item>
            </Form>
          )}
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
