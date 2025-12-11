import { MobileOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons';
import { Form, Input, Button, Alert, Typography, Space, Spin, Checkbox, Modal } from 'antd';
import SliderCaptcha from 'rc-slider-captcha';
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import authService from '@/services/authService';

const { Title } = Typography;

// 隐私协议内容
const PRIVACY_CONTENT = `
# 隐私协议

## 1. 信息收集
我们收集您在使用本服务时提供的信息，包括但不限于：
- 账号信息：手机号码、用户名
- 使用数据：登录时间、操作日志

## 2. 信息使用
我们使用收集的信息用于：
- 提供、维护和改进我们的服务
- 处理您的请求和交易
- 发送服务相关的通知

## 3. 信息保护
我们采取适当的技术和组织措施来保护您的个人信息安全。

## 4. 信息共享
我们不会向第三方出售您的个人信息。

## 5. 联系我们
如有任何问题，请联系我们的客服团队。

最后更新日期：2025年1月
`;

// 服务协议内容
const SERVICE_CONTENT = `
# 服务协议

## 1. 服务说明
本平台为跨境电商管理服务平台，提供订单管理、商品管理、物流跟踪等功能。

## 2. 用户责任
- 您应确保提供的信息真实、准确
- 您应妥善保管账号密码，不得转借他人使用
- 您应遵守相关法律法规和平台规则

## 3. 服务变更
我们保留随时修改或中断服务的权利，恕不另行通知。

## 4. 免责声明
- 因不可抗力导致的服务中断，我们不承担责任
- 因第三方服务（如物流、支付）导致的问题，我们不承担责任

## 5. 知识产权
本平台的所有内容均受知识产权法保护，未经授权不得使用。

## 6. 争议解决
因本协议引起的争议，双方应友好协商解决。

最后更新日期：2025年1月
`;

interface CaptchaData {
  captcha_id: string;
  bg_url: string;
  puzzle_url: string;
  y: number;
}

interface RegisterFormValues {
  phone: string;
  password: string;
  confirmPassword: string;
}

const RegisterPage: React.FC = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const captchaRef = useRef<{ captchaId?: string }>({});
  const [captchaKey, setCaptchaKey] = useState(0);
  const [puzzleY, setPuzzleY] = useState(0);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [privacyModalVisible, setPrivacyModalVisible] = useState(false);
  const [serviceModalVisible, setServiceModalVisible] = useState(false);

  // 请求验证码
  const requestCaptcha = useCallback(async (): Promise<{
    bgUrl: string;
    puzzleUrl: string;
    y: number;
  }> => {
    const response = await authService.getCaptcha();
    const data = response as CaptchaData;
    captchaRef.current.captchaId = data.captcha_id;
    setPuzzleY(data.y);
    return {
      bgUrl: data.bg_url,
      puzzleUrl: data.puzzle_url,
      y: data.y,
    };
  }, []);

  // 验证滑块位置
  const verifyCaptcha = useCallback(
    async (data: { x: number; y: number; sliderOffsetX: number; duration: number; trail: number[][] }) => {
      const captchaId = captchaRef.current?.captchaId;
      if (!captchaId) {
        return Promise.reject('验证码ID不存在');
      }

      const response = await authService.verifyCaptcha({
        captcha_id: captchaId,
        x: Math.round(data.x),
        duration: data.duration,
        trail: data.trail,
      });

      if (response.success && response.token) {
        setCaptchaToken(response.token);
        setCaptchaVerified(true);
        return Promise.resolve();
      } else {
        return Promise.reject(response.message || '验证失败');
      }
    },
    []
  );

  // 重置验证码
  const resetCaptcha = useCallback(() => {
    setCaptchaToken(null);
    setCaptchaVerified(false);
    setCaptchaKey((prev) => prev + 1);
  }, []);

  const handleRegister = async (values: RegisterFormValues) => {
    if (!captchaToken) {
      setError('请先完成滑块验证');
      return;
    }

    if (values.password !== values.confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await authService.register({
        phone: values.phone,
        password: values.password,
        captcha_token: captchaToken,
      });
      // 注册成功后刷新用户信息并跳转到首页
      await refreshUser();
      navigate('/dashboard');
    } catch (err: unknown) {
      const error = err as {
        response?: {
          data?: {
            error?: {
              detail?: { code?: string; message?: string };
            };
          };
        };
        message?: string;
      };
      const errorDetail = error.response?.data?.error?.detail;
      let errorMessage = '注册失败';

      if (errorDetail?.code === 'PHONE_EXISTS') {
        errorMessage = '该手机号已被注册';
      } else if (errorDetail?.code === 'CAPTCHA_REQUIRED' || errorDetail?.code === 'CAPTCHA_INVALID') {
        errorMessage = '验证码已过期，请重新验证';
        resetCaptcha();
      } else if (errorDetail?.code === 'INVALID_PHONE') {
        errorMessage = '手机号格式不正确';
      } else if (errorDetail?.code === 'WEAK_PASSWORD') {
        errorMessage = '密码强度不够，请使用更复杂的密码';
      } else if (errorDetail?.message) {
        errorMessage = errorDetail.message;
      } else if (error.message) {
        errorMessage = error.message;
      }

      setError(errorMessage);
      resetCaptcha();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-form">
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          <div style={{ textAlign: 'center' }}>
            <Title level={2} style={{ color: '#1890ff', marginBottom: 8 }}>
              EuraFlow
            </Title>
            <Typography.Text type="secondary">注册新账号</Typography.Text>
          </div>

          {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

          <Form name="register" onFinish={handleRegister} size="large" autoComplete="off">
            <Form.Item
              name="phone"
              rules={[
                { required: true, message: '请输入手机号' },
                { pattern: /^1\d{10}$/, message: '请输入有效的手机号' },
              ]}
            >
              <Input prefix={<MobileOutlined />} placeholder="手机号" maxLength={11} />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '密码至少6个字符' },
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="new-password" />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: '请确认密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) {
                      return Promise.resolve();
                    }
                    return Promise.reject(new Error('两次输入的密码不一致'));
                  },
                }),
              ]}
            >
              <Input.Password prefix={<LockOutlined />} placeholder="确认密码" autoComplete="new-password" />
            </Form.Item>

            {/* 滑块验证码 */}
            <Form.Item>
              <div
                style={{
                  border: '1px solid #d9d9d9',
                  borderRadius: 8,
                  padding: 16,
                  background: '#fafafa',
                }}
              >
                {captchaVerified ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      color: '#52c41a',
                    }}
                  >
                    <span>✓ 验证成功</span>
                    <Button type="link" size="small" icon={<ReloadOutlined />} onClick={resetCaptcha}>
                      重新验证
                    </Button>
                  </div>
                ) : (
                  <SliderCaptcha
                    key={captchaKey}
                    mode="embed"
                    bgSize={{ width: 280, height: 160 }}
                    puzzleSize={{ width: 66, height: 66, top: puzzleY }}
                    tipText={{
                      default: '向右滑动完成验证',
                      loading: '加载中...',
                      moving: '请移动到正确位置',
                      verifying: '验证中...',
                      error: '验证失败，请重试',
                    }}
                    request={requestCaptcha}
                    onVerify={verifyCaptcha}
                    loadingBoxProps={{
                      icon: <Spin />,
                      text: '加载中...',
                    }}
                    style={{ width: 280, margin: '0 auto' }}
                  />
                )}
              </div>
            </Form.Item>

            {/* 协议复选框 */}
            <Form.Item>
              <Checkbox checked={agreedToTerms} onChange={(e) => setAgreedToTerms(e.target.checked)}>
                <Typography.Text style={{ fontSize: 13 }}>
                  我已阅读并同意
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: '0 4px' }}
                    onClick={(e) => {
                      e.preventDefault();
                      setPrivacyModalVisible(true);
                    }}
                  >
                    《隐私协议》
                  </Button>
                  和
                  <Button
                    type="link"
                    size="small"
                    style={{ padding: '0 4px' }}
                    onClick={(e) => {
                      e.preventDefault();
                      setServiceModalVisible(true);
                    }}
                  >
                    《服务协议》
                  </Button>
                </Typography.Text>
              </Checkbox>
            </Form.Item>

            <Form.Item>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  disabled={!captchaVerified || !agreedToTerms}
                  style={{ width: 120 }}
                >
                  注册
                </Button>
                <Button style={{ width: 120 }} onClick={() => navigate('/login')}>
                  返回登录
                </Button>
              </div>
            </Form.Item>
          </Form>
        </Space>
      </div>

      {/* 隐私协议弹窗 */}
      <Modal
        title="隐私协议"
        open={privacyModalVisible}
        onCancel={() => setPrivacyModalVisible(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setPrivacyModalVisible(false)}>
            我知道了
          </Button>,
        ]}
        width={600}
      >
        <div style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
          {PRIVACY_CONTENT}
        </div>
      </Modal>

      {/* 服务协议弹窗 */}
      <Modal
        title="服务协议"
        open={serviceModalVisible}
        onCancel={() => setServiceModalVisible(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setServiceModalVisible(false)}>
            我知道了
          </Button>,
        ]}
        width={600}
      >
        <div style={{ maxHeight: 400, overflow: 'auto', whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>
          {SERVICE_CONTENT}
        </div>
      </Modal>
    </div>
  );
};

export default RegisterPage;
