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
  Divider,
} from 'antd';
import { EditOutlined, SaveOutlined, CloseOutlined } from '@ant-design/icons';
import { QRCodeSVG } from 'qrcode.react';
import React, { useState } from 'react';

import ProductImage from '@/components/ozon/ProductImage';
import { useCurrency } from '@/hooks/useCurrency';
import { useDateTime } from '@/hooks/useDateTime';
import authService from '@/services/authService';
import * as ozonApi from '@/services/ozon';
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
    } catch (error: unknown) {
      const err = error as { message?: string };
      notifyError('更新失败', `更新失败: ${err.message}`);
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
      {/* 商品信息和采购信息 - 左右两栏布局 */}
      {data && (
        <Card size="small" style={{ marginBottom: 16 }}>
          {!isEditing ? (
            <Row gutter={24}>
              {/* 左栏：商品信息 */}
              <Col span={8}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <ProductImage
                    imageUrl={data.primary_image || undefined}
                    size="medium"
                    hoverBehavior="none"
                    sku={sku}
                  />
                  <div style={{ marginTop: 12, textAlign: 'center' }}>
                    <div style={{ marginBottom: 4 }}>
                      <Text type="secondary">SKU: </Text>
                      <Text strong copyable={{ text: sku }}>
                        {sku}
                      </Text>
                    </div>
                    <div>
                      <Text type="secondary">售价: </Text>
                      <Text strong style={{ color: '#1890ff' }}>
                        {data.product_price
                          ? `${getCurrencySymbol(userCurrency)} ${parseFloat(data.product_price).toFixed(2)}`
                          : '-'}
                      </Text>
                    </div>
                  </div>
                </div>
              </Col>

              {/* 右栏：采购信息 */}
              <Col span={16}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <Text strong style={{ fontSize: 14 }}>采购信息</Text>
                  <Button size="small" icon={<EditOutlined />} onClick={handleEdit}>
                    编辑
                  </Button>
                </div>
                <Row gutter={16}>
                  <Col span={14}>
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
                          {data.purchase_url.length > 30
                            ? `${data.purchase_url.substring(0, 30)}...`
                            : data.purchase_url}
                        </a>
                      ) : (
                        <Text>-</Text>
                      )}
                    </div>
                    <div>
                      <Text type="secondary">备注: </Text>
                      <Text>{data.purchase_note || '-'}</Text>
                    </div>
                  </Col>
                  <Col span={10}>
                    {data.purchase_url && (
                      <div style={{ textAlign: 'center' }}>
                        <Text type="secondary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                          扫码打开采购链接
                        </Text>
                        <QRCodeSVG value={data.purchase_url} size={100} />
                      </div>
                    )}
                  </Col>
                </Row>
              </Col>
            </Row>
          ) : (
            /* 编辑模式 */
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <Text strong style={{ fontSize: 14 }}>编辑采购信息</Text>
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
              </div>
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
            </div>
          )}
        </Card>
      )}

      {/* 进货价格历史 */}
      <Divider style={{ margin: '16px 0 12px' }} />
      <div style={{ marginBottom: 8 }}>
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
          scroll={{ y: 300 }}
          style={{ marginTop: 8 }}
        />
      )}
    </Modal>
  );
};

export default PurchasePriceHistoryModal;
