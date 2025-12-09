/**
 * 货件拆分弹窗组件
 * 用于将一个货件拆分为多个不带备货的货件
 */
import {
  ScissorOutlined,
  PlusOutlined,
  DeleteOutlined,
  MinusOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Modal,
  Card,
  Button,
  InputNumber,
  Space,
  Alert,
  Typography,
  Divider,
  Empty,
  Tag,
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
  product_id: number;
  sku: string;
  name: string;
  quantity: number; // 原始数量
}

// 新货件中的商品分配
interface NewPostingProduct {
  product_id: number;
  quantity: number;
}

// 新货件
interface NewPosting {
  id: string; // 临时 ID
  products: NewPostingProduct[];
}

const SplitPostingModal: React.FC<SplitPostingModalProps> = ({
  visible,
  onCancel,
  posting,
  onSuccess,
}) => {
  const queryClient = useQueryClient();
  const [newPostings, setNewPostings] = useState<NewPosting[]>([]);

  // 从 posting 中提取商品信息
  const products: ProductInfo[] = useMemo(() => {
    if (!posting?.products) return [];
    return posting.products
      .filter((p) => p.product_id != null && p.quantity > 0)
      .map((p) => ({
        product_id: p.product_id!,
        sku: p.sku || '',
        name: p.name || '',
        quantity: p.quantity,
      }));
  }, [posting]);

  // 计算每个商品的已分配数量
  const allocatedQuantities = useMemo(() => {
    const allocated: Record<number, number> = {};
    products.forEach((p) => {
      allocated[p.product_id] = 0;
    });
    newPostings.forEach((np) => {
      np.products.forEach((p) => {
        if (allocated[p.product_id] !== undefined) {
          allocated[p.product_id] += p.quantity;
        }
      });
    });
    return allocated;
  }, [products, newPostings]);

  // 计算每个商品的剩余可分配数量
  const remainingQuantities = useMemo(() => {
    const remaining: Record<number, number> = {};
    products.forEach((p) => {
      remaining[p.product_id] = p.quantity - (allocatedQuantities[p.product_id] || 0);
    });
    return remaining;
  }, [products, allocatedQuantities]);

  // 检查是否所有商品都已完全分配
  const isFullyAllocated = useMemo(() => {
    return products.every((p) => remainingQuantities[p.product_id] === 0);
  }, [products, remainingQuantities]);

  // 检查是否有有效的拆分（至少2个货件，每个货件至少1个商品）
  const isValidSplit = useMemo(() => {
    if (newPostings.length < 2) return false;
    return newPostings.every(
      (np) => np.products.length > 0 && np.products.some((p) => p.quantity > 0)
    );
  }, [newPostings]);

  // 重置状态
  useEffect(() => {
    if (visible && posting) {
      // 初始化时创建两个空的新货件
      setNewPostings([
        { id: `new-${Date.now()}-1`, products: [] },
        { id: `new-${Date.now()}-2`, products: [] },
      ]);
    } else {
      setNewPostings([]);
    }
  }, [visible, posting]);

  // 添加新货件
  const addNewPosting = () => {
    setNewPostings((prev) => [...prev, { id: `new-${Date.now()}`, products: [] }]);
  };

  // 删除新货件
  const removeNewPosting = (postingId: string) => {
    setNewPostings((prev) => prev.filter((np) => np.id !== postingId));
  };

  // 添加商品到新货件
  const addProductToPosting = (postingId: string, productId: number) => {
    setNewPostings((prev) =>
      prev.map((np) => {
        if (np.id !== postingId) return np;
        // 检查是否已存在
        if (np.products.some((p) => p.product_id === productId)) return np;
        const remaining = remainingQuantities[productId] || 0;
        if (remaining <= 0) return np;
        return {
          ...np,
          products: [...np.products, { product_id: productId, quantity: 1 }],
        };
      })
    );
  };

  // 从新货件中移除商品
  const removeProductFromPosting = (postingId: string, productId: number) => {
    setNewPostings((prev) =>
      prev.map((np) => {
        if (np.id !== postingId) return np;
        return {
          ...np,
          products: np.products.filter((p) => p.product_id !== productId),
        };
      })
    );
  };

  // 更新商品数量
  const updateProductQuantity = (
    postingId: string,
    productId: number,
    quantity: number
  ) => {
    setNewPostings((prev) =>
      prev.map((np) => {
        if (np.id !== postingId) return np;
        return {
          ...np,
          products: np.products.map((p) =>
            p.product_id === productId ? { ...p, quantity } : p
          ),
        };
      })
    );
  };

  // 获取商品信息
  const getProductInfo = (productId: number): ProductInfo | undefined => {
    return products.find((p) => p.product_id === productId);
  };

  // 拆分 mutation
  const splitMutation = useMutation({
    mutationFn: () => {
      if (!posting) throw new Error('posting is null');

      const request: SplitPostingRequest = {
        postings: newPostings.map((np) => ({
          products: np.products
            .filter((p) => p.quantity > 0)
            .map((p) => ({
              product_id: p.product_id,
              quantity: p.quantity,
            })),
        })),
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
    if (!isFullyAllocated) {
      notifyError('请完成所有商品的分配', '所有商品数量必须被完全分配到新货件中');
      return;
    }
    if (!isValidSplit) {
      notifyError('无效的拆分配置', '至少需要2个货件，且每个货件至少包含1个商品');
      return;
    }
    splitMutation.mutate();
  };

  if (!posting) return null;

  return (
    <Modal
      title={
        <Space>
          <ScissorOutlined style={{ color: '#1890ff' }} />
          <span>拆分货件</span>
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      onOk={handleSubmit}
      confirmLoading={splitMutation.isPending}
      okText="确认拆分"
      cancelText="取消"
      width={700}
      okButtonProps={{
        disabled: !isFullyAllocated || !isValidSplit,
      }}
    >
      <Alert
        message={`货件号: ${posting.posting_number}`}
        description="将此货件拆分为多个独立货件。请为每个新货件分配商品数量，所有商品必须被完全分配。"
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* 商品列表 */}
      <Card
        title="商品列表"
        size="small"
        style={{ marginBottom: 16 }}
        bodyStyle={{ padding: '8px 12px' }}
      >
        {products.length === 0 ? (
          <Empty description="没有可拆分的商品" />
        ) : (
          products.map((product) => (
            <div
              key={product.product_id}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 0',
                borderBottom: '1px solid #f0f0f0',
              }}
            >
              <div>
                <Text strong>{product.sku}</Text>
                {product.name && (
                  <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                    {product.name}
                  </Text>
                )}
              </div>
              <div>
                <Tag color={remainingQuantities[product.product_id] === 0 ? 'success' : 'warning'}>
                  {remainingQuantities[product.product_id] === 0
                    ? '已分配完成'
                    : `剩余: ${remainingQuantities[product.product_id]} / ${product.quantity}`}
                </Tag>
              </div>
            </div>
          ))
        )}
      </Card>

      <Divider orientation="left">新货件分配</Divider>

      {/* 新货件列表 */}
      {newPostings.map((newPosting, index) => (
        <Card
          key={newPosting.id}
          title={`货件 ${index + 1}`}
          size="small"
          style={{ marginBottom: 12 }}
          extra={
            newPostings.length > 2 && (
              <Button
                type="text"
                danger
                size="small"
                icon={<DeleteOutlined />}
                onClick={() => removeNewPosting(newPosting.id)}
              >
                删除
              </Button>
            )
          }
        >
          {newPosting.products.length === 0 ? (
            <Empty description="点击下方按钮添加商品" style={{ padding: '12px 0' }} />
          ) : (
            newPosting.products.map((p) => {
              const productInfo = getProductInfo(p.product_id);
              if (!productInfo) return null;
              const maxQuantity =
                (remainingQuantities[p.product_id] || 0) + p.quantity;
              return (
                <div
                  key={p.product_id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '8px 0',
                    borderBottom: '1px solid #f0f0f0',
                  }}
                >
                  <div>
                    <Text>{productInfo.sku}</Text>
                  </div>
                  <Space>
                    <InputNumber
                      min={1}
                      max={maxQuantity}
                      value={p.quantity}
                      onChange={(value) =>
                        updateProductQuantity(newPosting.id, p.product_id, value || 1)
                      }
                      size="small"
                      style={{ width: 80 }}
                    />
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<MinusOutlined />}
                      onClick={() => removeProductFromPosting(newPosting.id, p.product_id)}
                    />
                  </Space>
                </div>
              );
            })
          )}

          {/* 添加商品按钮 */}
          <div style={{ marginTop: 8 }}>
            <Space wrap>
              {products
                .filter(
                  (product) =>
                    remainingQuantities[product.product_id] > 0 &&
                    !newPosting.products.some((p) => p.product_id === product.product_id)
                )
                .map((product) => (
                  <Button
                    key={product.product_id}
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => addProductToPosting(newPosting.id, product.product_id)}
                  >
                    {product.sku}
                  </Button>
                ))}
            </Space>
          </div>
        </Card>
      ))}

      {/* 添加新货件按钮 */}
      <Button
        type="dashed"
        block
        icon={<PlusOutlined />}
        onClick={addNewPosting}
        style={{ marginTop: 8 }}
      >
        添加货件
      </Button>

      {/* 验证提示 */}
      {!isFullyAllocated && (
        <Alert
          message="请完成所有商品的分配"
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
      {!isValidSplit && isFullyAllocated && (
        <Alert
          message="至少需要2个货件，且每个货件至少包含1个商品"
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
        />
      )}
    </Modal>
  );
};

export default SplitPostingModal;
