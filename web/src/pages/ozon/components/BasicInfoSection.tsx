/**
 * 商品创建页 - 基本信息区块
 */
import {
  PlusOutlined,
  SyncOutlined,
  QuestionCircleOutlined,
  TranslationOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Form, Input, InputNumber, Button, Space, Cascader, Tooltip, FormInstance } from 'antd';
import React from 'react';

import styles from '../ProductCreate.module.scss';

import ShopSelector from '@/components/ozon/ShopSelector';

const { TextArea } = Input;

// 类目选项接口
export interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

// 变体管理器接口（简化版）
export interface VariantManagerProps {
  hiddenFields: Set<string>;
  variantSectionExpanded: boolean;
  variantDimensions: Array<{ attribute_id: number }>;
  addFieldAsVariant: (fieldName: string, fieldLabel: string, fieldType: string) => void;
  addVariantDimension: (attr: unknown) => void;
}

export interface BasicInfoSectionProps {
  form: FormInstance;
  selectedShop: number | null;
  setSelectedShop: (shopId: number) => void;
  categoryTree: CategoryOption[];
  cascaderKey: number;
  categoryPath: number[] | undefined;
  selectedCategory: number | null;
  setSelectedCategory: (categoryId: number | null) => void;
  setCategoryPath: (path: number[] | undefined) => void;
  setCategoryAttributes: (attrs: unknown[]) => void;
  setTypeId: (id: number | null) => void;
  setTitleTranslationCache: (cache: string) => void;
  setShowingTranslation: (showing: boolean) => void;
  syncingCategoryAttributes: boolean;
  handleSyncCategoryAttributes: () => void;
  hasCategoryData: boolean;
  specialFieldDescriptions: Record<string, string>;
  handleGenerateTitle: () => void;
  handleTranslateTitle: () => void;
  isTranslating: boolean;
  showingTranslation: boolean;
  variantManager: VariantManagerProps;
  handleGenerateOfferId: () => void;
}

export const BasicInfoSection: React.FC<BasicInfoSectionProps> = ({
  form,
  selectedShop,
  setSelectedShop,
  categoryTree,
  cascaderKey,
  categoryPath,
  selectedCategory,
  setSelectedCategory,
  setCategoryPath,
  setCategoryAttributes,
  setTypeId,
  setTitleTranslationCache,
  setShowingTranslation,
  syncingCategoryAttributes,
  handleSyncCategoryAttributes,
  hasCategoryData,
  specialFieldDescriptions,
  handleGenerateTitle,
  handleTranslateTitle,
  isTranslating,
  showingTranslation,
  variantManager,
  handleGenerateOfferId,
}) => {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>主要信息</h3>

      <Form.Item
        label="选择店铺"
        name="shop_id"
        rules={[{ required: true, message: '请选择店铺' }]}
      >
        <ShopSelector
          id="shop_id"
          value={selectedShop}
          onChange={(shopId) => setSelectedShop(shopId as number)}
          showAllOption={false}
          style={{ width: '300px' }}
        />
      </Form.Item>

      <Form.Item
        label="商品类目"
        name="category_id"
        rules={[{ required: true, message: '请选择商品类目' }]}
      >
        <div className={styles.categorySelector}>
          <Cascader
            key={cascaderKey}
            id="category_id"
            className={styles.cascader}
            value={categoryPath}
            options={categoryTree}
            onChange={(value) => {
              const catId =
                value && value.length > 0 ? (value[value.length - 1] as number) : null;
              setSelectedCategory(catId);
              setCategoryPath(value as number[] | undefined);
              form.setFieldValue('category_id', value);

              // 类目变化时，清空类目属性
              if (!catId) {
                setCategoryAttributes([]);
                setTypeId(null);
              }

              // 重置标题字段
              form.setFieldValue('title', '');
              setTitleTranslationCache('');
              setShowingTranslation(false);
            }}
            placeholder="请选择商品类目"
            expandTrigger="click"
            changeOnSelect={false}
            showSearch={{
              filter: (inputValue, path) =>
                path.some((option) =>
                  (option.label as string).toLowerCase().includes(inputValue.toLowerCase())
                ),
            }}
            disabled={!selectedShop || false}
            loading={false}
          />
          {selectedCategory && (
            <Button
              type="default"
              icon={<SyncOutlined spin={syncingCategoryAttributes} />}
              onClick={handleSyncCategoryAttributes}
              loading={syncingCategoryAttributes}
              disabled={!selectedShop || !selectedCategory}
              style={{ marginLeft: 8 }}
              title="同步当前类目的特征数据"
            >
              同步特征
            </Button>
          )}
        </div>
        {!hasCategoryData && selectedShop && (
          <span className={styles.errorText}>数据库无类目数据，请前往"系统配置 - 全局设置"同步类目</span>
        )}
      </Form.Item>

      <Form.Item
        label={
          <span>
            商品名称
            <Tooltip title={specialFieldDescriptions['4180'] || "使用俄文，推荐格式: 类目+品牌（如有品牌）+名称+变体属性，标题过长或重复单词可能导致审核失败"}>
              <QuestionCircleOutlined style={{ marginLeft: 4, color: '#999' }} />
            </Tooltip>
          </span>
        }
        required
        style={{ marginBottom: 12 }}
      >
        <Space.Compact style={{ width: 'auto' }}>
          <Form.Item
            name="title"
            rules={[{ required: true, message: '请输入商品名称' }]}
            noStyle
          >
            <Input
              placeholder="商品标题"
              maxLength={200}
              showCount
              style={{ width: '500px' }}
            />
          </Form.Item>
          <Button onClick={handleGenerateTitle}>生成</Button>
          <Button
            icon={<TranslationOutlined />}
            onClick={handleTranslateTitle}
            loading={isTranslating}
          >
            {showingTranslation ? '原文' : '翻译'}
          </Button>
        </Space.Compact>
      </Form.Item>

      {!variantManager.hiddenFields.has('description') && (
        <Form.Item
          label="商品描述"
          tooltip={specialFieldDescriptions['4191'] || "商品的详细描述、营销文本等信息"}
          style={{ marginBottom: 12 }}
        >
          <Space.Compact style={{ width: 'auto', alignItems: 'flex-start' }}>
            <Form.Item name="description" noStyle>
              <TextArea
                rows={4}
                placeholder="商品详细描述"
                maxLength={5000}
                showCount
                style={{ width: '600px' }}
              />
            </Form.Item>
            <Button
              icon={<PlusOutlined />}
              onClick={() => variantManager.addFieldAsVariant('description', '商品描述', 'String')}
              title="将当前属性添加变体属性"
            />
          </Space.Compact>
        </Form.Item>
      )}

      {!variantManager.variantSectionExpanded && (
        <Form.Item label="Offer ID" required style={{ marginBottom: 12 }}>
          <Space.Compact>
            <Form.Item
              name="offer_id"
              rules={[{ required: true, message: '请输入Offer ID' }]}
              noStyle
            >
              <Input placeholder="OZON商品标识符（卖家SKU）" style={{ width: '300px' }} />
            </Form.Item>
            <Button
              type="default"
              icon={<ThunderboltOutlined />}
              onClick={handleGenerateOfferId}
            >
              生成
            </Button>
          </Space.Compact>
        </Form.Item>
      )}

      <div className={styles.dimensionGroup}>
        {!variantManager.hiddenFields.has('depth') && (
          <div className={styles.dimensionItem}>
            <Form.Item label="包装长度（mm）" required style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: 'auto' }}>
                <Form.Item
                  name="depth"
                  rules={[
                    { required: true, message: '请输入包装长度' },
                    { type: 'number', min: 0.01, message: '包装长度必须大于0' },
                  ]}
                  noStyle
                >
                  <InputNumber min={0.01} placeholder="长" controls={false} />
                </Form.Item>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => variantManager.addFieldAsVariant('depth', '包装长度', 'Integer')}
                  title="将当前属性添加变体属性"
                />
              </Space.Compact>
            </Form.Item>
          </div>
        )}
        {!variantManager.hiddenFields.has('width') && (
          <div className={styles.dimensionItem}>
            <Form.Item label="包装宽度（mm）" required style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: 'auto' }}>
                <Form.Item
                  name="width"
                  rules={[
                    { required: true, message: '请输入包装宽度' },
                    { type: 'number', min: 0.01, message: '包装宽度必须大于0' },
                  ]}
                  noStyle
                >
                  <InputNumber min={0.01} placeholder="宽" controls={false} />
                </Form.Item>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => variantManager.addFieldAsVariant('width', '包装宽度', 'Integer')}
                  title="将当前属性添加变体属性"
                />
              </Space.Compact>
            </Form.Item>
          </div>
        )}
        {!variantManager.hiddenFields.has('height') && (
          <div className={styles.dimensionItem}>
            <Form.Item label="包装高度（mm）" required style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: 'auto' }}>
                <Form.Item
                  name="height"
                  rules={[
                    { required: true, message: '请输入包装高度' },
                    { type: 'number', min: 0.01, message: '包装高度必须大于0' },
                  ]}
                  noStyle
                >
                  <InputNumber min={0.01} placeholder="高" controls={false} />
                </Form.Item>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => variantManager.addFieldAsVariant('height', '包装高度', 'Integer')}
                  title="将当前属性添加变体属性"
                />
              </Space.Compact>
            </Form.Item>
          </div>
        )}
        {!variantManager.hiddenFields.has('weight') && (
          <div className={styles.dimensionItem}>
            <Form.Item label="重量（g）" required style={{ marginBottom: 12 }}>
              <Space.Compact style={{ width: 'auto' }}>
                <Form.Item
                  name="weight"
                  rules={[
                    { required: true, message: '请输入重量' },
                    { type: 'number', min: 0.01, message: '重量必须大于0' },
                  ]}
                  noStyle
                >
                  <InputNumber min={0.01} placeholder="重量" controls={false} />
                </Form.Item>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => variantManager.addFieldAsVariant('weight', '重量', 'Integer')}
                  title="将当前属性添加变体属性"
                />
              </Space.Compact>
            </Form.Item>
          </div>
        )}
      </div>
    </div>
  );
};
