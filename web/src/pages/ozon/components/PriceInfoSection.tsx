/**
 * 商品创建页 - 价格信息区块
 */
import { Form, InputNumber, Row, Col, Input } from 'antd';
import React from 'react';

import styles from '../ProductCreate.module.scss';

import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';

export interface PriceInfoSectionProps {
  showSection: boolean; // 仅在没有变体时显示
}

export const PriceInfoSection: React.FC<PriceInfoSectionProps> = ({ showSection }) => {
  if (!showSection) {
    return null;
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>价格信息</h3>

      <Row gutter={16}>
        <Col span={12}>
          <Form.Item label="售价" required style={{ marginBottom: 12 }}>
            <Form.Item name="price" rules={[{ required: true, message: '请输入售价' }]} noStyle>
              <InputNumber
                min={0}
                placeholder="0"
                controls={false}
                formatter={getNumberFormatter(2)}
                parser={getNumberParser()}
                style={{ width: '150px' }}
              />
            </Form.Item>
          </Form.Item>
        </Col>

        <Col span={12}>
          <Form.Item label="原价（划线价）" style={{ marginBottom: 12 }}>
            <Form.Item name="old_price" noStyle>
              <InputNumber
                min={0}
                placeholder="0"
                controls={false}
                formatter={getNumberFormatter(2)}
                parser={getNumberParser()}
                style={{ width: '150px' }}
              />
            </Form.Item>
          </Form.Item>
        </Col>
      </Row>

      {/* 采购信息 */}
      <Row gutter={16}>
        <Col span={12}>
          <Form.Item
            label="建议采购价"
            name="suggested_purchase_price"
            tooltip="内部采购参考价格，用于打包发货时查看"
            style={{ marginBottom: 12 }}
          >
            <InputNumber
              min={0}
              placeholder="0"
              controls={false}
              formatter={getNumberFormatter(2)}
              parser={getNumberParser()}
              style={{ width: '150px' }}
            />
          </Form.Item>
        </Col>

        <Col span={12}>
          <Form.Item
            label="采购地址"
            name="purchase_url"
            tooltip="采购链接，在打包发货时可扫码打开"
            style={{ marginBottom: 12 }}
          >
            <Input placeholder="https://..." />
          </Form.Item>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={24}>
          <Form.Item
            label="采购备注"
            name="purchase_note"
            tooltip="采购相关备注，仅保存到本地"
            style={{ marginBottom: 12 }}
          >
            <Input placeholder="采购备注信息" maxLength={500} />
          </Form.Item>
        </Col>
      </Row>
    </div>
  );
};
