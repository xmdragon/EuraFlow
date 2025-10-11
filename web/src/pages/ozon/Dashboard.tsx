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
import styles from './Dashboard.module.scss';

const { Title, Text } = Typography;

const OzonDashboard: React.FC = () => {
  // 初始化为 null 表示"全部店铺"
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

  // 等待ShopSelector完成初始化后再请求数据
  // 允许 debouncedShop 为 null（表示全部店铺）
  const shouldFetchData = !!shops?.data?.length && debouncedShop !== undefined;


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
        return <CheckCircleOutlined className={styles.statusSuccess} />;
      case 'error':
        return <ExclamationCircleOutlined className={styles.statusError} />;
      case 'syncing':
        return <SyncOutlined spin className={styles.statusSyncing} />;
      default:
        return <ClockCircleOutlined className={styles.statusDefault} />;
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
    <div className={styles.pageContainer}>
      <Row className={styles.titleRow} align="middle" justify="space-between">
        <Col>
          <Title level={2} className={styles.pageTitle}>
            Ozon 管理概览
          </Title>
        </Col>
        <Col>
          <ShopSelector
            value={selectedShop}
            onChange={handleShopChange}
            showAllOption={true}
            className={styles.shopSelector}
          />
        </Col>
      </Row>

      {/* 概览统计 */}
      <Row gutter={[8, 8]} className={styles.statsRow}>
        <Col xs={24} sm={12} md={6}>
          <Card className={styles.statSuccess}>
            <Statistic
              title="总商品数"
              value={stats.products.total}
              prefix={<ShoppingOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className={styles.statError}>
            <Statistic
              title="待处理订单"
              value={stats.orders.pending}
              prefix={<ShoppingCartOutlined />}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className={styles.statSuccess}>
            <Statistic
              title="今日销售额"
              value={stats.revenue.today}
              precision={2}
              prefix="¥"
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} md={6}>
          <Card className={styles.statInfo}>
            <Statistic
              title={selectedShop ? "当前店铺" : "活跃店铺"}
              value={
                selectedShop
                  ? shops?.data?.find((s: any) => s.id === selectedShop)?.shop_name || '-'
                  : shops?.data?.length || 0
              }
              prefix={selectedShop ? null : <ShoppingOutlined />}
              valueRender={(value) =>
                typeof value === 'string' && isNaN(Number(value)) ? (
                  <Text className={styles.shopNameValue}>
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
      <Row gutter={[8, 8]} className={styles.detailRow}>
        <Col xs={24} lg={12}>
          <Card title="商品统计" extra={<SyncOutlined />}>
            <Space direction="vertical" className={styles.productStatsContent}>
              <div className={styles.statRow}>
                <Text>活跃商品:</Text>
                <Text strong>{stats.products.active}</Text>
              </div>
              <Progress
                percent={Math.round((stats.products.active / stats.products.total) * 100)}
                status="success"
              />
              <div className={styles.statRow}>
                <Text>缺货商品:</Text>
                <Text type="warning">{stats.products.outOfStock}</Text>
              </div>
              <Progress
                percent={Math.round((stats.products.outOfStock / stats.products.total) * 100)}
                status="exception"
              />
              <div className={styles.statRow}>
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
              <Col span={12} className={styles.orderStatCol}>
                <Card className={styles.orderStatDelivered}>
                  <Statistic
                    title="已完成"
                    value={stats.orders.delivered}
                  />
                </Card>
              </Col>
              <Col span={12} className={styles.orderStatCol}>
                <Card className={styles.orderStatCancelled}>
                  <Statistic
                    title="已取消"
                    value={stats.orders.cancelled}
                  />
                </Card>
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
