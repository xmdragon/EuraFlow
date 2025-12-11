import { UserOutlined, LockOutlined, ReloadOutlined } from '@ant-design/icons';
import { Form, Input, Button, Alert, Typography, Space, Spin } from 'antd';
import SliderCaptcha from 'rc-slider-captcha';
import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import authService from '@/services/authService';
import type { LoginRequest } from '@/types/auth';


const { Title } = Typography;

interface CaptchaData {
  captcha_id: string;
  bg_url: string;
  puzzle_url: string;
  y: number;
}

const LoginPage: React.FC = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [captchaVerified, setCaptchaVerified] = useState(false);
  const captchaRef = useRef<{ refresh: () => void }>(null);
  const [captchaKey, setCaptchaKey] = useState(0);
  const [puzzleY, setPuzzleY] = useState(0);

  // 请求验证码
  const requestCaptcha = useCallback(async (): Promise<{
    bgUrl: string;
    puzzleUrl: string;
    y: number;
  }> => {
    const response = await authService.getCaptcha();
    const data = response as CaptchaData;
    // 保存 captcha_id 到 ref，用于验证时使用
    (captchaRef as React.MutableRefObject<{ captchaId?: string }>).current = {
      ...captchaRef.current,
      captchaId: data.captcha_id,
    };
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
      const captchaId = (captchaRef as React.MutableRefObject<{ captchaId?: string }>).current?.captchaId;
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

  const handleLogin = async (values: LoginRequest) => {
    if (!captchaToken) {
      setError('请先完成滑块验证');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await login({ ...values, captcha_token: captchaToken });
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
      // 后端返回格式: { ok: false, error: { detail: { code: "INVALID_CREDENTIALS", message: "..." } } }
      const errorDetail = error.response?.data?.error?.detail;
      let errorMessage = '登录失败';

      if (errorDetail?.code === 'INVALID_CREDENTIALS') {
        errorMessage = '用户名或密码错误';
      } else if (errorDetail?.code === 'RATE_LIMIT_EXCEEDED') {
        errorMessage = '登录尝试次数过多，请稍后再试';
      } else if (errorDetail?.code === 'ACCOUNT_DISABLED') {
        errorMessage = '账号已被禁用';
      } else if (errorDetail?.code === 'CAPTCHA_REQUIRED' || errorDetail?.code === 'CAPTCHA_INVALID') {
        errorMessage = '验证码已过期，请重新验证';
        resetCaptcha();
      } else if (errorDetail?.message) {
        errorMessage = errorDetail.message;
      } else if (error.message && error.message !== 'Request failed with status code 401') {
        errorMessage = error.message;
      }

      setError(errorMessage);
      // 登录失败后重置验证码
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
            <Typography.Text type="secondary">跨境电商管理平台</Typography.Text>
          </div>

          {error && <Alert message={error} type="error" showIcon style={{ marginBottom: 16 }} />}

          <Form name="login" onFinish={handleLogin} size="large" autoComplete="off">
            <Form.Item
              name="username"
              rules={[
                {
                  required: true,
                  message: '请输入用户名!',
                },
              ]}
            >
              <Input prefix={<UserOutlined />} placeholder="用户名或手机号" autoComplete="username" />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                {
                  required: true,
                  message: '请输入密码!',
                },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="密码"
                autoComplete="current-password"
              />
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
                    <Button
                      type="link"
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={resetCaptcha}
                    >
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

            <Form.Item>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={loading}
                  disabled={!captchaVerified}
                  style={{ width: 120 }}
                >
                  登录
                </Button>
                <Button
                  style={{ width: 120 }}
                  onClick={() => navigate('/register')}
                >
                  注册
                </Button>
              </div>
            </Form.Item>
          </Form>
        </Space>
      </div>
    </div>
  );
};

export default LoginPage;
