/**
 * 字段配置Modal组件
 */
import { Modal, Space, Button, Divider, Typography } from 'antd';
import React from 'react';

import styles from '../../../pages/ozon/ProductSelection.module.scss';

const { Text } = Typography;

// 字段配置接口
export interface FieldConfig {
  brand: boolean;
  originalPrice: boolean;
  rfbsCommission: boolean;
  rfbsCommissionHigh: boolean; // rFBS高档佣金率（>5000₽）
  fbpCommission: boolean;
  fbpCommissionHigh: boolean; // FBP佣金率（高档>5000₽）
  monthlySales: boolean;
  weight: boolean;
  competitors: boolean;
  rating: boolean;
  listingDate: boolean; // 上架时间
}

// 默认字段配置（全部显示）
export const defaultFieldConfig: FieldConfig = {
  brand: true,
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
};

export interface FieldConfigModalProps {
  visible: boolean;
  fieldConfig: FieldConfig;
  onFieldConfigChange: (config: FieldConfig) => void;
  onSave: (config: FieldConfig) => void;
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
  const handleCheckboxChange = (field: keyof FieldConfig, checked: boolean) => {
    onFieldConfigChange({ ...fieldConfig, [field]: checked });
  };

  return (
    <Modal
      title="配置显示字段"
      open={visible}
      onOk={() => onSave(fieldConfig)}
      onCancel={onCancel}
      okText="保存"
      cancelText="取消"
      width={500}
    >
      <div className={styles.fieldConfigList}>
        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.brand}
              onChange={(e) => handleCheckboxChange('brand', e.target.checked)}
              id="field-brand"
            />
            <label htmlFor="field-brand">品牌</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.originalPrice}
              onChange={(e) => handleCheckboxChange('originalPrice', e.target.checked)}
              id="field-originalPrice"
            />
            <label htmlFor="field-originalPrice">原价和折扣</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.rfbsCommission}
              onChange={(e) => handleCheckboxChange('rfbsCommission', e.target.checked)}
              id="field-rfbsCommission"
            />
            <label htmlFor="field-rfbsCommission">rFBS佣金率（低档和中档）</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.rfbsCommissionHigh}
              onChange={(e) => handleCheckboxChange('rfbsCommissionHigh', e.target.checked)}
              id="field-rfbsCommissionHigh"
            />
            <label htmlFor="field-rfbsCommissionHigh">rFBS佣金率（高档&gt;5000₽）</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.fbpCommission}
              onChange={(e) => handleCheckboxChange('fbpCommission', e.target.checked)}
              id="field-fbpCommission"
            />
            <label htmlFor="field-fbpCommission">FBP佣金率（低档和中档）</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.fbpCommissionHigh}
              onChange={(e) => handleCheckboxChange('fbpCommissionHigh', e.target.checked)}
              id="field-fbpCommissionHigh"
            />
            <label htmlFor="field-fbpCommissionHigh">FBP佣金率（高档&gt;5000₽）</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.monthlySales}
              onChange={(e) => handleCheckboxChange('monthlySales', e.target.checked)}
              id="field-monthlySales"
            />
            <label htmlFor="field-monthlySales">月销量</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.weight}
              onChange={(e) => handleCheckboxChange('weight', e.target.checked)}
              id="field-weight"
            />
            <label htmlFor="field-weight">重量</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.competitors}
              onChange={(e) => handleCheckboxChange('competitors', e.target.checked)}
              id="field-competitors"
            />
            <label htmlFor="field-competitors">竞争对手信息</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.rating}
              onChange={(e) => handleCheckboxChange('rating', e.target.checked)}
              id="field-rating"
            />
            <label htmlFor="field-rating">评分和评价</label>
          </Space>
        </div>

        <div className={styles.fieldConfigItem}>
          <Space>
            <input
              type="checkbox"
              checked={fieldConfig.listingDate}
              onChange={(e) => handleCheckboxChange('listingDate', e.target.checked)}
              id="field-listingDate"
            />
            <label htmlFor="field-listingDate">上架时间</label>
          </Space>
        </div>
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
