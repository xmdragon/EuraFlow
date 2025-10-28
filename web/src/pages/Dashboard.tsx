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
  AppstoreOutlined,
  PlusOutlined,
  CheckOutlined,
  CloseOutlined,
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
  Space,
} from "antd";
import React, { Suspense, useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";

import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载（带重试机制，处理HMR更新导致的模块失效）
const FinanceCalculator = lazyWithRetry(() => import("./finance"));
const OzonManagement = lazyWithRetry(() => import("./ozon"));
const SystemManagement = lazyWithRetry(() => import("./system"));
const Profile = lazyWithRetry(() => import("./Profile"));
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

  // 保存折叠状态到 localStorage
  useEffect(() => {
    localStorage.setItem("sidebarCollapsed", JSON.stringify(collapsed));
  }, [collapsed]);

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
          key: "ozon-listing",
          icon: <CloudUploadOutlined />,
          label: createMenuLabel("ozon-listing", "商品上架", "/dashboard/ozon/listing"),
          onClick: () => navigate("/dashboard/ozon/listing"),
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
        {
          key: "ozon-watermark",
          icon: <PictureOutlined />,
          label: createMenuLabel("ozon-watermark", "水印管理", "/dashboard/ozon/watermark"),
          onClick: () => navigate("/dashboard/ozon/watermark"),
        },
      ],
    },
    ...(user?.role === "admin"
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
            ],
          },
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
    if (path.includes("/ozon/selection")) return "ozon-selection";
    if (path.includes("/ozon/products/create")) return "ozon-products-create";
    if (path.includes("/ozon/products")) return "ozon-products-list";
    if (path.includes("/ozon/listing")) return "ozon-listing";
    if (path.includes("/ozon/promotions")) return "ozon-promotions";
    if (path.includes("/ozon/packing")) return "ozon-packing";
    if (path.includes("/ozon/orders")) return "ozon-orders";
    if (path.includes("/ozon/reports")) return "ozon-reports";
    if (path.includes("/ozon/finance-transactions"))
      return "ozon-finance-transactions";
    if (path.includes("/ozon/chat")) return "ozon-chats";
    if (path.includes("/ozon/watermark")) return "ozon-watermark";
    if (path.includes("/system/configuration")) return "system-configuration";
    if (path.includes("/system/sync-services")) return "system-sync-services";
    if (path.includes("/finance")) return "finance";
    if (path.includes("/users")) return "users";
    if (path.includes("/profile")) return "profile";
    return "dashboard";
  };

  // 根据路径获取展开的子菜单
  const getOpenKeys = () => {
    const path = location.pathname;
    if (path.includes("/ozon")) return ["ozon"];
    if (path.includes("/system")) return ["system"];
    return [];
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

        <div
          className={
            collapsed ? styles.userProfileCollapsed : styles.userProfile
          }
        >
          <Dropdown
            menu={{ items: userMenuItems }}
            placement="bottomRight"
            arrow
            trigger={["click"]}
          >
            <div className={styles.userInfo}>
              <Avatar
                className={styles.userAvatar}
                size={collapsed ? 36 : 40}
                icon={<UserOutlined />}
              />
              {!collapsed && (
                <div className={styles.userDetails}>
                  <p className={styles.username}>
                    {user?.username || "未设置"}
                  </p>
                </div>
              )}
            </div>
          </Dropdown>
        </div>

        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[getSelectedKey()]}
          defaultOpenKeys={getOpenKeys()}
          items={menuItems}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 240 }}>
        <Content style={{ margin: 0, padding: 0, background: "#f5f5f5" }}>
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
                    />
                  }
                />
                <Route path="/ozon/*" element={<OzonManagement />} />
                <Route path="/finance" element={<FinanceCalculator />} />
                <Route path="/profile" element={<Profile />} />
                {user?.role === "admin" && (
                  <>
                    <Route path="/system/*" element={<SystemManagement />} />
                    <Route path="/users" element={<UserManagement />} />
                  </>
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
}

const DashboardHome: React.FC<DashboardHomeProps> = ({
  user,
  quickMenuItems,
  removeQuickMenu,
  navigate,
  iconMap,
}) => {
  return (
    <div>
      <PageTitle icon={<DashboardOutlined />} title="系统状态" />

      <Card>
        <div className={styles.welcomeSection}>
          <Title level={2} className={styles.welcomeTitle}>
            欢迎使用 EuraFlow 跨境电商管理平台
          </Title>

          <Row gutter={[16, 24]} justify="center">
            <Col xs={24} sm={12} md={8}>
              <Card type="inner">
                <p className={styles.cardLabel}>账户角色</p>
                <p className={styles.cardValue}>
                  {user?.role || "未设置"}
                </p>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Card type="inner">
                <p className={styles.cardLabel}>账户状态</p>
                <p className={user?.is_active ? styles.cardValueActive : styles.cardValueInactive}>
                  {user?.is_active ? "活跃" : "未激活"}
                </p>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Card type="inner">
                <p className={styles.cardLabel}>最后登录</p>
                <p className={styles.cardValueTime}>
                  {user?.last_login_at
                    ? new Date(user.last_login_at).toLocaleString("zh-CN")
                    : "首次登录"}
                </p>
              </Card>
            </Col>
          </Row>
        </div>
      </Card>

      {/* 快捷菜单区域 */}
      {quickMenuItems.length > 0 && (
        <Card className={styles.quickMenuContainer}>
          <Title level={4}>快捷菜单</Title>
          <Row gutter={[16, 16]}>
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
        </Card>
      )}
    </div>
  );
};

export default Dashboard;
