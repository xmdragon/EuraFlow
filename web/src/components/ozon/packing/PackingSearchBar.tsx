/* eslint-disable no-unused-vars */
/**
 * 打包发货搜索栏组件
 * 支持智能识别SKU/货件编号/追踪号码/国内单号
 */
import { SearchOutlined, CloseCircleOutlined } from '@ant-design/icons';
import { Card, Row, Col, Space, Form, Input, Button, FormInstance, InputRef } from 'antd';
import React, { useState, useRef } from 'react';

import styles from '../../../pages/ozon/PackingShipment.module.scss';

import ShopSelectorWithLabel from '@/components/ozon/ShopSelectorWithLabel';
import { readAndValidateClipboard, markClipboardRejected } from '@/hooks/useClipboard';

export interface SearchParams {
  sku?: string;
  posting_number?: string;
  tracking_number?: string;
  domestic_tracking_number?: string;
}

interface PackingSearchFormValues {
  search_text?: string;
}

export interface PackingSearchBarProps {
  /** Form 实例 */
  form: FormInstance;
  /** 当前选中的店铺ID */
  selectedShop: number | null;
  /** 店铺改变回调 */
  onShopChange: (_value: number | null) => void;
  /** 搜索参数改变回调 */
  onSearchParamsChange: (_searchParams: SearchParams) => void;
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
  // 自动填充相关状态
  const [isAutoFilled, setIsAutoFilled] = useState(false);
  const searchInputRef = useRef<InputRef>(null);

  // 输入框获得焦点时，尝试自动填充剪贴板内容
  const handleSearchInputFocus = async () => {
    // 如果输入框已有内容，不覆盖
    const currentValue = form.getFieldValue('search_text');
    if (currentValue) {
      return;
    }

    // 读取并验证剪贴板内容
    const clipboardText = await readAndValidateClipboard();
    if (clipboardText) {
      form.setFieldValue('search_text', clipboardText);
      setIsAutoFilled(true);
    }
  };

  // 清除自动填充的内容
  const handleClearAutoFilled = () => {
    const currentValue = form.getFieldValue('search_text');
    if (currentValue) {
      // 标记为拒绝，1分钟内不再自动填充相同内容
      markClipboardRejected(currentValue);
    }
    form.setFieldValue('search_text', '');
    setIsAutoFilled(false);
    searchInputRef.current?.focus();
  };

  const handleSearch = (values: PackingSearchFormValues) => {
    const searchValue = values.search_text?.trim();

    if (!searchValue) {
      onSearchParamsChange({});
      return;
    }

    // 智能识别搜索类型
    const params: SearchParams = {};

    // 规则1: SKU - 10位数字
    if (/^\d{10}$/.test(searchValue)) {
      params.sku = searchValue;
    }
    // 规则2: 货件编号 - 包含数字和"-"
    // 如果是"数字-数字"格式，添加通配符用于模糊匹配
    else if (/\d/.test(searchValue) && searchValue.includes('-')) {
      if (/^\d+-\d+$/.test(searchValue)) {
        params.posting_number = searchValue + '-%';
      } else {
        params.posting_number = searchValue;
      }
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
                ref={searchInputRef}
                placeholder="输入SKU/货件编号/追踪号码/国内单号"
                prefix={<SearchOutlined />}
                style={{ width: 320 }}
                onFocus={handleSearchInputFocus}
                onChange={() => setIsAutoFilled(false)}
                suffix={
                  isAutoFilled && form.getFieldValue('search_text') ? (
                    <CloseCircleOutlined
                      onClick={handleClearAutoFilled}
                      style={{ color: '#999', cursor: 'pointer' }}
                    />
                  ) : null
                }
              />
            </Form.Item>
            <Form.Item>
              <Space>
                <Button type="primary" htmlType="submit">
                  查询
                </Button>
                <Button onClick={handleReset}>重置</Button>
              </Space>
            </Form.Item>
          </Form>
        </Col>
      </Row>
    </Card>
  );
};

export default PackingSearchBar;
