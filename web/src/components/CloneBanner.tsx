import React from 'react';
import { Button, Space } from 'antd';
import { SwapOutlined, ClockCircleOutlined } from '@ant-design/icons';

import { useAuth } from '@/hooks/useAuth';

/**
 * 克隆状态提示条
 *
 * 在克隆状态下显示在页面顶部，提示当前正在以其他用户身份操作
 */
export const CloneBanner: React.FC = () => {
  const { isCloned, cloneSession, cloneExpiresIn, restoreIdentity } = useAuth();

  if (!isCloned || !cloneSession) {
    return null;
  }

  // 格式化剩余时间
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleRestore = async () => {
    try {
      await restoreIdentity();
      // 刷新页面以重新加载菜单等
      window.location.reload();
    } catch (error) {
      // 恢复失败时强制登出
      window.location.href = '/login';
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 48, // Header 高度
        left: 0,
        right: 0,
        zIndex: 999, // 略低于 Header 的 1000
        background: 'linear-gradient(90deg, #ff7a00, #ff9a3c)',
        color: 'white',
        padding: '8px 24px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: '14px',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
      }}
    >
      <Space>
        <SwapOutlined />
        <span>
          正在以 <strong>{cloneSession.cloned_user.username}</strong> 身份操作
        </span>
        <span style={{ opacity: 0.8 }}>|</span>
        <Space size={4}>
          <ClockCircleOutlined />
          <span>剩余 {formatTime(cloneExpiresIn)}</span>
        </Space>
      </Space>

      <Button
        type="primary"
        size="small"
        ghost
        onClick={handleRestore}
        style={{
          borderColor: 'white',
          color: 'white',
        }}
      >
        恢复身份
      </Button>
    </div>
  );
};

export default CloneBanner;
