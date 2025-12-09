/**
 * 货件拆分弹窗组件
 * 用于将一个货件拆分为多个不带备货的货件
 */
import {
  ScissorOutlined,
  DownOutlined,
  UpOutlined,
  PlusOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Card,
  Button,
  Space,
  Typography,
  Image,
  Empty,
  Tooltip,
} from 'antd';
import axios from 'axios';
import React, { useState, useEffect, useMemo } from 'react';

import type { PostingWithOrder, SplitPostingRequest } from '@/services/ozon/types/order';
import * as ozonApi from '@/services/ozon';
import { notifySuccess, notifyError } from '@/utils/notification';

const { Text } = Typography;

interface SplitPostingModalProps {
  visible: boolean;
  onCancel: () => void;
  posting: PostingWithOrder | null;
  onSuccess?: () => void;
}

// 商品信息（从 posting 中提取）
interface ProductInfo {
  sku: string;
  name: string;
  image: string;
  totalQuantity: number; // 原始总数量
}

// 拆分分配状态：每个 SKU 保留在原货件的数量
type AllocationState = Record<string, number>;

const SplitPostingModal: React.FC<SplitPostingModalProps> = ({
  visible,
  onCancel,
  posting,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  // allocation[sku] = 保留在原货件的数量
  const [allocation, setAllocation] = useState<AllocationState>({});

  // 从 posting 中提取商品信息
  const products: ProductInfo[] = useMemo(() => {
    if (!posting?.products) return [];
    return posting.products
      .filter((p) => p.sku && p.quantity > 0)
      .map((p) => ({
        sku: p.sku || '',
        name: p.name || '',
        image: p.image || '',
        totalQuantity: p.quantity,
      }));
  }, [posting]);

  // 初始化分配状态：所有商品全部在原货件
  useEffect(() => {
    if (visible && posting) {
      const initial: AllocationState = {};
      products.forEach((p) => {
        initial[p.sku] = p.totalQuantity;
      });
      setAllocation(initial);
    } else {
      setAllocation({});
    }
  }, [visible, posting, products]);

  // 计算拆分件的数量
  const getSplitQuantity = (sku: string, total: number): number => {
    const remaining = allocation[sku] ?? total;
    return total - remaining;
  };

  // 检查是否有有效的拆分（原货件和拆分件都有商品）
  const isValidSplit = useMemo(() => {
    let originalHasItems = false;
    let splitHasItems = false;

    products.forEach((p) => {
      const remaining = allocation[p.sku] ?? p.totalQuantity;
      const splitQty = p.totalQuantity - remaining;
      if (remaining > 0) originalHasItems = true;
      if (splitQty > 0) splitHasItems = true;
    });

    return originalHasItems && splitHasItems;
  }, [products, allocation]);

  // 从原货件移动一件到拆分件
  const moveToSplit = (sku: string) => {
    setAllocation((prev) => {
      const current = prev[sku] ?? 0;
      if (current <= 0) return prev;
      return { ...prev, [sku]: current - 1 };
    });
  };

  // 从拆分件移动一件回原货件
  const moveToOriginal = (sku: string, total: number) => {
    setAllocation((prev) => {
      const current = prev[sku] ?? total;
      if (current >= total) return prev;
      return { ...prev, [sku]: current + 1 };
    });
  };

  // 将所有商品移到拆分件
  const moveAllToSplit = (sku: string) => {
    setAllocation((prev) => ({ ...prev, [sku]: 0 }));
  };

  // 将所有商品移回原货件
  const moveAllToOriginal = (sku: string, total: number) => {
    setAllocation((prev) => ({ ...prev, [sku]: total }));
  };

  // 拆分 mutation
  const splitMutation = useMutation({
    mutationFn: () => {
      if (!posting) throw new Error('posting is null');

      // 构建请求：原货件 + 拆分件
      const originalProducts: { sku: string; quantity: number }[] = [];
      const splitProducts: { sku: string; quantity: number }[] = [];

      products.forEach((p) => {
        const remaining = allocation[p.sku] ?? p.totalQuantity;
        const splitQty = p.totalQuantity - remaining;

        if (remaining > 0) {
          originalProducts.push({ sku: p.sku, quantity: remaining });
        }
        if (splitQty > 0) {
          splitProducts.push({ sku: p.sku, quantity: splitQty });
        }
      });

      const request: SplitPostingRequest = {
        postings: [
          { products: originalProducts },
          { products: splitProducts },
        ],
      };

      return ozonApi.splitPosting(posting.posting_number, request);
    },
    onSuccess: () => {
      notifySuccess('货件拆分成功');
      queryClient.invalidateQueries({ queryKey: ['ozonOrders'] });
      queryClient.invalidateQueries({ queryKey: ['packingOrdersCount'] });
      queryClient.invalidateQueries({ queryKey: ['packingStats'] });
      if (onSuccess) {
        onSuccess();
      }
      onCancel();
    },
    onError: (error: unknown) => {
      const errorMsg = axios.isAxiosError(error)
        ? error.response?.data?.detail || error.message || '拆分失败'
        : error instanceof Error
          ? error.message
          : '拆分失败';
      notifyError('货件拆分失败', errorMsg);
    },
  });

  const handleSubmit = () => {
    if (!isValidSplit) {
      notifyError('无效的拆分', '原货件和拆分件都必须至少有1件商品');
      return;
    }
    splitMutation.mutate();
  };

  if (!posting) return null;

  // 计算原货件和拆分件的商品
  const originalItems = products.filter((p) => (allocation[p.sku] ?? p.totalQuantity) > 0);
  const splitItems = products.filter((p) => getSplitQuantity(p.sku, p.totalQuantity) > 0);

  return (
    <Modal
      title={
        <Space>
          <ScissorOutlined style={{ color: '#1890ff' }} />
          <span>拆分货件 - {posting.posting_number}</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={splitMutation.isPending}
      okText="确认拆分"
      cancelText="取消"
      width={520}
      okButtonProps={{
        disabled: !isValidSplit,
      }}
    >
      {/* 原货件 */}
      <Card
        title="原货件"
        size="small"
        style={{ marginBottom: 8 }}
        styles={{ body: { padding: '12px', minHeight: 220 } }}
      >
        {originalItems.length === 0 ? (
          <Empty description="无商品" style={{ padding: '40px 0' }} />
        ) : (
          <Space wrap size={[16, 16]}>
            {originalItems.map((product) => {
              const remaining = allocation[product.sku] ?? product.totalQuantity;
              const canMoveDown = remaining > 0;
              return (
                <div
                  key={product.sku}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: 160,
                  }}
                >
                  <Image
                    src={product.image || 'https://via.placeholder.com/160?text=No+Image'}
                    alt={product.name}
                    width={160}
                    height={160}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    fallback="https://via.placeholder.com/160?text=No+Image"
                    preview={false}
                  />
                  <div style={{ marginTop: 8, textAlign: 'center' }}>
                    <Space>
                      <Button
                        size="small"
                        icon={<MinusOutlined />}
                        onClick={() => moveToSplit(product.sku)}
                        disabled={!canMoveDown}
                      />
                      <Text strong style={{ minWidth: 24, textAlign: 'center', display: 'inline-block' }}>
                        {remaining}
                      </Text>
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => moveToOriginal(product.sku, product.totalQuantity)}
                        disabled={remaining >= product.totalQuantity}
                      />
                      <Tooltip title="全部移至拆分件">
                        <Button
                          size="small"
                          icon={<DownOutlined />}
                          onClick={() => moveAllToSplit(product.sku)}
                          disabled={!canMoveDown}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                </div>
              );
            })}
          </Space>
        )}
      </Card>

      {/* 上下箭头分隔 */}
      <div style={{ textAlign: 'center', margin: '4px 0' }}>
        <Space>
          <UpOutlined style={{ fontSize: 16, color: '#1890ff' }} />
          <DownOutlined style={{ fontSize: 16, color: '#1890ff' }} />
        </Space>
      </div>

      {/* 拆分件 */}
      <Card
        title="拆分件"
        size="small"
        styles={{ body: { padding: '12px', minHeight: 220 } }}
      >
        {splitItems.length === 0 ? (
          <Empty description="点击上方 - 或 ↓ 按钮移动商品到这里" style={{ padding: '40px 0' }} />
        ) : (
          <Space wrap size={[16, 16]}>
            {splitItems.map((product) => {
              const splitQty = getSplitQuantity(product.sku, product.totalQuantity);
              const canMoveUp = splitQty > 0;
              return (
                <div
                  key={product.sku}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    width: 160,
                  }}
                >
                  <Image
                    src={product.image || 'https://via.placeholder.com/160?text=No+Image'}
                    alt={product.name}
                    width={160}
                    height={160}
                    style={{ objectFit: 'cover', borderRadius: 4 }}
                    fallback="https://via.placeholder.com/160?text=No+Image"
                    preview={false}
                  />
                  <div style={{ marginTop: 8, textAlign: 'center' }}>
                    <Space>
                      <Button
                        size="small"
                        icon={<MinusOutlined />}
                        onClick={() => moveToOriginal(product.sku, product.totalQuantity)}
                        disabled={!canMoveUp}
                      />
                      <Text strong style={{ minWidth: 24, textAlign: 'center', display: 'inline-block' }}>
                        {splitQty}
                      </Text>
                      <Button
                        size="small"
                        icon={<PlusOutlined />}
                        onClick={() => moveToSplit(product.sku)}
                        disabled={splitQty >= product.totalQuantity}
                      />
                      <Tooltip title="全部移回原货件">
                        <Button
                          size="small"
                          icon={<UpOutlined />}
                          onClick={() => moveAllToOriginal(product.sku, product.totalQuantity)}
                          disabled={!canMoveUp}
                        />
                      </Tooltip>
                    </Space>
                  </div>
                </div>
              );
            })}
          </Space>
        )}
      </Card>
    </Modal>
  );
};

export default SplitPostingModal;
