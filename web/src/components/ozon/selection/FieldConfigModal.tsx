/* eslint-disable no-unused-vars */
/**
 * 字段配置Modal组件
 */
import { Modal, Space, Button, Divider, Typography, Row, Col } from 'antd';
import React, { useState, useEffect } from 'react';

import styles from '../../../pages/ozon/ProductSelection.module.scss';

const { Text } = Typography;

// 字段配置接口
export interface FieldConfig {
  _version?: number;                 // 配置版本号，用于检测兼容性
  // 现有字段
  brand: boolean;
  category: boolean;                 // 类目
  originalPrice: boolean;
  rfbsCommission: boolean;
  rfbsCommissionHigh: boolean;
  fbpCommission: boolean;
  fbpCommissionHigh: boolean;
  monthlySales: boolean;
  weight: boolean;
  competitors: boolean;
  rating: boolean;
  listingDate: boolean;

  // 新增字段
  monthlySalesRevenue: boolean;      // 月销售额
  dailySales: boolean;               // 日销量+日销售额
  salesDynamic: boolean;             // 销售动态+点击率
  cardMetrics: boolean;              // 卡片浏览+加购率
  searchMetrics: boolean;            // 搜索浏览+加购率
  promoMetrics: boolean;             // 促销天数+折扣+转化率
  paidPromo: boolean;                // 付费推广+份额
  conversionMetrics: boolean;        // 成交率+退货率
  avgPrice: boolean;                 // 平均价格
  dimensions: boolean;               // 包装尺寸
  sellerMode: boolean;               // 发货模式
}

// 配置版本号（每次添加新字段时需要递增）
export const FIELD_CONFIG_VERSION = 2;

// 默认字段配置（全部显示）
export const defaultFieldConfig: FieldConfig = {
  _version: FIELD_CONFIG_VERSION,
  // 现有字段默认值
  brand: true,
  category: true,
  originalPrice: true,
  rfbsCommission: true,
  rfbsCommissionHigh: true,
  fbpCommission: true,
  fbpCommissionHigh: true,
  monthlySales: true,
  weight: true,
  competitors: true,
  rating: true,
  listingDate: true,

  // 新增字段默认值（全部显示）
  monthlySalesRevenue: true,
  dailySales: true,
  salesDynamic: true,
  cardMetrics: true,
  searchMetrics: true,
  promoMetrics: true,
  paidPromo: true,
  conversionMetrics: true,
  avgPrice: true,
  dimensions: true,
  sellerMode: true,
};

export interface FieldConfigModalProps {
  visible: boolean;
  fieldConfig: FieldConfig;
  onFieldConfigChange: (_newConfig: FieldConfig) => void;
  onSave: (_configToSave: FieldConfig) => void;
  onReset: () => void;
  onCancel: () => void;
}

export const FieldConfigModal: React.FC<FieldConfigModalProps> = ({
  visible,
  fieldConfig,
  onFieldConfigChange,
  onSave,
  onReset,
  onCancel,
}) => {
  // 内部状态管理 - 用于实时预览配置变更
  const [localConfig, setLocalConfig] = useState<FieldConfig>(fieldConfig);

  // 同步外部配置（当 Modal 打开时）
  useEffect(() => {
    if (visible) {
      setLocalConfig(fieldConfig);
    }
  }, [visible, fieldConfig]);

  const handleCheckboxChange = (field: keyof FieldConfig, checked: boolean) => {
    setLocalConfig({ ...localConfig, [field]: checked });
  };

  return (
    <Modal
      title="配置显示字段"
      open={visible}
      onOk={() => onSave(localConfig)}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={600}
      styles={{ body: { overflowX: 'hidden', maxHeight: '60vh', overflowY: 'auto' } }}
    >
      <div className={styles.fieldConfigList}>
        {/* 第一行：品牌、类目和原价 */}
        <div style={{ marginBottom: '12px' }}>
          <Space size={16}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.brand}
                onChange={(e) => handleCheckboxChange('brand', e.target.checked)}
                id="field-brand"
              />
              <label htmlFor="field-brand">品牌</label>
            </Space>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.category}
                onChange={(e) => handleCheckboxChange('category', e.target.checked)}
                id="field-category"
              />
              <label htmlFor="field-category">类目</label>
            </Space>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.originalPrice}
                onChange={(e) => handleCheckboxChange('originalPrice', e.target.checked)}
                id="field-originalPrice"
              />
              <label htmlFor="field-originalPrice">原价和折扣</label>
            </Space>
          </Space>
        </div>

        <Divider style={{ margin: '12px 0' }} />

        {/* 两列布局 */}
        <Row gutter={[16, 12]}>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.rfbsCommission}
                onChange={(e) => handleCheckboxChange('rfbsCommission', e.target.checked)}
                id="field-rfbsCommission"
              />
              <label htmlFor="field-rfbsCommission">rFBS佣金</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.fbpCommission}
                onChange={(e) => handleCheckboxChange('fbpCommission', e.target.checked)}
                id="field-fbpCommission"
              />
              <label htmlFor="field-fbpCommission">FBP佣金</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.monthlySales}
                onChange={(e) => handleCheckboxChange('monthlySales', e.target.checked)}
                id="field-monthlySales"
              />
              <label htmlFor="field-monthlySales">月销量+销售额</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.dailySales}
                onChange={(e) => handleCheckboxChange('dailySales', e.target.checked)}
                id="field-dailySales"
              />
              <label htmlFor="field-dailySales">日销量+销售额</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.salesDynamic}
                onChange={(e) => handleCheckboxChange('salesDynamic', e.target.checked)}
                id="field-salesDynamic"
              />
              <label htmlFor="field-salesDynamic">销售动态+点击率</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.cardMetrics}
                onChange={(e) => handleCheckboxChange('cardMetrics', e.target.checked)}
                id="field-cardMetrics"
              />
              <label htmlFor="field-cardMetrics">卡片浏览+加购率</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.searchMetrics}
                onChange={(e) => handleCheckboxChange('searchMetrics', e.target.checked)}
                id="field-searchMetrics"
              />
              <label htmlFor="field-searchMetrics">搜索浏览+加购率</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.promoMetrics}
                onChange={(e) => handleCheckboxChange('promoMetrics', e.target.checked)}
                id="field-promoMetrics"
              />
              <label htmlFor="field-promoMetrics">促销天数+折扣+转化率</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.paidPromo}
                onChange={(e) => handleCheckboxChange('paidPromo', e.target.checked)}
                id="field-paidPromo"
              />
              <label htmlFor="field-paidPromo">付费推广+份额</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.conversionMetrics}
                onChange={(e) => handleCheckboxChange('conversionMetrics', e.target.checked)}
                id="field-conversionMetrics"
              />
              <label htmlFor="field-conversionMetrics">成交率+退货率</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.avgPrice}
                onChange={(e) => handleCheckboxChange('avgPrice', e.target.checked)}
                id="field-avgPrice"
              />
              <label htmlFor="field-avgPrice">平均价格</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.weight}
                onChange={(e) => handleCheckboxChange('weight', e.target.checked)}
                id="field-weight"
              />
              <label htmlFor="field-weight">重量</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.dimensions}
                onChange={(e) => handleCheckboxChange('dimensions', e.target.checked)}
                id="field-dimensions"
              />
              <label htmlFor="field-dimensions">包装尺寸</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.sellerMode}
                onChange={(e) => handleCheckboxChange('sellerMode', e.target.checked)}
                id="field-sellerMode"
              />
              <label htmlFor="field-sellerMode">发货模式</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.competitors}
                onChange={(e) => handleCheckboxChange('competitors', e.target.checked)}
                id="field-competitors"
              />
              <label htmlFor="field-competitors">竞争对手信息</label>
            </Space>
          </Col>
          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.rating}
                onChange={(e) => handleCheckboxChange('rating', e.target.checked)}
                id="field-rating"
              />
              <label htmlFor="field-rating">评分和评价</label>
            </Space>
          </Col>

          <Col span={12}>
            <Space>
              <input
                type="checkbox"
                checked={localConfig.listingDate}
                onChange={(e) => handleCheckboxChange('listingDate', e.target.checked)}
                id="field-listingDate"
              />
              <label htmlFor="field-listingDate">上架时间</label>
            </Space>
          </Col>
        </Row>
      </div>

      <Divider />

      <Space>
        <Button onClick={onReset} size="small">
          恢复默认
        </Button>
        <Text type="secondary" style={{ fontSize: '12px' }}>
          注意：商品名称和当前价格始终显示
        </Text>
      </Space>
    </Modal>
  );
};

export default FieldConfigModal;
