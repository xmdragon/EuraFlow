/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
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
import React from 'react';

import * as ozonApi from '../../services/ozonApi';

const { Title, Text } = Typography;

const OzonDashboard: React.FC = () => {
  // 获取店铺列表
  const { data: shops } = useQuery({
    queryKey: ['ozon-shops'],
    queryFn: ozonApi.getShops,
  });

  // 获取商品统计
  useQuery({
    queryKey: ['ozon-products'],
    queryFn: () => ozonApi.getProducts(),
  });

  // 获取订单统计
  useQuery({
    queryKey: ['ozon-orders'],
    queryFn: () => ozonApi.getOrders(1, 50),
  });

  // 模拟数据
  const stats = {
    products: {
      total: 1250,
      active: 1180,
      outOfStock: 45,
      synced: 1200,
    },
    orders: {
      total: 3420,
      pending: 28,
      processing: 156,
      shipped: 89,
      delivered: 3089,
      cancelled: 58,
    },
    revenue: {
      today: 45680,
      week: 234500,
      month: 892340,
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
      <Title level={2} style={{ marginBottom: 24 }}>
        Ozon 管理概览
      </Title>

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
              title="活跃店铺"
              value={shops?.data?.length || 0}
              prefix={<ShoppingOutlined />}
              valueStyle={{ color: '#1890ff' }}
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
