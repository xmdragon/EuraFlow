/**
 * OZON 选品助手 - 使用指南组件
 *
 * 提供浏览器扩展安装指南、使用说明和常见问题
 */

import React from 'react';
import {
  Space,
  Card,
  Alert,
  Row,
  Col,
  Button,
  Steps,
  Timeline,
  Collapse,
  Typography,
  Tag,
} from 'antd';
import {
  DownloadOutlined,
  RocketOutlined,
  QuestionCircleOutlined,
} from '@ant-design/icons';

import styles from '@/pages/ozon/ProductSelection.module.scss';

const { Title, Paragraph, Text, Link } = Typography;

/**
 * 使用指南组件
 */
export const ProductSelectionGuide: React.FC = () => {
  return (
    <Space direction="vertical" size="large" className={styles.fullWidthInput}>
      {/* 工具介绍 */}
      <Card>
        <Title level={4}>
          <RocketOutlined /> Ozon选品助手
        </Title>
        <Paragraph>
          智能采集Ozon商品数据的浏览器工具，集成
          <Text strong>上品帮</Text>
          数据源，自动滚动、虚拟列表适配、自动上传到EuraFlow平台。
        </Paragraph>
        <Alert
          message="推荐使用浏览器扩展"
          description="浏览器扩展版本更稳定、功能更强大，支持智能数据融合，推荐优先使用。"
          type="success"
          showIcon
        />
      </Card>

      {/* 浏览器扩展安装 */}
      <Card>
        <Title level={4}>
          <RocketOutlined /> 浏览器扩展安装
        </Title>
        <Space direction="vertical" size="large" className={styles.fullWidthInput}>
          <Alert
            message="✨ 推荐使用"
            description="集成上品帮数据源，自动提取42个字段，更稳定、功能更强大。"
            type="success"
            showIcon
          />

          {/* 功能特性 */}
          <Card title="✨ 核心特性" size="small">
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Alert
                  message="上品帮集成"
                  description="自动从上品帮提取商品数据，包含价格、销量、佣金、物流等42个字段"
                  type="info"
                  showIcon
                />
              </Col>
              <Col span={12}>
                <Alert
                  message="商品详情页增强"
                  description="商品详情页自动显示真实售价、各项费用和利润分析"
                  type="info"
                  showIcon
                />
              </Col>
              <Col span={12}>
                <Alert
                  message="虚拟滚动支持"
                  description="完全适配OZON的虚拟滚动机制，采集更稳定"
                  type="info"
                  showIcon
                />
              </Col>
              <Col span={12}>
                <Alert
                  message="自动上传"
                  description="采集完成后自动上传到EuraFlow，无需手动导出"
                  type="info"
                  showIcon
                />
              </Col>
            </Row>
          </Card>

          {/* 安装步骤 */}
          <Card title="📥 安装步骤" size="small">
            <Steps
              direction="vertical"
              current={-1}
              items={[
                {
                  title: '下载扩展包',
                  description: (
                    <Space direction="vertical">
                      <Button
                        type="primary"
                        icon={<DownloadOutlined />}
                        href="/downloads/euraflow-ozon-selector.zip"
                        download
                      >
                        下载选品助手扩展
                      </Button>
                      <Text type="secondary">版本信息可在扩展管理页面查看</Text>
                    </Space>
                  ),
                },
                {
                  title: '解压文件',
                  description: '将下载的 .zip 文件解压到任意目录',
                },
                {
                  title: '加载扩展',
                  description: (
                    <div>
                      <Paragraph>1. 打开 Chrome/Edge 浏览器</Paragraph>
                      <Paragraph>
                        2. 访问 <Text code>chrome://extensions/</Text>
                        （Edge: <Text code>edge://extensions/</Text>）
                      </Paragraph>
                      <Paragraph>3. 开启右上角的"开发者模式"</Paragraph>
                      <Paragraph>4. 点击"加载已解压的扩展程序"</Paragraph>
                      <Paragraph>
                        5. 选择解压后的 <Text code>dist/</Text> 目录
                      </Paragraph>
                    </div>
                  ),
                },
                {
                  title: '配置API',
                  description: (
                    <div>
                      <Paragraph>点击扩展图标，配置API连接信息：</Paragraph>
                      <Paragraph>
                        <Text strong>API地址：</Text>
                        <Text code>{window.location.origin}</Text>
                      </Paragraph>
                      <Paragraph>
                        <Text strong>API Key：</Text>
                        <Link href="/dashboard/ozon/api-keys">前往获取 →</Link>
                      </Paragraph>
                    </div>
                  ),
                },
              ]}
            />
          </Card>

          {/* 使用方法 */}
          <Card title="🚀 使用方法" size="small">
            <Timeline
              items={[
                {
                  children: '访问 https://www.ozon.ru 并搜索商品',
                  color: 'blue',
                },
                {
                  children: '确保上品帮插件已安装并工作',
                  color: 'blue',
                },
                {
                  children: '页面右上角会出现控制面板',
                  color: 'blue',
                },
                {
                  children: '设置目标采集数量（默认100）',
                  color: 'green',
                },
                {
                  children: '点击"开始采集"按钮',
                  color: 'green',
                },
                {
                  children: '等待自动采集完成',
                  color: 'green',
                },
                {
                  children: '数据自动上传到EuraFlow',
                  color: 'green',
                },
              ]}
            />
          </Card>
        </Space>
      </Card>

      {/* 数据字段说明 */}
      <Card title="📊 采集字段说明">
        <Paragraph>
          选品助手会采集以下<Text strong>42个字段</Text>的商品数据：
        </Paragraph>
        <Row gutter={[8, 8]}>
          {[
            '商品ID',
            '商品名称',
            '商品链接',
            '商品图片',
            '品牌',
            '销售价格',
            '原价',
            '商品评分',
            '评价次数',
            'rFBS各档佣金',
            'FBP各档佣金',
            '月销量',
            '月销售额',
            '日销量',
            '日销售额',
            '包装重量',
            '包装尺寸',
            '商品体积',
            '跟卖者数量',
            '最低跟卖价',
            '成交率',
            '商品可用性',
            '广告费用份额',
            '配送时间',
            '卖家类型',
            '商品创建日期',
          ].map((field) => (
            <Col span={6} key={field}>
              <Tag color="blue">{field}</Tag>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 常见问题 */}
      <Card title="❓ 常见问题">
        <Collapse
          items={[
            {
              key: 'faq-1',
              label: 'Q: API连接测试失败？',
              children: (
                <div>
                  <Paragraph>请检查以下几点：</Paragraph>
                  <ul>
                    <li>API地址是否正确（不要包含 /api 等路径）</li>
                    <li>API Key是否有效（可在API Keys页面重新生成）</li>
                    <li>网络是否通畅（检查VPN或代理设置）</li>
                    <li>浏览器控制台是否有CORS错误</li>
                  </ul>
                </div>
              ),
            },
            {
              key: 'faq-2',
              label: 'Q: 数据采集不完整或没有数据？',
              children: (
                <div>
                  <Paragraph>请确认：</Paragraph>
                  <ul>
                    <li>
                      <Text strong>必须</Text>
                      安装上品帮插件 - 扩展依赖上品帮提供的数据
                    </li>
                    <li>等待时间是否足够 - 默认滚动等待1秒，可在配置中调整</li>
                    <li>检查浏览器控制台是否有错误信息</li>
                    <li>确保在OZON商品列表页面使用（搜索结果或分类页面）</li>
                  </ul>
                </div>
              ),
            },
            {
              key: 'faq-3',
              label: 'Q: 如何查看采集到的数据？',
              children: (
                <Paragraph>
                  数据上传成功后，切换到"商品搜索"标签页即可查看和筛选导入的商品。
                  您也可以在"导入历史"标签页查看每次导入的详细记录。
                </Paragraph>
              ),
            },
            {
              key: 'faq-4',
              label: 'Q: 扩展无法加载或报错？',
              children: (
                <div>
                  <Paragraph>请尝试：</Paragraph>
                  <ul>
                    <li>确认已开启浏览器的"开发者模式"</li>
                    <li>重新加载扩展：移除后重新添加</li>
                    <li>检查是否选择了正确的dist/目录</li>
                    <li>查看浏览器扩展管理页面的错误信息</li>
                  </ul>
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* 技术支持 */}
      <Card>
        <Alert
          message="需要帮助？"
          description={
            <div>
              <Paragraph>如果遇到问题或需要技术支持，请联系管理员或查看项目文档。</Paragraph>
              <Paragraph>
                <Text type="secondary">版本：v1.2.6 | 更新时间：2025-10-29</Text>
              </Paragraph>
            </div>
          }
          type="info"
          showIcon
          icon={<QuestionCircleOutlined />}
        />
      </Card>
    </Space>
  );
};
