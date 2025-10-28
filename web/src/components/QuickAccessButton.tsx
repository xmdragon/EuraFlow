import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DashboardOutlined,
  CalculatorOutlined,
  FilterOutlined,
  ShoppingOutlined,
  CloudUploadOutlined,
  DollarOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  MessageOutlined,
  PictureOutlined,
  SyncOutlined,
  SettingOutlined,
  UserOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useQuickMenu } from '@/hooks/useQuickMenu';
import { logger } from '@/utils/logger';
import styles from './QuickAccessButton.module.scss';

/**
 * 悬浮快捷访问按钮组件
 * 位置：右边界 2/3 高度
 * 功能：鼠标悬停时图标消失显示菜单，移出后菜单消失显示图标
 */
const QuickAccessButton: React.FC = () => {
  const navigate = useNavigate();
  const { quickMenuItems } = useQuickMenu();

  // 图标映射（与 Dashboard.tsx 保持一致）
  const iconMap: Record<string, React.ReactNode> = {
    DashboardOutlined: <DashboardOutlined />,
    CalculatorOutlined: <CalculatorOutlined />,
    FilterOutlined: <FilterOutlined />,
    ShoppingOutlined: <ShoppingOutlined />,
    CloudUploadOutlined: <CloudUploadOutlined />,
    DollarOutlined: <DollarOutlined />,
    ShoppingCartOutlined: <ShoppingCartOutlined />,
    FileTextOutlined: <FileTextOutlined />,
    MessageOutlined: <MessageOutlined />,
    PictureOutlined: <PictureOutlined />,
    SyncOutlined: <SyncOutlined />,
    SettingOutlined: <SettingOutlined />,
    UserOutlined: <UserOutlined />,
  };

  // 处理菜单项点击
  const handleMenuItemClick = (path: string, label: string) => {
    logger.info('快捷菜单跳转', { path, label });
    navigate(path);
  };

  // 如果没有快捷菜单项，不显示按钮
  if (quickMenuItems.length === 0) {
    return null;
  }

  return (
    <div className={styles.container}>
      {/* 图标按钮 */}
      <div className={styles.iconButton}>
        <ThunderboltOutlined className={styles.icon} />
      </div>

      {/* 展开的菜单 */}
      <div className={styles.menu}>
        <div className={styles.menuHeader}>
          <ThunderboltOutlined className={styles.menuHeaderIcon} />
          <span className={styles.menuHeaderText}>快捷菜单</span>
        </div>
        <div className={styles.menuList}>
          {quickMenuItems.map((item) => (
            <div
              key={item.key}
              className={styles.menuItem}
              onClick={() => handleMenuItemClick(item.path, item.label)}
            >
              <span className={styles.menuItemIcon}>
                {iconMap[item.key] || <DashboardOutlined />}
              </span>
              <span className={styles.menuItemLabel}>{item.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default QuickAccessButton;
