/**
 * Ozon 管理主页面
 */
import { Spin } from "antd";
import React, { Suspense } from "react";
import { Routes, Route } from "react-router-dom";
import { lazyWithRetry } from "@/utils/lazyWithRetry";

// 路由懒加载 - 使用带重试机制的加载器防止chunk加载失败
const OzonOverview = lazyWithRetry(() => import("./OzonOverview"));
const OrderList = lazyWithRetry(() => import("./OrderList"));
const PackingShipment = lazyWithRetry(() => import("./PackingShipment"));
const OrderReport = lazyWithRetry(() => import("./OrderReport"));
const FinanceTransactions = lazyWithRetry(() => import("./FinanceTransactions"));
const ProductList = lazyWithRetry(() => import("./ProductList"));
const ProductListing = lazyWithRetry(() => import("./ProductListing"));
const ProductCreate = lazyWithRetry(() => import("./ProductCreate"));
const ProductSelection = lazyWithRetry(() => import("./ProductSelection"));
const ListingRecords = lazyWithRetry(() => import("./ListingRecords"));
const CollectionRecords = lazyWithRetry(() => import("./CollectionRecords"));
const ChatList = lazyWithRetry(() => import("./ChatList"));
const ChatDetail = lazyWithRetry(() => import("./ChatDetail"));
const Promotions = lazyWithRetry(() => import("./Promotions"));

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

const OzonManagement: React.FC = () => {
  return (
    <Suspense fallback={<PageLoading />}>
      <Routes>
        <Route path="overview" element={<OzonOverview />} />
        <Route path="selection" element={<ProductSelection />} />
        <Route path="products" element={<ProductList />} />
        <Route path="products/create" element={<ProductCreate />} />
        <Route path="listing" element={<ProductListing />} />
        <Route path="listing-records" element={<ListingRecords />} />
        <Route path="collection-records" element={<CollectionRecords />} />
        <Route path="promotions" element={<Promotions />} />
        <Route path="orders" element={<OrderList />} />
        <Route path="packing" element={<PackingShipment />} />
        <Route path="reports" element={<OrderReport />} />
        <Route path="finance-transactions" element={<FinanceTransactions />} />
        <Route path="chats" element={<ChatList />} />
        <Route path="chat/:chatId" element={<ChatDetail />} />
      </Routes>
    </Suspense>
  );
};

export default OzonManagement;
