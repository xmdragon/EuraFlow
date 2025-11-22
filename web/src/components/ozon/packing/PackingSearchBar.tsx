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
  delivery_method?: string;
  has_purchase_info?: string;
}

interface PackingSearchFormValues {
  search_text?: string;
  delivery_method?: string;
  has_purchase_info?: string;
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
  const [searchValue, setSearchValue] = useState<string>('');
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
      setSearchValue(clipboardText);
      setIsAutoFilled(true);
    }
  };

  // 处理输入变化
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setSearchValue(value);
    setIsAutoFilled(false);
  };

  // 清除输入框内容
  const handleClearInput = () => {
    // 仅当是自动填充的内容时，才标记为拒绝
    if (searchValue && isAutoFilled) {
      markClipboardRejected(searchValue);
    }
    form.setFieldValue('search_text', '');
    setSearchValue('');
    setIsAutoFilled(false);
    searchInputRef.current?.focus();
  };

  const handleSearch = (values: PackingSearchFormValues) => {
    const searchText = values.search_text?.trim();
    const deliveryMethod = values.delivery_method?.trim();
    const hasPurchaseInfo = values.has_purchase_info;

    // 如果没有任何搜索条件，清空搜索
    if (!searchText && !deliveryMethod && !hasPurchaseInfo) {
      onSearchParamsChange({});
      return;
    }

    // 智能识别搜索类型
    const params: SearchParams = {};

    // 处理配送方式（如果有输入）
    if (deliveryMethod) {
      params.delivery_method = deliveryMethod;
    }

    // 处理采购信息筛选（如果有选择）
    if (hasPurchaseInfo && hasPurchaseInfo !== 'all') {
      params.has_purchase_info = hasPurchaseInfo;
    }

    // 如果没有搜索文本，只有配送方式或采购信息
    if (!searchText) {
      onSearchParamsChange(params);
      return;
    }

    // 规则1: SKU - 10位数字
    if (/^\d{10}$/.test(searchText)) {
      params.sku = searchText;
    }
    // 规则2: 货件编号 - 包含数字和"-"
    // 如果是"数字-数字"格式，添加通配符用于模糊匹配
    else if (/\d/.test(searchText) && searchText.includes('-')) {
      if (/^\d+-\d+$/.test(searchText)) {
        params.posting_number = searchText + '-%';
      } else {
        params.posting_number = searchText;
      }
    }
    // 规则3: 追踪号码 - 字母开头+中间数字+字母结尾
    else if (/^[A-Za-z]+\d+[A-Za-z]+$/.test(searchText)) {
      params.tracking_number = searchText;
    }
    // 规则4: 国内单号 - 纯数字或字母开头+数字
    else if (/^\d+$/.test(searchText) || /^[A-Za-z]+\d+$/.test(searchText)) {
      params.domestic_tracking_number = searchText;
    }
    // 其他情况默认按货件编号搜索
    else {
      params.posting_number = searchText;
    }

    onSearchParamsChange(params);
  };

  const handleReset = () => {
    form.resetFields();
    setSearchValue('');
    setIsAutoFilled(false);
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
                style={{ width: '100%', maxWidth: 320, minWidth: 200 }}
                onFocus={handleSearchInputFocus}
                onChange={handleInputChange}
                suffix={
                  searchValue ? (
                    <CloseCircleOutlined
                      onClick={handleClearInput}
                      style={{ color: '#999', cursor: 'pointer' }}
                    />
                  ) : null
                }
              />
            </Form.Item>
            <Form.Item name="delivery_method">
              <Input placeholder="配送方式" style={{ width: '100%', maxWidth: 100, minWidth: 80 }} />
            </Form.Item>
            <Form.Item name="has_purchase_info" initialValue="all">
              <Select style={{ width: 120 }}>
                <Select.Option value="all">全部</Select.Option>
                <Select.Option value="yes">有采购信息</Select.Option>
                <Select.Option value="no">无采购信息</Select.Option>
              </Select>
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
