/**
 * Ozon 管理概览页面
 */
import {
  ShoppingOutlined,
  ShoppingCartOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
} from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Card, Row, Col, Statistic, Space, Progress, List, Tag, Typography } from 'antd';
import React, { useState } from 'react';

import * as ozonApi from '../../services/ozonApi';
import ShopSelector from '../../components/ozon/ShopSelector';

const { Title, Text } = Typography;

const OzonDashboard: React.FC = () => {
  const [selectedShop, setSelectedShop] = useState<number | null>(null);

  // 获取店铺列表
  const { data: shops } = useQuery({
    queryKey: ['ozon-shops'],
    queryFn: ozonApi.getShops,
  });

  // 获取商品统计（根据选中的店铺）
  const { data: productsData } = useQuery({
    queryKey: ['ozon-products', selectedShop],
    queryFn: () => ozonApi.getProducts(1, 50, { shop_id: selectedShop }),
    enabled: shops?.data?.length > 0,
  });

  // 获取订单统计（根据选中的店铺）
  const { data: ordersData } = useQuery({
    queryKey: ['ozon-orders', selectedShop],
    queryFn: () => ozonApi.getOrders(1, 50, { shop_id: selectedShop }),
    enabled: shops?.data?.length > 0,
  });

  // 获取统计数据（根据选中的店铺）
  const { data: statisticsData } = useQuery({
    queryKey: ['ozon-statistics', selectedShop],
    queryFn: () => ozonApi.getStatistics(selectedShop),
    enabled: shops?.data?.length > 0,
  });

  // 使用真实数据或模拟数据
  const stats = {
    products: {
      total: productsData?.data?.length || statisticsData?.data?.products?.total || 0,
      active: statisticsData?.data?.products?.active ||
        productsData?.data?.filter((p: any) => p.status === 'active').length || 0,
      outOfStock: statisticsData?.data?.products?.out_of_stock ||
        productsData?.data?.filter((p: any) => p.stock === 0).length || 0,
      synced: statisticsData?.data?.products?.synced ||
        productsData?.data?.filter((p: any) => p.sync_status === 'success').length || 0,
    },
    orders: {
      total: ordersData?.data?.length || statisticsData?.data?.orders?.total || 0,
      pending: statisticsData?.data?.orders?.pending ||
        ordersData?.data?.filter((o: any) => o.status === 'pending').length || 0,
      processing: statisticsData?.data?.orders?.processing ||
        ordersData?.data?.filter((o: any) => o.status === 'processing').length || 0,
      shipped: statisticsData?.data?.orders?.shipped ||
        ordersData?.data?.filter((o: any) => o.status === 'shipped').length || 0,
      delivered: statisticsData?.data?.orders?.delivered ||
        ordersData?.data?.filter((o: any) => o.status === 'delivered').length || 0,
      cancelled: statisticsData?.data?.orders?.cancelled ||
        ordersData?.data?.filter((o: any) => o.status === 'cancelled').length || 0,
    },
    revenue: {
      today: statisticsData?.data?.revenue?.today || 0,
      week: statisticsData?.data?.revenue?.week || 0,
      month: statisticsData?.data?.revenue?.month || 0,
    },
  };

  const syncHistory = [
    { time: '2024-01-15 14:30:00', type: '商品同步', status: 'success' as const },
    { time: '2024-01-15 14:25:00', type: '订单同步', status: 'success' as const },
    { time: '2024-01-15 14:20:00', type: '价格同步', status: 'error' as const },
    { time: '2024-01-15 14:15:00', type: '库存同步', status: 'success' as const },
  ];

  const getStatusIcon = (status: 'success' | 'error' | 'syncing') => {
    switch (status) {
      case 'success':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
      case 'error':
        return <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />;
      case 'syncing':
        return <SyncOutlined spin style={{ color: '#1890ff' }} />;
      default:
        return <ClockCircleOutlined style={{ color: '#d9d9d9' }} />;
    }
  };

  const getStatusColor = (status: 'success' | 'error' | 'syncing') => {
    switch (status) {
      case 'success':
        return 'success';
      case 'error':
        return 'error';
      case 'syncing':
        return 'processing';
      default:
        return 'default';
    }
  };

  return (
    <div style={{ padding: 24, background: '#f0f2f5', minHeight: '100vh' }}>
      <Row style={{ marginBottom: 24 }} align="middle" justify="space-between">
        <Col>
          <Title level={2} style={{ marginBottom: 0 }}>
            Ozon 管理概览
          </Title>
        </Col>
        <Col>
          <ShopSelector
            value={selectedShop}
            onChange={setSelectedShop}
            showAllOption={true}
            style={{ minWidth: 200 }}
          />
        </Col>
      </Row>

      {/* 概览统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="总商品数"
              value={stats.products.total}
              prefix={<ShoppingOutlined />}
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="待处理订单"
              value={stats.orders.pending}
              prefix={<ShoppingCartOutlined />}
              valueStyle={{ color: '#cf1322' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title="今日销售额"
              value={stats.revenue.today}
              precision={2}
              prefix="¥"
              valueStyle={{ color: '#3f8600' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card>
            <Statistic
              title={selectedShop ? "当前店铺" : "活跃店铺"}
              value={
                selectedShop
                  ? shops?.data?.find((s: any) => s.id === selectedShop)?.shop_name || '-'
                  : shops?.data?.length || 0
              }
              prefix={selectedShop ? null : <ShoppingOutlined />}
              valueStyle={{ color: '#1890ff' }}
              valueRender={(value) =>
                typeof value === 'string' && isNaN(Number(value)) ? (
                  <Text style={{ color: '#1890ff', fontSize: 20, fontWeight: 600 }}>
                    {value}
                  </Text>
                ) : (
                  value
                )
              }
            />
          </Card>
        </Col>
      </Row>

      {/* 详细统计 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="商品统计" extra={<SyncOutlined />}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>活跃商品:</Text>
                <Text strong>{stats.products.active}</Text>
              </div>
              <Progress
                percent={Math.round((stats.products.active / stats.products.total) * 100)}
                status="success"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>缺货商品:</Text>
                <Text type="warning">{stats.products.outOfStock}</Text>
              </div>
              <Progress
                percent={Math.round((stats.products.outOfStock / stats.products.total) * 100)}
                status="exception"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text>已同步商品:</Text>
                <Text type="success">{stats.products.synced}</Text>
              </div>
              <Progress
                percent={Math.round((stats.products.synced / stats.products.total) * 100)}
                status="success"
              />
            </Space>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title="订单统计" extra={<ShoppingCartOutlined />}>
            <Row gutter={16}>
              <Col span={12}>
                <Statistic title="处理中" value={stats.orders.processing} />
              </Col>
              <Col span={12}>
                <Statistic title="已发货" value={stats.orders.shipped} />
              </Col>
              <Col span={12} style={{ marginTop: 16 }}>
                <Statistic
                  title="已完成"
                  value={stats.orders.delivered}
                  valueStyle={{ color: '#3f8600' }}
                />
              </Col>
              <Col span={12} style={{ marginTop: 16 }}>
                <Statistic
                  title="已取消"
                  value={stats.orders.cancelled}
                  valueStyle={{ color: '#cf1322' }}
                />
              </Col>
            </Row>
          </Card>
        </Col>
      </Row>

      {/* 同步历史 */}
      <Card title="同步历史" extra={<SyncOutlined />}>
        <List
          itemLayout="horizontal"
          dataSource={syncHistory}
          renderItem={(item) => (
            <List.Item>
              <List.Item.Meta
                avatar={getStatusIcon(item.status)}
                title={
                  <Space>
                    <Text>{item.type}</Text>
                    <Tag color={getStatusColor(item.status)}>
                      {item.status === 'success' ? '成功' : '失败'}
                    </Tag>
                  </Space>
                }
                description={item.time}
              />
            </List.Item>
          )}
        />
      </Card>
    </div>
  );
};

export default OzonDashboard;
