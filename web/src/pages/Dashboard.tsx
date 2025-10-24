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
} from "antd";
import React, { Suspense, lazy, useState, useEffect } from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";

// 路由懒加载
const FinanceCalculator = lazy(() => import("./finance"));
const OzonManagement = lazy(() => import("./ozon"));
const SystemManagement = lazy(() => import("./system"));
const Profile = lazy(() => import("./Profile"));
const UserManagement = lazy(() => import("./UserManagement"));

import styles from "./Dashboard.module.scss";

import PageTitle from "@/components/PageTitle";
import { useAuth } from "@/hooks/useAuth";
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

  const menuItems = [
    {
      key: "dashboard",
      icon: <DashboardOutlined />,
      label: "仪表板",
      onClick: () => navigate("/dashboard"),
    },
    {
      key: "finance",
      icon: <CalculatorOutlined />,
      label: "财务计算",
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
          label: "选品助手",
          onClick: () => navigate("/dashboard/ozon/selection"),
        },
        {
          key: "ozon-products-list",
          icon: <ShoppingOutlined />,
          label: "商品列表",
          onClick: () => navigate("/dashboard/ozon/products"),
        },
        {
          key: "ozon-listing",
          icon: <CloudUploadOutlined />,
          label: "商品上架",
          onClick: () => navigate("/dashboard/ozon/listing"),
        },
        {
          key: "ozon-promotions",
          icon: <DollarOutlined />,
          label: "促销活动",
          onClick: () => navigate("/dashboard/ozon/promotions"),
        },
        {
          key: "ozon-orders",
          icon: <ShoppingCartOutlined />,
          label: "订单管理",
          onClick: () => navigate("/dashboard/ozon/orders"),
        },
        {
          key: "ozon-packing",
          icon: <ShoppingCartOutlined />,
          label: "打包发货",
          onClick: () => navigate("/dashboard/ozon/packing"),
        },
        {
          key: "ozon-reports",
          icon: <FileTextOutlined />,
          label: "订单报表",
          onClick: () => navigate("/dashboard/ozon/reports"),
        },
        {
          key: "ozon-finance-transactions",
          icon: <DollarOutlined />,
          label: "财务交易",
          onClick: () => navigate("/dashboard/ozon/finance-transactions"),
        },
        {
          key: "ozon-chats",
          icon: <MessageOutlined />,
          label: "聊天管理",
          onClick: () => navigate("/dashboard/ozon/chats"),
        },
        {
          key: "ozon-watermark",
          icon: <PictureOutlined />,
          label: "水印管理",
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
                label: "后台服务",
                onClick: () => navigate("/dashboard/system/sync-services"),
              },
              {
                key: "system-configuration",
                icon: <SettingOutlined />,
                label: "系统配置",
                onClick: () => navigate("/dashboard/system/configuration"),
              },
            ],
          },
          {
            key: "users",
            icon: <UserOutlined />,
            label: "用户管理",
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
        </Content>
      </Layout>
    </Layout>
  );
};

// 仪表板首页组件
const DashboardHome: React.FC<{ user: User }> = ({ user }) => {
  return (
    <div>
      <PageTitle icon={<DashboardOutlined />} title="系统状态" />

      <Card>
        <div style={{ padding: "40px 20px", textAlign: "center" }}>
          <Title level={2} style={{ marginBottom: 40 }}>
            欢迎使用 EuraFlow 跨境电商管理平台
          </Title>

          <Row gutter={[16, 24]} justify="center">
            <Col xs={24} sm={12} md={8}>
              <Card type="inner">
                <p style={{ marginBottom: 8, color: "#999" }}>账户角色</p>
                <p style={{ fontSize: 18, fontWeight: "bold" }}>
                  {user?.role || "未设置"}
                </p>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Card type="inner">
                <p style={{ marginBottom: 8, color: "#999" }}>账户状态</p>
                <p
                  style={{
                    fontSize: 18,
                    fontWeight: "bold",
                    color: user?.is_active ? "#52c41a" : "#f5222d",
                  }}
                >
                  {user?.is_active ? "活跃" : "未激活"}
                </p>
              </Card>
            </Col>
            <Col xs={24} sm={12} md={8}>
              <Card type="inner">
                <p style={{ marginBottom: 8, color: "#999" }}>最后登录</p>
                <p style={{ fontSize: 16, fontWeight: "bold" }}>
                  {user?.last_login_at
                    ? new Date(user.last_login_at).toLocaleString("zh-CN")
                    : "首次登录"}
                </p>
              </Card>
            </Col>
          </Row>
        </div>
      </Card>
    </div>
  );
};

export default Dashboard;
