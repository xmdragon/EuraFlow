import React, { useState, useEffect, useRef } from 'react';
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

const STORAGE_KEY = 'quickAccessButton_topPosition';
const DEFAULT_TOP_VH = 66.67; // 默认 2/3 高度
const MIN_TOP_PX = 48; // 最小距离顶部（图标高度的一半）
const BOTTOM_MARGIN_PX = 48; // 底部边距

/**
 * 悬浮快捷访问按钮组件
 * 位置：右边界，默认 2/3 高度，可垂直拖动
 * 功能：鼠标悬停时图标消失显示菜单，移出后菜单消失显示图标
 */
const QuickAccessButton: React.FC = () => {
  const navigate = useNavigate();
  const { quickMenuItems } = useQuickMenu();

  // 拖动状态
  const [topPosition, setTopPosition] = useState<number>(DEFAULT_TOP_VH); // vh 单位
  const [isDragging, setIsDragging] = useState(false);
  const dragStartY = useRef<number>(0);
  const dragStartTop = useRef<number>(0);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // 从 localStorage 加载保存的位置
  useEffect(() => {
    const savedPosition = localStorage.getItem(STORAGE_KEY);
    if (savedPosition) {
      const position = parseFloat(savedPosition);
      if (!isNaN(position)) {
        setTopPosition(position);
        logger.info('快捷菜单加载保存位置', { position });
      }
    }
  }, []);

  // 拖动开始
  const handleMouseDown = (e: React.MouseEvent) => {
    // 只响应左键
    if (e.button !== 0) return;

    e.preventDefault();
    e.stopPropagation();

    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    dragStartY.current = e.clientY;
    dragStartTop.current = rect.top;
    setIsDragging(true);

    logger.info('快捷菜单开始拖动', { startY: e.clientY });
  };

  // 全局鼠标移动事件
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      e.preventDefault();

      const deltaY = e.clientY - dragStartY.current;
      const newTop = dragStartTop.current + deltaY;

      // 限制拖动范围
      const maxTop = window.innerHeight - BOTTOM_MARGIN_PX;
      const clampedTop = Math.max(MIN_TOP_PX, Math.min(newTop, maxTop));

      setTopPosition(clampedTop);
    };

    const handleMouseUp = (e: MouseEvent) => {
      e.preventDefault();
      setIsDragging(false);

      // 保存位置到 localStorage
      const finalPosition = topPosition;
      localStorage.setItem(STORAGE_KEY, finalPosition.toString());

      logger.info('快捷菜单拖动结束', { finalPosition });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, topPosition]);

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
    <div
      ref={containerRef}
      className={`${styles.container} ${isDragging ? styles.dragging : ''}`}
      style={{ top: `${topPosition}px` }}
    >
      {/* 图标按钮 */}
      <div className={styles.iconButton}>
        <ThunderboltOutlined className={styles.icon} />
      </div>

      {/* 展开的菜单 */}
      <div className={styles.menu}>
        <div
          className={styles.menuHeader}
          onMouseDown={handleMouseDown}
          title="拖动调整位置"
        >
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
