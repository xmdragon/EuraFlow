import {
  DashboardOutlined,
  SettingOutlined,
  LogoutOutlined,
  UserOutlined,
  ShopOutlined,
  CalculatorOutlined,
  FilterOutlined,
  ShoppingOutlined,
  ShoppingCartOutlined,
  FileTextOutlined,
  PictureOutlined,
  MessageOutlined,
  SyncOutlined,
  DollarOutlined,
  CloudUploadOutlined,
  CloudOutlined,
  DatabaseOutlined,
  AppstoreOutlined,
  PlusOutlined,
  CheckOutlined,
  CloseOutlined,
  CloseCircleOutlined,
  KeyOutlined,
  CrownOutlined,
  CaretUpFilled,
  PushpinOutlined,
  HomeOutlined,
  WarningOutlined,
  InfoCircleOutlined,
  WalletOutlined,
  TruckOutlined,
  GiftOutlined,
  InboxOutlined,
} from "@ant-design/icons";
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Typography,
  Tooltip,
  Card,
  Row,
  Col,
  Spin,
  Button,
  Space,
  Modal,
} from "antd";
import type { MenuProps } from "antd";
import React, { Suspense, useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";

import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载（带重试机制，处理HMR更新导致的模块失效）
const FinanceCalculator = lazyWithRetry(() => import("./finance"));
const OzonManagement = lazyWithRetry(() => import("./ozon"));
const SystemManagement = lazyWithRetry(() => import("./system"));
const UserPages = lazyWithRetry(() => import("./user"));
const ApiKeys = lazyWithRetry(() => import("./ApiKeys"));
const UserManagement = lazyWithRetry(() => import("./users"));
const ShopManagement = lazyWithRetry(() => import("./shops"));

import styles from "./Dashboard.module.scss";

import ErrorBoundary from "@/components/ErrorBoundary";
import PageTitle from "@/components/PageTitle";
import QuickAccessButton from "@/components/QuickAccessButton";
import CloneBanner from "@/components/CloneBanner";
import { useAuth } from "@/hooks/useAuth";
import { useQuickMenu } from "@/hooks/useQuickMenu";
import { useOzonMenuOrder } from "@/hooks/useOzonMenuOrder";
import type { User } from "@/types/auth";
import { notifyWarning } from "@/utils/notification";
import { setOzonImageCdn } from "@/utils/ozonImageOptimizer";
import { getGlobalSettings } from "@/services/ozon";

// 加载中组件
const PageLoading = () => (
  <div
    style={{
      display: "flex",
      justifyContent: "center",
      alignItems: "center",
      minHeight: "400px",
    }}
  >
    <Spin size="large" />
  </div>
);

const { Header, Sider, Content } = Layout;
const { Title } = Typography;

/**
 * 无店铺提示弹窗组件
 * - 子账号：提示添加店铺（显示店铺管理+退出登录）
 * - 管理员：提示添加店铺或创建子账号（显示店铺管理+用户管理+退出登录）
 * - 全屏居中显示，不可关闭
 */
const NoShopModal: React.FC<{
  role: string;
  onLogout: () => void;
  onNavigate: (path: string) => void;
}> = ({ role, onLogout, onNavigate }) => {
  const isSubAccount = role === 'sub_account';

  return (
    <Modal
      open={true}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      centered
      width={560}
      styles={{
        mask: { backgroundColor: 'rgba(0, 0, 0, 0.65)' },
        body: { padding: '48px 40px', textAlign: 'center', minHeight: 420 },
      }}
    >
      <div style={{ marginBottom: 24 }}>
        <InfoCircleOutlined style={{ fontSize: 64, color: '#1890ff' }} />
      </div>
      <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 16 }}>
        当前没有添加店铺
      </h2>
      {isSubAccount ? (
        <p style={{ fontSize: 14, color: '#666', marginBottom: 32 }}>
          请添加店铺
        </p>
      ) : (
        <div style={{ fontSize: 14, color: '#666', marginBottom: 32, textAlign: 'left', display: 'inline-block' }}>
          <p style={{ margin: '0 0 4px 0' }}>1. 添加店铺</p>
          <p style={{ margin: 0 }}>2. 添加子账号，在子账号添加店铺</p>
        </div>
      )}
      <Space size={16}>
        <Button
          type="primary"
          size="large"
          icon={<ShopOutlined />}
          onClick={() => onNavigate('/dashboard/shops')}
        >
          店铺管理
        </Button>
        {!isSubAccount && (
          <Button
            size="large"
            icon={<UserOutlined />}
            onClick={() => onNavigate('/dashboard/users')}
          >
            用户管理
          </Button>
        )}
        <Button
          size="large"
          danger
          icon={<LogoutOutlined />}
          onClick={onLogout}
        >
          退出登录
        </Button>
      </Space>
    </Modal>
  );
};

const Dashboard: React.FC = () => {
  const { user, logout, isCloned } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { quickMenuItems, addQuickMenu, removeQuickMenu, isInQuickMenu } = useQuickMenu();
  const { menuOrder, moveUp } = useOzonMenuOrder();

  // 检查用户是否有店铺（用于控制 OZON 菜单是否可展开和弹窗显示）
  const hasShops = user?.shop_ids && user.shop_ids.length > 0;

  // 控制无店铺弹窗是否显示（用户点击导航后关闭）
  const [showNoShopModal, setShowNoShopModal] = useState(!hasShops);

  // 侧边栏折叠状态，从 localStorage 读取初始值
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });

  // 菜单展开状态（手风琴效果：同时只能展开一个菜单组）
  // 如果没有店铺，即使在 ozon 路径也不展开 ozon 菜单
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const path = location.pathname;
    if (path.includes("/ozon")) return hasShops ? ["ozon"] : [];
    if (path.includes("/system")) return ["system"];
    if (path.includes("/users")) return ["users"];
    return [];
  });

  // 保存折叠状态到 localStorage
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  // 初始化 OZON 图片 CDN 设置
  useEffect(() => {
    const initImageCdn = async () => {
      try {
        const response = await getGlobalSettings() as {
          settings?: {
            ozon_image_cdn?: {
              setting_value?: { selected_cdn?: string };
            };
          };
        };
        const selectedCdn = response?.settings?.ozon_image_cdn?.setting_value?.selected_cdn;
        if (selectedCdn) {
          setOzonImageCdn(selectedCdn);
        }
      } catch {
        // 忽略错误，使用默认 CDN
      }
    };
    initImageCdn();
  }, []);

  // 处理菜单展开/收起（手风琴效果）
  const handleOpenChange = (keys: string[]) => {
    // 定义有子菜单的根级菜单组
    const rootSubmenuKeys = ['ozon', 'system', 'users'];

    // 获取最新展开的菜单 key
    const latestOpenKey = keys.find((key) => openKeys.indexOf(key) === -1);

    // 如果没有新展开的菜单（用户在收起菜单），直接更新状态
    if (!latestOpenKey) {
      setOpenKeys(keys);
      return;
    }

    // 如果尝试展开 OZON 菜单但没有店铺，阻止展开并提示
    if (latestOpenKey === 'ozon' && !hasShops) {
      notifyWarning('无法展开', '请先添加店铺后再使用 OZON 管理功能');
      return;
    }

    // 如果新展开的是根级菜单组，只保留这一个
    if (rootSubmenuKeys.includes(latestOpenKey)) {
      setOpenKeys([latestOpenKey]);
    } else {
      // 如果不是根级菜单组（理论上不会发生），保持当前状态
      setOpenKeys(keys);
    }
  };

  const handleLogout = async () => {
    await logout();
  };

  // 处理添加快捷菜单
  const handleAddQuickMenu = (key: string, label: string, path: string) => {
    addQuickMenu({ key, label, path });
  };

  // 图标映射（用于快捷菜单渲染）
  const iconMap: Record<string, React.ReactNode> = {
    DashboardOutlined: <DashboardOutlined />,
    CalculatorOutlined: <CalculatorOutlined />,
    FilterOutlined: <FilterOutlined />,
    ShoppingOutlined: <ShoppingOutlined />,
    CloudUploadOutlined: <CloudUploadOutlined />,
    CloudOutlined: <CloudOutlined />,
    DollarOutlined: <DollarOutlined />,
    ShoppingCartOutlined: <ShoppingCartOutlined />,
    FileTextOutlined: <FileTextOutlined />,
    MessageOutlined: <MessageOutlined />,
    PictureOutlined: <PictureOutlined />,
    SyncOutlined: <SyncOutlined />,
    SettingOutlined: <SettingOutlined />,
    UserOutlined: <UserOutlined />,
    TruckOutlined: <TruckOutlined />,
    GiftOutlined: <GiftOutlined />,
    DatabaseOutlined: <DatabaseOutlined />,
    CloseCircleOutlined: <CloseCircleOutlined />,
    HomeOutlined: <HomeOutlined />,
    WalletOutlined: <WalletOutlined />,
    CrownOutlined: <CrownOutlined />,
  };

  const userMenuItems: MenuProps['items'] = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "个人资料",
      onClick: () => navigate("/dashboard/profile"),
    },
    {
      key: "settings",
      icon: <SettingOutlined />,
      label: "个人设置",
      onClick: () => navigate("/dashboard/profile/settings"),
    },
    {
      key: "password",
      icon: <KeyOutlined />,
      label: "修改密码",
      onClick: () => navigate("/dashboard/profile/password"),
    },
    {
      key: "credits",
      icon: <WalletOutlined />,
      label: "额度中心",
      onClick: () => navigate("/dashboard/profile/credits"),
    },
    { type: "divider", key: "divider-1" },
    {
      key: "api-keys",
      icon: <KeyOutlined />,
      label: "API KEY",
      onClick: () => navigate("/dashboard/api-keys"),
    },
  ];

  // 创建带添加按钮的菜单项标签
  // 注意：折叠状态下悬浮菜单需要纯文本label才能正确显示
  const createMenuLabel = (key: string, label: string, path: string) => {
    // 折叠状态下返回纯文本，确保悬浮菜单正确显示
    if (collapsed) {
      return label;
    }
    const isAdded = isInQuickMenu(key);
    // 仪表板不显示添加按钮，因为登录后默认就在这一页
    const showAddButton = key !== 'dashboard';
    return (
      <div className={styles.menuItemWrapper}>
        <span>{label}</span>
        {showAddButton && (
          <Button
            type="text"
            size="small"
            className={styles.addMenuButton}
            icon={isAdded ? <CheckOutlined /> : <PlusOutlined />}
            onClick={(e) => {
              e.stopPropagation();
              if (!isAdded) {
                handleAddQuickMenu(key, label, path);
              }
            }}
          />
        )}
      </div>
    );
  };

  const menuItems = [
    {
      key: "dashboard",
      icon: <HomeOutlined />,
      label: createMenuLabel("dashboard", "首页", "/dashboard"),
      onClick: () => navigate("/dashboard"),
    },
    {
      key: "finance",
      icon: <CalculatorOutlined />,
      label: createMenuLabel("finance", "计算器", "/dashboard/finance"),
      onClick: () => navigate("/dashboard/finance"),
    },
    {
      key: "ozon",
      icon: <ShopOutlined />,
      label: "Ozon管理",
      children: (() => {
        // Ozon 子菜单配置（使用新名称）
        const ozonMenuConfig: Record<string, { icon: React.ReactNode; label: string; path: string }> = {
          'ozon-overview': { icon: <DashboardOutlined />, label: '店铺概览', path: '/dashboard/ozon/overview' },
          'ozon-packing': { icon: <TruckOutlined />, label: '打包发货', path: '/dashboard/ozon/packing' },
          'ozon-orders': { icon: <ShoppingCartOutlined />, label: '订单管理', path: '/dashboard/ozon/orders' },
          'ozon-products-list': { icon: <ShoppingOutlined />, label: '商品列表', path: '/dashboard/ozon/products' },
          'ozon-reports': { icon: <FileTextOutlined />, label: '订单报表', path: '/dashboard/ozon/reports' },
          'ozon-selection': { icon: <FilterOutlined />, label: '选品助手', path: '/dashboard/ozon/selection' },
          'ozon-listing-records': { icon: <CloudUploadOutlined />, label: '上架记录', path: '/dashboard/ozon/listing-records' },
          'ozon-collection-records': { icon: <DatabaseOutlined />, label: '采集记录', path: '/dashboard/ozon/collection-records' },
          'ozon-stock': { icon: <InboxOutlined />, label: '库存管理', path: '/dashboard/ozon/stock' },
          'ozon-cancel-return': { icon: <CloseCircleOutlined />, label: '取消退货', path: '/dashboard/ozon/cancel-return' },
          'ozon-finance-transactions': { icon: <DollarOutlined />, label: '财务记录', path: '/dashboard/ozon/finance-transactions' },
          'ozon-warehouses': { icon: <HomeOutlined />, label: '仓库列表', path: '/dashboard/ozon/warehouses' },
          'ozon-promotions': { icon: <GiftOutlined />, label: '促销活动', path: '/dashboard/ozon/promotions' },
          'ozon-chats': { icon: <MessageOutlined />, label: '聊天管理', path: '/dashboard/ozon/chats' },
        };

        // 创建带上移按钮的 Ozon 菜单标签
        const createOzonMenuLabel = (key: string, label: string, path: string, index: number) => {
          const isAdded = isInQuickMenu(key);
          return (
            <div className={styles.menuItemWrapper}>
              <span>{label}</span>
              {!collapsed && index > 0 && (
                <Tooltip title="上移此菜单" placement="top">
                  <Button
                    type="text"
                    size="small"
                    className={styles.moveUpButton}
                    icon={<CaretUpFilled />}
                    onClick={(e) => {
                      e.stopPropagation();
                      moveUp(key);
                    }}
                  />
                </Tooltip>
              )}
              {!collapsed && (
                <Tooltip title={isAdded ? "已添加到首页快捷菜单" : "添加到首页快捷菜单"} placement="top">
                  <Button
                    type="text"
                    size="small"
                    className={styles.addMenuButton}
                    icon={isAdded ? <CheckOutlined /> : <PushpinOutlined />}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!isAdded) {
                        handleAddQuickMenu(key, label, path);
                      }
                    }}
                  />
                </Tooltip>
              )}
            </div>
          );
        };

        // 根据用户自定义顺序生成菜单项
        // 注意：折叠状态下悬浮菜单需要纯文本label才能正确显示
        return menuOrder.map((key, index) => {
          const config = ozonMenuConfig[key];
          if (!config) return null;
          return {
            key,
            icon: config.icon,
            label: collapsed ? config.label : createOzonMenuLabel(key, config.label, config.path, index),
            onClick: () => navigate(config.path),
          };
        }).filter(Boolean);
      })(),
    },
    // 店铺管理 - admin、manager 和 sub_account 可见
    {
      key: "shops",
      icon: <ShopOutlined />,
      label: createMenuLabel("shops", "店铺管理", "/dashboard/shops"),
      onClick: () => navigate("/dashboard/shops"),
    },
    // 用户管理 - admin 和 manager 可见（克隆状态下隐藏）
    ...(!isCloned && (user?.role === "admin" || user?.role === "manager")
      ? [
          {
            key: "users",
            icon: <UserOutlined />,
            label: "用户管理",
            children: [
              {
                key: "users-list",
                icon: <UserOutlined />,
                label: createMenuLabel("users-list", "用户列表", "/dashboard/users"),
                onClick: () => navigate("/dashboard/users"),
              },
              // 用户级别 - 仅超级管理员可见
              ...(user?.role === "admin"
                ? [
                    {
                      key: "users-levels",
                      icon: <CrownOutlined />,
                      label: createMenuLabel("users-levels", "用户级别", "/dashboard/users/levels"),
                      onClick: () => navigate("/dashboard/users/levels"),
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    // 系统管理菜单 - 仅超级管理员可见（克隆状态下隐藏）
    ...(!isCloned && user?.role === "admin"
      ? [
          {
            key: "system",
            icon: <AppstoreOutlined />,
            label: "系统管理",
            children: [
              {
                key: "system-sync-services",
                icon: <SyncOutlined />,
                label: createMenuLabel("system-sync-services", "后台服务", "/dashboard/system/sync-services"),
                onClick: () => navigate("/dashboard/system/sync-services"),
              },
              {
                key: "system-configuration",
                icon: <SettingOutlined />,
                label: createMenuLabel("system-configuration", "系统配置", "/dashboard/system/configuration"),
                onClick: () => navigate("/dashboard/system/configuration"),
              },
              {
                key: "system-watermark",
                icon: <PictureOutlined />,
                label: createMenuLabel("system-watermark", "水印管理", "/dashboard/system/watermark"),
                onClick: () => navigate("/dashboard/system/watermark"),
              },
              {
                key: "system-image-storage",
                icon: <CloudOutlined />,
                label: createMenuLabel("system-image-storage", "图床资源", "/dashboard/system/image-storage"),
                onClick: () => navigate("/dashboard/system/image-storage"),
              },
              {
                key: "system-logs",
                icon: <FileTextOutlined />,
                label: createMenuLabel("system-logs", "日志管理", "/dashboard/system/logs"),
                onClick: () => navigate("/dashboard/system/logs"),
              },
              {
                key: "system-credits",
                icon: <WalletOutlined />,
                label: createMenuLabel("system-credits", "额度管理", "/dashboard/system/credits"),
                onClick: () => navigate("/dashboard/system/credits"),
              },
            ],
          },
        ]
      : []),
  ];

  // 根据路径获取选中的菜单项
  const getSelectedKey = () => {
    const path = location.pathname;
    if (path.includes("/ozon/overview")) return "ozon-overview";
    if (path.includes("/ozon/selection")) return "ozon-selection";
    if (path.includes("/ozon/products/create")) return "ozon-products-create";
    if (path.includes("/ozon/products")) return "ozon-products-list";
    if (path.includes("/ozon/listing-records")) return "ozon-listing-records";
    if (path.includes("/ozon/collection-records")) return "ozon-collection-records";
    if (path.includes("/ozon/promotions")) return "ozon-promotions";
    if (path.includes("/ozon/packing")) return "ozon-packing";
    if (path.includes("/ozon/orders")) return "ozon-orders";
    if (path.includes("/ozon/reports")) return "ozon-reports";
    if (path.includes("/ozon/cancel-return")) return "ozon-cancel-return";
    if (path.includes("/ozon/stock")) return "ozon-stock";
    if (path.includes("/ozon/finance-transactions")) return "ozon-finance-transactions";
    if (path.includes("/ozon/chats")) return "ozon-chats";
    if (path.includes("/system/logs")) return "system-logs";
    if (path.includes("/system/configuration")) return "system-configuration";
    if (path.includes("/system/watermark")) return "system-watermark";
    if (path.includes("/system/image-storage")) return "system-image-storage";
    if (path.includes("/system/sync-services")) return "system-sync-services";
    if (path.includes("/system/credits")) return "system-credits";
    if (path.includes("/finance")) return "finance";
    if (path.includes("/shops")) return "shops";
    if (path.includes("/users/levels")) return "users-levels";
    if (path.includes("/users")) return "users-list";
    if (path.includes("/profile/credits")) return "credits";
    if (path.includes("/profile")) return "profile";
    return "dashboard";
  };

  // 处理弹窗中的导航（关闭弹窗后导航）
  const handleModalNavigate = (path: string) => {
    setShowNoShopModal(false);
    navigate(path);
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      {/* 无店铺时显示全屏弹窗 */}
      {showNoShopModal && !hasShops && user && (
        <NoShopModal
          role={user.role}
          onLogout={handleLogout}
          onNavigate={handleModalNavigate}
        />
      )}

      {/* T字型布局：顶部 Header */}
      <Header className={styles.header}>
        <div className={styles.headerLogo}>EuraFlow</div>
        <Space size={16}>
          <Dropdown
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            arrow
            trigger={["click"]}
          >
            <div className={styles.headerUser}>
              <span className={styles.headerUsername}>
                {user?.username || "未设置"}
              </span>
            </div>
          </Dropdown>
          <Tooltip title="退出登录">
            <LogoutOutlined
              className={styles.headerLogout}
              onClick={handleLogout}
            />
          </Tooltip>
        </Space>
      </Header>

      {/* 克隆状态提示条 */}
      <CloneBanner />

      <Layout className={styles.mainLayout}>
        <Sider
          theme="light"
          width={240}
          collapsible
          collapsed={collapsed}
          onCollapse={setCollapsed}
          collapsedWidth={80}
          className={styles.sider}
        >
          <Menu
            theme="light"
            mode="inline"
            selectedKeys={[getSelectedKey()]}
            openKeys={openKeys}
            onOpenChange={handleOpenChange}
            items={menuItems}
            style={{ background: "transparent", borderRight: "none" }}
          />
        </Sider>

        <Content className={styles.content}>
          {/* 路由级错误边界：隔离各页面错误，防止单个页面崩溃影响整体导航 */}
          <ErrorBoundary name="页面路由">
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <DashboardHome
                      quickMenuItems={quickMenuItems}
                      removeQuickMenu={removeQuickMenu}
                      navigate={navigate}
                      iconMap={iconMap}
                    />
                  }
                />
                <Route path="ozon/*" element={<OzonManagement />} />
                <Route path="finance" element={<FinanceCalculator />} />
                <Route path="profile/*" element={<UserPages />} />
                <Route path="api-keys" element={<ApiKeys />} />
                {/* 系统管理路由 - 仅超级管理员可访问 */}
                {user?.role === "admin" && (
                  <Route path="system/*" element={<SystemManagement />} />
                )}
                {/* 店铺管理路由 - 所有角色可访问 */}
                <Route path="shops/*" element={<ShopManagement />} />
                {/* 用户管理路由 - admin 和 manager 可访问 */}
                {(user?.role === "admin" || user?.role === "manager") && (
                  <Route path="users/*" element={<UserManagement />} />
                )}
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Content>
      </Layout>
      {/* 全局悬浮快捷按钮 */}
      <QuickAccessButton />
    </Layout>
  );
};

// 仪表板首页组件
interface DashboardHomeProps {
  quickMenuItems: Array<{ key: string; label: string; path: string }>;
  removeQuickMenu: (key: string) => void;
  navigate: (path: string) => void;
  iconMap: Record<string, React.ReactNode>;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({
  quickMenuItems,
  removeQuickMenu,
  navigate,
  iconMap,
}) => {
  return (
    <div className={styles.pageWrapper}>
      {/* 欢迎标题 */}
      <Title level={2} className={styles.welcomeTitle}>
        欢迎使用 EuraFlow 跨境电商管理平台
      </Title>

      {/* 快捷菜单区域 */}
      {quickMenuItems.length > 0 && (
        <div>
          <Title level={4} className={styles.quickMenuTitle}>快捷菜单</Title>
          <Row gutter={16} className={styles.quickMenuRow}>
            {quickMenuItems.map((item) => (
              <Col xs={12} sm={8} md={6} lg={4} key={item.key}>
                <Card
                  hoverable
                  className={styles.quickMenuItem}
                  onClick={() => navigate(item.path)}
                >
                  <div className={styles.quickMenuContent}>
                    <Button
                      type="text"
                      danger
                      size="small"
                      className={styles.removeButton}
                      icon={<CloseOutlined />}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeQuickMenu(item.key);
                      }}
                    />
                    <div className={styles.quickMenuIcon}>
                      {iconMap[item.key] || <DashboardOutlined />}
                    </div>
                    <div className={styles.quickMenuLabel}>{item.label}</div>
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
