/**
 * SKU 分组卡片组件
 * 用于在"等待备货"标签页中按 SKU 分组显示商品
 */
import React from 'react';
import { Badge } from 'antd';
import { ShoppingCartOutlined } from '@ant-design/icons';
import { optimizeOzonImageUrl } from '@/utils/ozonImageOptimizer';
import type { PostingWithOrder } from '@/services/ozon/types/order';
import styles from '@/pages/ozon/PackingShipment.module.scss';

export interface SkuGroup {
  sku: string;
  productName: string;
  productImage: string | null;
  postings: PostingWithOrder[];
  totalQuantity: number;
}

interface SkuGroupCardProps {
  group: SkuGroup;
  onClick: () => void;
}

const SkuGroupCard: React.FC<SkuGroupCardProps> = ({ group, onClick }) => {
  const imageUrl = group.productImage ? optimizeOzonImageUrl(group.productImage, 160) : null;

  return (
    <div className={styles.skuGroupCard} onClick={onClick}>
      <Badge count={group.totalQuantity} offset={[-5, 5]}>
        <div className={styles.skuGroupImageWrapper}>
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={group.productName}
              className={styles.skuGroupImage}
            />
          ) : (
            <div className={styles.skuGroupPlaceholder}>
              <ShoppingCartOutlined />
            </div>
          )}
        </div>
      </Badge>
    </div>
  );
};

export default SkuGroupCard;
