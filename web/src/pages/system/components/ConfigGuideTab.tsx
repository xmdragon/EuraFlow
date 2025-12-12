/**
 * 配置说明Tab
 * 提供各类配置的获取方法和说明
 */
import { Typography, Card, Collapse, Alert } from 'antd';
import React from 'react';

import { useAuth } from '@/hooks/useAuth';

const { Title, Paragraph, Text, Link } = Typography;
const { Panel } = Collapse;

const ConfigGuideTab: React.FC = () => {
  const { user } = useAuth();
  const isMainAccount = user?.role === 'main_account';

  return (
    <div>
      <Alert
        message="配置说明"
        description="本页面提供各项配置的获取方法、使用说明和常见问题解答"
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Collapse defaultActiveKey={['ozon']} accordion>
        {/* OZON店铺配置 */}
        <Panel header="📦 OZON店铺配置" key="ozon">
          <Title level={5}>如何获取OZON API凭据？</Title>
          <Paragraph>
            <ol>
              <li>登录 <Link href="https://seller.ozon.ru" target="_blank">OZON Seller后台</Link></li>
              <li>进入"设置" → "API密钥"</li>
              <li>点击"生成密钥"，设置权限范围</li>
              <li>复制 <Text strong>Client ID</Text> 和 <Text strong>API Key</Text></li>
              <li>在系统配置中填入凭据并测试连接</li>
            </ol>
          </Paragraph>

          <Title level={5}>安全提示</Title>
          <Paragraph>
            <ul>
              <li>API Key保存后将显示为掩码，请妥善保管原始密钥</li>
              <li>定期检查API密钥使用记录，发现异常立即重新生成</li>
              <li>不同店铺使用独立的API密钥，避免交叉影响</li>
            </ul>
          </Paragraph>
        </Panel>

        {/* Cloudinary配置 - 仅管理员可见 */}
        {!isMainAccount && (
          <Panel header="🖼️ Cloudinary图床配置" key="cloudinary">
          <Title level={5}>如何获取Cloudinary凭据？</Title>
          <Paragraph>
            <ol>
              <li>访问 <Link href="https://cloudinary.com" target="_blank">Cloudinary官网</Link> 注册账号</li>
              <li>进入Dashboard，查看"Account Details"</li>
              <li>复制 <Text strong>Cloud Name</Text>、<Text strong>API Key</Text> 和 <Text strong>API Secret</Text></li>
              <li>在系统配置中填入凭据</li>
            </ol>
          </Paragraph>

          <Title level={5}>免费额度</Title>
          <Paragraph>
            <ul>
              <li>25 GB存储空间</li>
              <li>25 GB月度带宽</li>
              <li>25,000 次图片变换</li>
            </ul>
          </Paragraph>

          <Title level={5}>使用说明</Title>
          <Paragraph>
            <ul>
              <li>文件夹前缀：推荐使用"euraflow"或店铺名称，方便管理</li>
              <li>自动清理：系统会定期清理N天前的临时文件</li>
              <li>连接测试：确保API凭据正确且网络畅通</li>
            </ul>
          </Paragraph>
        </Panel>
        )}

        {/* 汇率API配置 - 仅管理员可见 */}
        {!isMainAccount && (
          <Panel header="💱 汇率API配置" key="exchange-rate">
          <Title level={5}>如何获取汇率API Key？</Title>
          <Paragraph>
            <ol>
              <li>访问 <Link href="https://www.exchangerate-api.com" target="_blank">ExchangeRate-API</Link></li>
              <li>注册免费账号（免费额度：1500次/月）</li>
              <li>登录后复制 API Key</li>
              <li>在系统配置中填入API Key</li>
            </ol>
          </Paragraph>

          <Title level={5}>使用说明</Title>
          <Paragraph>
            <ul>
              <li>系统每小时自动刷新一次汇率</li>
              <li>可手动刷新获取最新汇率</li>
              <li>汇率数据缓存24小时</li>
              <li>用于选品助手、财务计算等功能</li>
            </ul>
          </Paragraph>
        </Panel>
        )}

        {/* API密钥管理 - 所有角色可见 */}
        <Panel header="🔑 API密钥管理" key="api-keys">
          <Title level={5}>API密钥用途</Title>
          <Paragraph>
            API密钥用于浏览器扩展插件等外部工具访问系统，主要用于OZON选品助手功能。
          </Paragraph>

          <Title level={5}>创建步骤</Title>
          <Paragraph>
            <ol>
              <li>在API密钥Tab点击"创建API Key"</li>
              <li>设置密钥名称和过期时间</li>
              <li>立即复制生成的密钥（仅显示一次）</li>
              <li>在浏览器扩展插件的设置界面中配置API地址和密钥</li>
            </ol>
          </Paragraph>

          <Title level={5}>安全建议</Title>
          <Paragraph>
            <ul>
              <li>为不同工具创建独立的API密钥</li>
              <li>定期检查并删除不再使用的密钥</li>
              <li>发现密钥泄露立即删除或重新生成</li>
              <li>设置合理的过期时间（建议90-180天）</li>
            </ul>
          </Paragraph>
        </Panel>

        {/* 常见问题 - 仅管理员可见 */}
        {!isMainAccount && (
          <Panel header="❓ 常见问题" key="faq">
          <Title level={5}>配置保存失败怎么办？</Title>
          <Paragraph>
            <ul>
              <li>检查网络连接是否正常</li>
              <li>确认所有必填项已填写</li>
              <li>测试API凭据是否正确</li>
              <li>查看浏览器控制台错误信息</li>
            </ul>
          </Paragraph>

          <Title level={5}>测试连接失败怎么办？</Title>
          <Paragraph>
            <ul>
              <li>确认API凭据输入正确</li>
              <li>检查服务商API状态（可能维护中）</li>
              <li>确认服务器网络可访问外部服务</li>
              <li>查看详细错误信息排查问题</li>
            </ul>
          </Paragraph>

          <Title level={5}>配置修改后何时生效？</Title>
          <Paragraph>
            大部分配置保存后立即生效。部分配置（如汇率）需等待下次自动刷新，也可手动刷新立即生效。
          </Paragraph>
        </Panel>
        )}
      </Collapse>

      <Card style={{ marginTop: 24 }}>
        <Title level={5}>需要帮助？</Title>
        <Paragraph>
          如有任何问题或需要技术支持，请联系系统管理员或查阅详细文档。
        </Paragraph>
      </Card>
    </div>
  );
};

export default ConfigGuideTab;
