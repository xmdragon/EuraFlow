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
  DatabaseOutlined,
  AppstoreOutlined,
  PlusOutlined,
  CheckOutlined,
  CloseOutlined,
  CloseCircleOutlined,
  KeyOutlined,
} from "@ant-design/icons";
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Typography,
  Card,
  Row,
  Col,
  Spin,
  Button,
} from "antd";
import React, { Suspense, useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";

import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载（带重试机制，处理HMR更新导致的模块失效）
const FinanceCalculator = lazyWithRetry(() => import("./finance"));
const OzonManagement = lazyWithRetry(() => import("./ozon"));
const SystemManagement = lazyWithRetry(() => import("./system"));
const Profile = lazyWithRetry(() => import("./Profile"));
const ApiKeys = lazyWithRetry(() => import("./ApiKeys"));
const UserManagement = lazyWithRetry(() => import("./UserManagement"));

import styles from "./Dashboard.module.scss";

import ErrorBoundary from "@/components/ErrorBoundary";
import PageTitle from "@/components/PageTitle";
import QuickAccessButton from "@/components/QuickAccessButton";
import { useAuth } from "@/hooks/useAuth";
import { useQuickMenu } from "@/hooks/useQuickMenu";
import type { User } from "@/types/auth";

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

const { Sider, Content } = Layout;
const { Title } = Typography;

const Dashboard: React.FC = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { quickMenuItems, addQuickMenu, removeQuickMenu, isInQuickMenu } = useQuickMenu();

  // 侧边栏折叠状态，从 localStorage 读取初始值
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem("sidebarCollapsed");
    return saved ? JSON.parse(saved) : false;
  });

  // 菜单展开状态（手风琴效果：同时只能展开一个菜单组）
  const [openKeys, setOpenKeys] = useState<string[]>(() => {
    const path = location.pathname;
    if (path.includes("/ozon")) return ["ozon"];
    if (path.includes("/system")) return ["system"];
    return [];
  });

  // 保存折叠状态到 localStorage
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", JSON.stringify(collapsed));
  }, [collapsed]);

  // 处理菜单展开/收起（手风琴效果）
  const handleOpenChange = (keys: string[]) => {
    // 定义有子菜单的根级菜单组
    const rootSubmenuKeys = ['ozon', 'system'];

    // 获取最新展开的菜单 key
    const latestOpenKey = keys.find((key) => openKeys.indexOf(key) === -1);

    // 如果没有新展开的菜单（用户在收起菜单），直接更新状态
    if (!latestOpenKey) {
      setOpenKeys(keys);
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
    DollarOutlined: <DollarOutlined />,
    ShoppingCartOutlined: <ShoppingCartOutlined />,
    FileTextOutlined: <FileTextOutlined />,
    MessageOutlined: <MessageOutlined />,
    PictureOutlined: <PictureOutlined />,
    SyncOutlined: <SyncOutlined />,
    SettingOutlined: <SettingOutlined />,
    UserOutlined: <UserOutlined />,
  };

  const userMenuItems = [
    {
      key: "profile",
      icon: <UserOutlined />,
      label: "个人资料",
      onClick: () => navigate("/dashboard/profile"),
    },
    {
      key: "api-keys",
      icon: <KeyOutlined />,
      label: "API KEY",
      onClick: () => navigate("/dashboard/api-keys"),
    },
    { type: "divider" as const },
    {
      key: "logout",
      icon: <LogoutOutlined />,
      label: "退出登录",
      onClick: handleLogout,
    },
  ];

  // 创建带添加按钮的菜单项标签
  const createMenuLabel = (key: string, label: string, path: string) => {
    const isAdded = isInQuickMenu(key);
    // 仪表板不显示添加按钮，因为登录后默认就在这一页
    const showAddButton = key !== 'dashboard';
    return (
      <div className={styles.menuItemWrapper}>
        <span>{label}</span>
        {!collapsed && showAddButton && (
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
      icon: <DashboardOutlined />,
      label: createMenuLabel("dashboard", "仪表板", "/dashboard"),
      onClick: () => navigate("/dashboard"),
    },
    {
      key: "finance",
      icon: <CalculatorOutlined />,
      label: createMenuLabel("finance", "财务计算", "/dashboard/finance"),
      onClick: () => navigate("/dashboard/finance"),
    },
    {
      key: "ozon",
      icon: <ShopOutlined />,
      label: "Ozon管理",
      children: [
        {
          key: "ozon-overview",
          icon: <DashboardOutlined />,
          label: createMenuLabel("ozon-overview", "概览", "/dashboard/ozon/overview"),
          onClick: () => navigate("/dashboard/ozon/overview"),
        },
        {
          key: "ozon-selection",
          icon: <FilterOutlined />,
          label: createMenuLabel("ozon-selection", "选品助手", "/dashboard/ozon/selection"),
          onClick: () => navigate("/dashboard/ozon/selection"),
        },
        {
          key: "ozon-products-list",
          icon: <ShoppingOutlined />,
          label: createMenuLabel("ozon-products-list", "商品列表", "/dashboard/ozon/products"),
          onClick: () => navigate("/dashboard/ozon/products"),
        },
        {
          key: "ozon-listing-records",
          icon: <CloudUploadOutlined />,
          label: createMenuLabel("ozon-listing-records", "上架记录", "/dashboard/ozon/listing-records"),
          onClick: () => navigate("/dashboard/ozon/listing-records"),
        },
        {
          key: "ozon-collection-records",
          icon: <DatabaseOutlined />,
          label: createMenuLabel("ozon-collection-records", "采集记录", "/dashboard/ozon/collection-records"),
          onClick: () => navigate("/dashboard/ozon/collection-records"),
        },
        {
          key: "ozon-promotions",
          icon: <DollarOutlined />,
          label: createMenuLabel("ozon-promotions", "促销活动", "/dashboard/ozon/promotions"),
          onClick: () => navigate("/dashboard/ozon/promotions"),
        },
        {
          key: "ozon-orders",
          icon: <ShoppingCartOutlined />,
          label: createMenuLabel("ozon-orders", "订单管理", "/dashboard/ozon/orders"),
          onClick: () => navigate("/dashboard/ozon/orders"),
        },
        {
          key: "ozon-packing",
          icon: <ShoppingCartOutlined />,
          label: createMenuLabel("ozon-packing", "打包发货", "/dashboard/ozon/packing"),
          onClick: () => navigate("/dashboard/ozon/packing"),
        },
        {
          key: "ozon-reports",
          icon: <FileTextOutlined />,
          label: createMenuLabel("ozon-reports", "订单报表", "/dashboard/ozon/reports"),
          onClick: () => navigate("/dashboard/ozon/reports"),
        },
        {
          key: "ozon-cancel-return",
          icon: <CloseCircleOutlined />,
          label: createMenuLabel("ozon-cancel-return", "取消和退货", "/dashboard/ozon/cancel-return"),
          onClick: () => navigate("/dashboard/ozon/cancel-return"),
        },
        {
          key: "ozon-stock",
          icon: <DatabaseOutlined />,
          label: createMenuLabel("ozon-stock", "库存管理", "/dashboard/ozon/stock"),
          onClick: () => navigate("/dashboard/ozon/stock"),
        },
        {
          key: "ozon-finance-transactions",
          icon: <DollarOutlined />,
          label: createMenuLabel("ozon-finance-transactions", "财务交易", "/dashboard/ozon/finance-transactions"),
          onClick: () => navigate("/dashboard/ozon/finance-transactions"),
        },
        {
          key: "ozon-chats",
          icon: <MessageOutlined />,
          label: createMenuLabel("ozon-chats", "聊天管理", "/dashboard/ozon/chats"),
          onClick: () => navigate("/dashboard/ozon/chats"),
        },
      ],
    },
    // 系统管理菜单 - 根据角色显示不同子菜单
    ...(user?.role === "admin" || user?.role === "operator"
      ? [
          {
            key: "system",
            icon: <AppstoreOutlined />,
            label: "系统管理",
            children: [
              // 后台服务 - 仅管理员可见
              ...(user?.role === "admin"
                ? [
                    {
                      key: "system-sync-services",
                      icon: <SyncOutlined />,
                      label: createMenuLabel("system-sync-services", "后台服务", "/dashboard/system/sync-services"),
                      onClick: () => navigate("/dashboard/system/sync-services"),
                    },
                  ]
                : []),
              // 系统配置 - 管理员和操作员都可见
              {
                key: "system-configuration",
                icon: <SettingOutlined />,
                label: createMenuLabel("system-configuration", "系统配置", "/dashboard/system/configuration"),
                onClick: () => navigate("/dashboard/system/configuration"),
              },
              // 水印管理 - 管理员和操作员都可见
              {
                key: "system-watermark",
                icon: <PictureOutlined />,
                label: createMenuLabel("system-watermark", "水印管理", "/dashboard/system/watermark"),
                onClick: () => navigate("/dashboard/system/watermark"),
              },
              // 图床资源 - 仅管理员可见
              ...(user?.role === "admin"
                ? [
                    {
                      key: "system-image-storage",
                      icon: <CloudUploadOutlined />,
                      label: createMenuLabel("system-image-storage", "图床资源", "/dashboard/system/image-storage"),
                      onClick: () => navigate("/dashboard/system/image-storage"),
                    },
                  ]
                : []),
              // 日志管理 - 仅管理员可见
              ...(user?.role === "admin"
                ? [
                    {
                      key: "system-logs",
                      icon: <FileTextOutlined />,
                      label: createMenuLabel("system-logs", "日志管理", "/dashboard/system/logs"),
                      onClick: () => navigate("/dashboard/system/logs"),
                    },
                  ]
                : []),
            ],
          },
        ]
      : []),
    // 用户管理 - 仅管理员可见
    ...(user?.role === "admin"
      ? [
          {
            key: "users",
            icon: <UserOutlined />,
            label: createMenuLabel("users", "用户管理", "/dashboard/users"),
            onClick: () => navigate("/dashboard/users"),
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
    if (path.includes("/finance")) return "finance";
    if (path.includes("/users")) return "users";
    if (path.includes("/profile")) return "profile";
    return "dashboard";
  };

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Sider
        theme="dark"
        width={240}
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        collapsedWidth={80}
        style={{
          overflow: "auto",
          height: "100vh",
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <div className={collapsed ? styles.logoCollapsed : styles.logo}>
          {collapsed ? "EF" : "EuraFlow"}
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          openKeys={openKeys}
          onOpenChange={handleOpenChange}
          items={menuItems}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 240 }}>
        <Content style={{ margin: "0 8px 0 0", padding: 0, background: "#f5f5f5" }}>
          {/* 路由级错误边界：隔离各页面错误，防止单个页面崩溃影响整体导航 */}
          <ErrorBoundary name="页面路由">
            <Suspense fallback={<PageLoading />}>
              <Routes>
                <Route
                  path="/"
                  element={
                    <DashboardHome
                      user={
                        user || {
                          id: 0,
                          username: "Guest",
                          role: "guest",
                          permissions: [],
                          is_active: false,
                          created_at: new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                        }
                      }
                      quickMenuItems={quickMenuItems}
                      removeQuickMenu={removeQuickMenu}
                      navigate={navigate}
                      iconMap={iconMap}
                      userMenuItems={userMenuItems}
                    />
                  }
                />
                <Route path="/ozon/*" element={<OzonManagement />} />
                <Route path="/finance" element={<FinanceCalculator />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/api-keys" element={<ApiKeys />} />
                {/* 系统管理路由 - 管理员和操作员都可以访问 */}
                {(user?.role === "admin" || user?.role === "operator") && (
                  <Route path="/system/*" element={<SystemManagement />} />
                )}
                {/* 用户管理路由 - 仅管理员可以访问 */}
                {user?.role === "admin" && (
                  <Route path="/users" element={<UserManagement />} />
                )}
              </Routes>
            </Suspense>
          </ErrorBoundary>
        </Content>
        {/* 全局悬浮快捷按钮 */}
        <QuickAccessButton />
      </Layout>
    </Layout>
  );
};

// 仪表板首页组件
interface DashboardHomeProps {
  user: User;
  quickMenuItems: Array<{ key: string; label: string; path: string }>;
  removeQuickMenu: (key: string) => void;
  navigate: (path: string) => void;
  iconMap: Record<string, React.ReactNode>;
  userMenuItems: Array<{ key: string; icon?: React.ReactNode; label: string; onClick?: () => void; type?: "divider" }>;
}

const DashboardHome: React.FC<DashboardHomeProps> = ({
  user,
  quickMenuItems,
  removeQuickMenu,
  navigate,
  iconMap,
  userMenuItems,
}) => {
  return (
    <div className={styles.pageWrapper}>
      {/* 用户信息在右上角 */}
      <div className={styles.header}>
        <Dropdown
          menu={{ items: userMenuItems }}
          placement="bottomRight"
          arrow
          trigger={["click"]}
        >
          <div className={styles.headerUserInfo}>
            <span className={styles.headerUsername}>
              {user?.username || "未设置"}
            </span>
            <Avatar size={32} icon={<UserOutlined />} />
          </div>
        </Dropdown>
      </div>

      <PageTitle icon={<DashboardOutlined />} title="系统状态" />

      <Title level={2} className={styles.welcomeTitle}>
        欢迎使用 EuraFlow 跨境电商管理平台
      </Title>

      <Row gutter={16} className={styles.statsRow}>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <p className={styles.cardLabel}>账户角色</p>
            <p className={styles.cardValue}>
              {user?.role || "未设置"}
            </p>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <p className={styles.cardLabel}>账户状态</p>
            <p className={user?.is_active ? styles.cardValueActive : styles.cardValueInactive}>
              {user?.is_active ? "活跃" : "未激活"}
            </p>
          </Card>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <Card>
            <p className={styles.cardLabel}>最后登录</p>
            <p className={styles.cardValueTime}>
              {user?.last_login_at
                ? new Date(user.last_login_at).toLocaleString("zh-CN")
                : "首次登录"}
            </p>
          </Card>
        </Col>
      </Row>

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
