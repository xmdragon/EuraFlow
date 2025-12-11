/**
 * 额度余额预警弹窗组件
 * - 登录后检查余额是否低于预警阈值
 * - 未静默时显示警告弹窗
 * - 提供"不再提醒"复选框
 */
import { WarningOutlined, WalletOutlined } from '@ant-design/icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal, Button, Checkbox, Typography, Space, Statistic } from 'antd';
import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

import * as creditApi from '@/services/credit';

const { Text, Paragraph } = Typography;

interface CreditBalanceWarningProps {
  /** 用户是否已登录 */
  isLoggedIn: boolean;
}

const CreditBalanceWarning: React.FC<CreditBalanceWarningProps> = ({ isLoggedIn }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [visible, setVisible] = useState(false);
  const [dontRemind, setDontRemind] = useState(false);

  // 获取余额信息
  const { data: balance, isSuccess } = useQuery({
    queryKey: ['credit-balance'],
    queryFn: creditApi.getBalance,
    enabled: isLoggedIn,
    staleTime: 60 * 1000, // 1分钟内不重新请求
    retry: 1,
  });

  // 静默预警 mutation
  const muteMutation = useMutation({
    mutationFn: creditApi.muteAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['credit-balance'] });
    },
  });

  // 检查是否需要显示预警（登录后只检查一次）
  useEffect(() => {
    if (isSuccess && balance) {
      // 余额低于阈值且未静默
      if (balance.is_low_balance && !balance.low_balance_alert_muted) {
        setVisible(true);
      }
    }
  }, [isSuccess, balance]);

  // 处理关闭弹窗
  const handleClose = useCallback(() => {
    if (dontRemind) {
      muteMutation.mutate();
    }
    setVisible(false);
  }, [dontRemind, muteMutation]);

  // 处理去充值
  const handleRecharge = useCallback(() => {
    setVisible(false);
    navigate('/dashboard/profile/credits');
  }, [navigate]);

  if (!visible || !balance) {
    return null;
  }

  return (
    <Modal
      open={visible}
      closable={true}
      onCancel={handleClose}
      footer={null}
      centered
      width={440}
      styles={{
        body: { padding: '32px 24px', textAlign: 'center' },
      }}
    >
      <div style={{ marginBottom: 20 }}>
        <WarningOutlined style={{ fontSize: 56, color: '#faad14' }} />
      </div>

      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        {balance.credit_name}余额不足
      </Typography.Title>

      <Statistic
        value={parseFloat(balance.balance)}
        precision={2}
        prefix={<WalletOutlined />}
        valueStyle={{ color: '#ff4d4f', fontSize: 36 }}
        style={{ marginBottom: 16 }}
      />

      <Paragraph type="secondary" style={{ marginBottom: 24 }}>
        当前余额低于预警阈值（{parseFloat(balance.low_balance_threshold).toFixed(0)} {balance.credit_name}），
        为避免影响正常使用，请及时充值。
      </Paragraph>

      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Button
          type="primary"
          size="large"
          icon={<WalletOutlined />}
          onClick={handleRecharge}
          block
        >
          去充值
        </Button>

        <div style={{ textAlign: 'left' }}>
          <Checkbox
            checked={dontRemind}
            onChange={(e) => setDontRemind(e.target.checked)}
          >
            <Text type="secondary">本次登录不再提醒</Text>
          </Checkbox>
        </div>

        <Button onClick={handleClose} block>
          稍后再说
        </Button>
      </Space>
    </Modal>
  );
};

export default CreditBalanceWarning;
