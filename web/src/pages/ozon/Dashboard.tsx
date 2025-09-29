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
import React, { useState, useEffect, useCallback } from 'react';

import * as ozonApi from '../../services/ozonApi';
import ShopSelector from '../../components/ozon/ShopSelector';

const { Title, Text } = Typography;

const OzonDashboard: React.FC = () => {
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [debouncedShop, setDebouncedShop] = useState<number | null>(null);

  // 防抖处理，避免快速切换店铺时的大量请求
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedShop(selectedShop);
    }, 300);

    return () => clearTimeout(timer);
  }, [selectedShop]);

  // 优化店铺选择处理函数
  const handleShopChange = useCallback((shopId: number | number[] | null) => {
    const normalized = Array.isArray(shopId) ? (shopId[0] ?? null) : (shopId ?? null);
    setSelectedShop(normalized);
  }, []);

  // 获取店铺列表（与ShopSelector共享查询）
  const { data: shops } = useQuery({
    queryKey: ['ozon', 'shops'],
    queryFn: ozonApi.getShops,
    staleTime: 5 * 60 * 1000, // 5分钟内不重新请求
    gcTime: 10 * 60 * 1000, // 10分钟后清理缓存
  });

  // 等待ShopSelector完成初始化且获取到具体店铺ID后再请求数据
  // 完全避免shop_id=null的请求，除非用户明确选择了"全部店铺"
  const shouldFetchData = !!shops?.data?.length && debouncedShop !== undefined &&
    debouncedShop !== null;


  // 获取统计数据（使用防抖后的店铺ID）
  const { data: statisticsData } = useQuery({
    queryKey: ['ozon', 'statistics', debouncedShop],
    queryFn: () => ozonApi.getStatistics(debouncedShop),
    enabled: shouldFetchData,
    staleTime: 1 * 60 * 1000, // 1分钟内不重新请求
  });

  // 使用statistics API数据
  const stats = {
    products: {
      total: statisticsData?.products?.total || 0,
      active: statisticsData?.products?.active || 0,
      outOfStock: statisticsData?.products?.out_of_stock || 0,
      synced: statisticsData?.products?.synced || 0,
    },
    orders: {
      total: statisticsData?.orders?.total || 0,
      pending: statisticsData?.orders?.pending || 0,
      processing: statisticsData?.orders?.processing || 0,
      shipped: statisticsData?.orders?.shipped || 0,
      delivered: statisticsData?.orders?.delivered || 0,
      cancelled: statisticsData?.orders?.cancelled || 0,
    },
    revenue: {
      today: statisticsData?.revenue?.today || 0,
      week: statisticsData?.revenue?.week || 0,
      month: statisticsData?.revenue?.month || 0,
    },
  };

  // 同步历史数据应该从API获取，暂时使用空数组
  const syncHistory: Array<{ time: string; type: string; status: 'success' | 'error' | 'syncing' }> = [];

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
            onChange={handleShopChange}
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

      {/* 同步历史 - 当有数据时才显示 */}
      {syncHistory.length > 0 && (
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
      )}
    </div>
  );
};

export default OzonDashboard;
