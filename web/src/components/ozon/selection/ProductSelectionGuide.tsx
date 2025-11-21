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
          在OZON商品详情页自动显示真实售价、跟卖价、利润分析，帮助您快速评估商品价值。
        </Paragraph>
        <Alert
          message="推荐使用浏览器扩展"
          description="浏览器扩展版本提供详情页增强功能，自动计算各项费用和利润，支持一键跟卖和采集。"
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
            description="商品详情页自动显示真实售价、跟卖价和利润分析，帮助您快速做出选品决策。"
            type="success"
            showIcon
          />

          {/* 功能特性 */}
          <Card title="✨ 核心特性" size="small">
            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Alert
                  message="真实售价计算"
                  description="自动计算扣除各项费用后的真实售价，包括佣金、FBS费、物流费等"
                  type="info"
                  showIcon
                />
              </Col>
              <Col span={12}>
                <Alert
                  message="跟卖数据显示"
                  description="自动获取并显示跟卖数量和最低跟卖价，帮助评估竞争情况"
                  type="info"
                  showIcon
                />
              </Col>
              <Col span={12}>
                <Alert
                  message="销售数据展示"
                  description="集成上品帮数据，显示月销量、浏览量、成交率等关键指标"
                  type="info"
                  showIcon
                />
              </Col>
              <Col span={12}>
                <Alert
                  message="一键操作"
                  description="支持一键跟卖上架或采集商品信息，快速完成选品流程"
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
                  children: '访问 OZON 商品详情页（例如：https://www.ozon.ru/product/xxx）',
                  color: 'blue',
                },
                {
                  children: '页面右侧自动显示真实售价和数据面板',
                  color: 'blue',
                },
                {
                  children: '查看真实售价、跟卖价、销售数据等关键信息',
                  color: 'green',
                },
                {
                  children: '点击"跟卖"按钮快速配置并上架商品',
                  color: 'green',
                },
                {
                  children: '或点击"采集"按钮保存商品信息到采集记录',
                  color: 'green',
                },
              ]}
            />
          </Card>
        </Space>
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
              label: 'Q: 真实售价或销售数据没有显示？',
              children: (
                <div>
                  <Paragraph>请确认：</Paragraph>
                  <ul>
                    <li>确保在OZON商品详情页面（URL包含 /product/）</li>
                    <li>页面加载完成后，数据面板会在右侧自动显示</li>
                    <li>部分销售数据依赖上品帮数据源，如果没有数据会显示"---"</li>
                    <li>检查浏览器控制台是否有错误信息</li>
                  </ul>
                </div>
              ),
            },
            {
              key: 'faq-3',
              label: 'Q: 如何查看采集的商品？',
              children: (
                <Paragraph>
                  点击"采集"按钮后，商品信息会保存到"采集记录"。
                  您可以在采集记录页面查看、编辑或批量转为草稿进行上架。
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
                <Text type="secondary">版本：v1.9.0 | 更新时间：2025-11-21</Text>
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
