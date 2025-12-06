/**
 * 订单进度时间线组件
 * 显示订单生命周期各节点的完成状态
 */
import React, { useMemo } from 'react';
import { Typography } from 'antd';

import { useDateTime } from '@/hooks/useDateTime';

import styles from './OrderProgressTimeline.module.scss';

const { Text } = Typography;

interface OrderProgressTimelineProps {
  orderedAt?: string; // 下单时间
  purchasePriceUpdatedAt?: string; // 备货时间（录入进货信息）
  trackingSyncedAt?: string; // 国际单号同步时间
  domesticTrackingUpdatedAt?: string; // 国内单号更新时间
  labelPrintedAt?: string; // 发货时间（打印标签）
  shippedAt?: string; // 运输时间
  deliveredAt?: string; // 签收时间
  cancelledAt?: string; // 取消时间
}

// 节点定义（不包括取消）
const MILESTONES = [
  { key: 'ordered', label: '下单' },
  { key: 'stocked', label: '备货' },
  { key: 'tracking', label: '国际单号' },
  { key: 'domestic', label: '国内单号' },
  { key: 'printed', label: '发货' },
  { key: 'shipped', label: '运输' },
  { key: 'delivered', label: '签收' },
] as const;

type MilestoneKey = (typeof MILESTONES)[number]['key'];

interface MilestoneData {
  key: MilestoneKey | 'cancelled';
  label: string;
  time: string | null;
  status: 'completed' | 'current' | 'pending';
}

const OrderProgressTimeline: React.FC<OrderProgressTimelineProps> = ({
  orderedAt,
  purchasePriceUpdatedAt,
  trackingSyncedAt,
  domesticTrackingUpdatedAt,
  labelPrintedAt,
  shippedAt,
  deliveredAt,
  cancelledAt,
}) => {
  const { formatDateTime } = useDateTime();

  // 构建节点数据
  const milestones = useMemo<MilestoneData[]>(() => {
    const timeMap: Record<MilestoneKey, string | undefined> = {
      ordered: orderedAt,
      stocked: purchasePriceUpdatedAt,
      tracking: trackingSyncedAt,
      domestic: domesticTrackingUpdatedAt,
      printed: labelPrintedAt,
      shipped: shippedAt,
      delivered: deliveredAt,
    };

    const result: MilestoneData[] = [];
    let lastCompletedIndex = -1;

    // 找到最后一个完成的节点索引
    MILESTONES.forEach((milestone, index) => {
      if (timeMap[milestone.key]) {
        lastCompletedIndex = index;
      }
    });

    // 构建节点状态
    MILESTONES.forEach((milestone, index) => {
      const time = timeMap[milestone.key];
      let status: 'completed' | 'current' | 'pending';

      if (time) {
        if (index === lastCompletedIndex) {
          status = 'current'; // 最新完成节点 → 红色
        } else {
          status = 'completed'; // 已完成节点 → 绿色
        }
      } else {
        status = 'pending'; // 待完成节点 → 灰色
      }

      result.push({
        key: milestone.key,
        label: milestone.label,
        time: time || null,
        status,
      });
    });

    return result;
  }, [
    orderedAt,
    purchasePriceUpdatedAt,
    trackingSyncedAt,
    domesticTrackingUpdatedAt,
    labelPrintedAt,
    shippedAt,
    deliveredAt,
  ]);

  // 格式化时间显示
  const formatTime = (time: string | null): string => {
    if (!time) return '';
    return formatDateTime(time, 'MM-DD HH:mm');
  };

  // 获取节点样式类
  const getNodeClass = (status: 'completed' | 'current' | 'pending'): string => {
    switch (status) {
      case 'completed':
        return styles.nodeCompleted;
      case 'current':
        return styles.nodeCurrent;
      case 'pending':
        return styles.nodePending;
    }
  };

  // 获取连线样式类
  const getLineClass = (
    currentStatus: 'completed' | 'current' | 'pending',
    nextStatus: 'completed' | 'current' | 'pending'
  ): string => {
    // 如果当前节点和下一个节点都是已完成/当前状态，使用实线
    if (
      (currentStatus === 'completed' || currentStatus === 'current') &&
      (nextStatus === 'completed' || nextStatus === 'current')
    ) {
      return styles.lineSolid;
    }
    // 否则使用虚线
    return styles.lineDashed;
  };

  return (
    <div className={styles.container}>
      {/* 正常流程节点 */}
      <div className={styles.timeline}>
        {milestones.map((milestone, index) => (
          <React.Fragment key={milestone.key}>
            {/* 节点 */}
            <div className={styles.milestone}>
              <div className={`${styles.node} ${getNodeClass(milestone.status)}`} />
              <div className={styles.content}>
                <div className={styles.label}>{milestone.label}</div>
                {milestone.time && (
                  <div className={styles.time}>{formatTime(milestone.time)}</div>
                )}
              </div>
            </div>

            {/* 连线（最后一个节点不需要连线） */}
            {index < milestones.length - 1 && (
              <div
                className={`${styles.line} ${getLineClass(milestone.status, milestones[index + 1].status)}`}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* 取消节点（如果存在） */}
      {cancelledAt && (
        <div className={styles.cancelSection}>
          <div className={styles.cancelLine} />
          <div className={styles.milestone}>
            <div className={`${styles.node} ${styles.nodeCancelled}`} />
            <div className={styles.content}>
              <div className={styles.label}>
                <Text type="danger">取消</Text>
              </div>
              <div className={styles.time}>{formatTime(cancelledAt)}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderProgressTimeline;
