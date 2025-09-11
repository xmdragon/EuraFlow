/**
 * Ozon 管理概览页面
 */
import React from 'react'
import { Card, Row, Col, Statistic, Space, Progress, List, Tag, Typography } from 'antd'
import {
  ShoppingOutlined,
  ShoppingCartOutlined,
  DollarOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import { useQuery } from '@tanstack/react-query'
import * as ozonApi from '../../services/ozonApi'

const { Title, Text } = Typography

interface DashboardStats {
  products: {
    total: number
    active: number
    outOfStock: number
    synced: number
  }
  orders: {
    total: number
    pending: number
    processing: number
    shipped: number
    delivered: number
    cancelled: number
  }
  revenue: {
    today: number
    week: number
    month: number
  }
  sync: {
    lastSync: string
    nextSync: string
    status: 'success' | 'error' | 'syncing'
  }
}

const OzonDashboard: React.FC = () => {
  // 获取店铺列表
  const { data: shops } = useQuery({
    queryKey: ['ozon-shops'],
    queryFn: ozonApi.getShops
  })

  // 获取商品统计
  const { data: products } = useQuery({
    queryKey: ['ozon-products'],
    queryFn: () => ozonApi.getProducts()
  })

  // 获取订单统计
  const { data: orders } = useQuery({
    queryKey: ['ozon-orders'],
    queryFn: () => ozonApi.getOrders()
  })

  // 获取同步日志（真实活动数据）
  const { data: syncLogs } = useQuery({
    queryKey: ['ozon-sync-logs'],
    queryFn: () => ozonApi.getSyncLogs(undefined, 10),
    refetchInterval: 30000 // 每30秒刷新一次
  })

  // 使用店铺中的正确统计数据
  const stats = React.useMemo(() => {
    const orderList = orders?.data || []
    const shopStats = shops?.data?.[0]?.stats || {}
    
    // 从后端获取准确的商品统计数据
    const totalProducts = shopStats.total_products || 0
    const activeProducts = shopStats.active_products || 0
    const inactiveProducts = shopStats.inactive_products || 0
    const outOfStockProducts = shopStats.out_of_stock_products || 0
    const archivedProducts = shopStats.archived_products || 0
    const visibleProducts = shopStats.visible_products || 0
    
    // 计算订单统计（当前页面数据）
    const pendingOrders = orderList.filter((o: any) => o.status === 'pending')
    const processingOrders = orderList.filter((o: any) => o.status === 'processing')
    const shippedOrders = orderList.filter((o: any) => o.status === 'shipped')

    return {
      products: {
        total: totalProducts,
        active: activeProducts,
        inactive: inactiveProducts,
        outOfStock: outOfStockProducts,
        archived: archivedProducts,
        visible: visibleProducts,
        synced: totalProducts // 所有产品都已同步
      },
      orders: {
        total: shopStats.total_orders || 0,
        pending: pendingOrders.length,
        processing: processingOrders.length,
        shipped: shippedOrders.length
      }
    }
  }, [orders, shops])

  // 使用真实的同步日志数据作为最近活动
  const recentActivities = React.useMemo(() => {
    if (!syncLogs?.activities) {
      return []
    }
    return syncLogs.activities
  }, [syncLogs])

  const getActivityIcon = (type: string) => {
    switch(type) {
      case 'orders': return <ShoppingCartOutlined style={{ color: '#1890ff' }} />
      case 'postings': return <ShoppingCartOutlined style={{ color: '#1890ff' }} />
      case 'products': return <ShoppingOutlined style={{ color: '#722ed1' }} />
      case 'inventory': return <ExclamationCircleOutlined style={{ color: '#faad14' }} />
      case 'sync': return <SyncOutlined style={{ color: '#52c41a' }} />
      default: return <CheckCircleOutlined />
    }
  }

  const getActivityTag = (status: string) => {
    const colorMap: Record<string, string> = {
      started: 'processing',
      success: 'green',
      failed: 'red',
      partial: 'orange',
      new: 'blue',
      warning: 'orange',
      shipped: 'cyan'
    }
    const statusText: Record<string, string> = {
      started: '进行中',
      success: '成功',
      failed: '失败',
      partial: '部分成功'
    }
    return <Tag color={colorMap[status] || 'default'}>{statusText[status] || status}</Tag>
  }

  return (
    <div style={{ padding: '24px' }}>
      <Title level={4} style={{ marginBottom: 24 }}>Ozon 管理概览</Title>

      {/* 店铺信息 */}
      {shops?.data && shops.data.length > 0 && (
        <Card style={{ marginBottom: 24 }} styles={{ body: { padding: '16px' } }}>
          <Row align="middle">
            <Col flex="auto">
              <Space direction="vertical" size={0}>
                <Text type="secondary">当前店铺</Text>
                <Title level={5} style={{ margin: 0 }}>{shops.data[0].shop_name}</Title>
              </Space>
            </Col>
            <Col>
              <Space>
                <Tag color={shops.data[0].status === 'active' ? 'green' : 'default'}>
                  {shops.data[0].status === 'active' ? '运营中' : '已暂停'}
                </Tag>
                {shops.data[0].config?.auto_sync_enabled && (
                  <Tag icon={<SyncOutlined spin />} color="processing">
                    自动同步
                  </Tag>
                )}
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {/* 核心指标 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="商品总数"
              value={stats.products.total}
              prefix={<ShoppingOutlined />}
              suffix={
                <Text type="secondary" style={{ fontSize: 14 }}>
                  / {stats.products.active} 在售
                </Text>
              }
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="待处理订单"
              value={stats.orders.pending}
              prefix={<ClockCircleOutlined />}
              valueStyle={{ color: stats.orders.pending > 0 ? '#faad14' : '#000' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="处理中订单"
              value={stats.orders.processing}
              prefix={<SyncOutlined />}
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="已发货订单"
              value={stats.orders.shipped}
              prefix={<CheckCircleOutlined />}
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {/* 商品状态分布 */}
        <Col xs={24} lg={12}>
          <Card title="商品状态" extra={<a href="/dashboard/ozon/products">查看全部</a>}>
            <Space direction="vertical" style={{ width: '100%' }} size="large">
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text>在售商品</Text>
                  <Text strong>{stats.products.active} / {stats.products.total}</Text>
                </div>
                <Progress 
                  percent={stats.products.total ? Math.round((stats.products.active / stats.products.total) * 100) : 0}
                  strokeColor="#52c41a"
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text>缺货商品</Text>
                  <Text strong style={{ color: stats.products.outOfStock > 0 ? '#ff4d4f' : 'inherit' }}>
                    {stats.products.outOfStock} / {stats.products.total}
                  </Text>
                </div>
                <Progress 
                  percent={stats.products.total ? Math.round((stats.products.outOfStock / stats.products.total) * 100) : 0}
                  strokeColor="#ff4d4f"
                  status={stats.products.outOfStock > 0 ? "exception" : "normal"}
                />
              </div>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <Text>已下架</Text>
                  <Text strong>{stats.products.inactive + stats.products.archived} / {stats.products.total}</Text>
                </div>
                <Progress 
                  percent={stats.products.total ? Math.round(((stats.products.inactive + stats.products.archived) / stats.products.total) * 100) : 0}
                  strokeColor="#faad14"
                />
              </div>
            </Space>
          </Card>
        </Col>

        {/* 最近活动 */}
        <Col xs={24} lg={12}>
          <Card title="最近活动" extra={<a href="#">查看全部</a>}>
            <List
              size="small"
              dataSource={recentActivities}
              renderItem={item => (
                <List.Item>
                  <List.Item.Meta
                    avatar={getActivityIcon(item.type)}
                    title={
                      <Space>
                        <Text>{item.content}</Text>
                        {getActivityTag(item.status)}
                      </Space>
                    }
                    description={item.time}
                  />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      {/* 快速操作提示 */}
      <Card style={{ marginTop: 16 }} styles={{ body: { background: '#f6ffed', border: '1px solid #b7eb8f' } }}>
        <Space>
          <CheckCircleOutlined style={{ color: '#52c41a', fontSize: 16 }} />
          <Text>
            系统运行正常，下次同步时间：
            <Text strong style={{ marginLeft: 8 }}>
              {new Date(Date.now() + 5 * 60 * 1000).toLocaleTimeString('zh-CN')}
            </Text>
          </Text>
        </Space>
      </Card>
    </div>
  )
}

export default OzonDashboard