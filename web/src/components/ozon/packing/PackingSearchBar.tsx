/**
 * 打包发货搜索栏组件
 * 支持智能识别SKU/货件编号/追踪号码/国内单号
 */
import React from 'react';
import { Card, Row, Col, Space, Form, Input, Button, FormInstance } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import ShopSelectorWithLabel from '@/components/ozon/ShopSelectorWithLabel';
import styles from '../../../pages/ozon/PackingShipment.module.scss';

export interface SearchParams {
  sku?: string;
  posting_number?: string;
  tracking_number?: string;
  domestic_tracking_number?: string;
}

export interface PackingSearchBarProps {
  /** Form 实例 */
  form: FormInstance;
  /** 当前选中的店铺ID */
  selectedShop: number | null;
  /** 店铺改变回调 */
  onShopChange: (shopId: number | null) => void;
  /** 搜索参数改变回调 */
  onSearchParamsChange: (params: SearchParams) => void;
}

/**
 * 打包发货搜索栏组件
 */
export const PackingSearchBar: React.FC<PackingSearchBarProps> = ({
  form,
  selectedShop,
  onShopChange,
  onSearchParamsChange,
}) => {
  const handleSearch = (values: any) => {
    const searchValue = values.search_text?.trim();

    if (!searchValue) {
      onSearchParamsChange({});
      return;
    }

    // 智能识别搜索类型
    let params: SearchParams = {};

    // 规则1: SKU - 10位数字
    if (/^\d{10}$/.test(searchValue)) {
      params.sku = searchValue;
    }
    // 规则2: 货件编号 - 包含数字和"-"
    else if (/\d/.test(searchValue) && searchValue.includes('-')) {
      params.posting_number = searchValue;
    }
    // 规则3: 追踪号码 - 字母开头+中间数字+字母结尾
    else if (/^[A-Za-z]+\d+[A-Za-z]+$/.test(searchValue)) {
      params.tracking_number = searchValue;
    }
    // 规则4: 国内单号 - 纯数字或字母开头+数字
    else if (/^\d+$/.test(searchValue) || /^[A-Za-z]+\d+$/.test(searchValue)) {
      params.domestic_tracking_number = searchValue;
    }
    // 其他情况默认按货件编号搜索
    else {
      params.posting_number = searchValue;
    }

    onSearchParamsChange(params);
  };

  const handleReset = () => {
    form.resetFields();
    onSearchParamsChange({});
  };

  return (
    <Card className={styles.filterCard}>
      <Row gutter={16} align="middle">
        {/* 左侧：店铺选择器 */}
        <Col>
          <ShopSelectorWithLabel
            label="选择店铺"
            value={selectedShop}
            onChange={onShopChange}
            showAllOption={true}
            className={styles.shopSelector}
          />
        </Col>

        {/* 右侧：搜索框 */}
        <Col flex="auto">
          <Form form={form} layout="inline" onFinish={handleSearch}>
            <Form.Item name="search_text">
              <Input
                placeholder="输入SKU/货件编号/追踪号码/国内单号"
                prefix={<SearchOutlined />}
                style={{ width: 320 }}
              />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  查询
                </Button>
                <Button onClick={handleReset}>
                  重置
                </Button>
              </Space>
            </Form.Item>
          </Form>
        </Col>
      </Row>
    </Card>
  );
};

export default PackingSearchBar;
