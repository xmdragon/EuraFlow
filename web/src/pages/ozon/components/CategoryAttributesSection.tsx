/**
 * 商品创建页 - 类目特征区块
 */
import { UpOutlined, DownOutlined, PlusOutlined } from '@ant-design/icons';
import { Form, Input, InputNumber, Button, Spin, Select, Space } from 'antd';
import React from 'react';

import styles from '../ProductCreate.module.scss';

import { AttributeField } from './AttributeField';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozon';

interface PromotionAction {
  action_id: number;
  title: string;
  date_end?: string;
}

export interface CategoryAttributesSectionProps {
  selectedCategory: number | null;
  loadingAttributes: boolean;
  categoryAttributes: CategoryAttribute[];
  dictionaryValuesCache: Record<number, DictionaryValue[]>;
  loadDictionaryValues: (categoryId: number, attributeId: number, searchText?: string) => Promise<DictionaryValue[]>;
  setDictionaryValuesCache: React.Dispatch<React.SetStateAction<Record<number, DictionaryValue[]>>>;
  variantManager: {
    hiddenFields: Set<string>;
    variantDimensions: Array<{ attribute_id: number }>;
    addVariantDimension: (attr: CategoryAttribute) => void;
    addFieldAsVariant: (fieldName: string, fieldLabel: string, fieldType: string) => void;
  };
  optionalFieldsExpanded: boolean;
  setOptionalFieldsExpanded: (expanded: boolean) => void;
  autoColorSample: boolean;
  specialFieldDescriptions: Record<string, string>;
  promotionActions: PromotionAction[] | undefined;
}

export const CategoryAttributesSection: React.FC<CategoryAttributesSectionProps> = ({
  selectedCategory,
  loadingAttributes,
  categoryAttributes,
  dictionaryValuesCache,
  loadDictionaryValues,
  setDictionaryValuesCache,
  variantManager,
  optionalFieldsExpanded,
  setOptionalFieldsExpanded,
  autoColorSample,
  specialFieldDescriptions,
  promotionActions,
}) => {
  if (!selectedCategory) {
    return null;
  }

  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>类目特征</h3>

      {loadingAttributes ? (
        <div style={{ textAlign: 'center', padding: '20px' }}>
          <Spin tip="正在加载类目属性..." />
        </div>
      ) : categoryAttributes.length > 0 ? (
        <>
          {/* 必填属性 */}
          {categoryAttributes
            .filter((attr) => attr.is_required)
            .map((attr) => (
              <AttributeField
                key={attr.attribute_id}
                attr={attr}
                dictionaryValuesCache={dictionaryValuesCache}
                loadDictionaryValues={loadDictionaryValues}
                setDictionaryValuesCache={setDictionaryValuesCache}
                variantManager={variantManager}
              />
            ))}

          {/* 选填属性（折叠）*/}
          {(categoryAttributes.filter((attr) => !attr.is_required).length > 0 ||
            !variantManager.hiddenFields.has('barcode') ||
            !variantManager.hiddenFields.has('vat')) && (
            <div style={{ marginTop: '16px' }}>
              <Button
                type="link"
                onClick={() => setOptionalFieldsExpanded(!optionalFieldsExpanded)}
                icon={optionalFieldsExpanded ? <UpOutlined /> : <DownOutlined />}
                style={{ padding: 0 }}
              >
                {optionalFieldsExpanded ? '收起' : '展开'}选填属性 (
                {categoryAttributes.filter((attr) => !attr.is_required).length +
                  (!variantManager.hiddenFields.has('barcode') ? 1 : 0) +
                  (!variantManager.hiddenFields.has('vat') ? 1 : 0) +
                  (autoColorSample ? 3 : 4) +
                  1}{' '}
                个)
              </Button>

              <div style={{ marginTop: '12px', display: optionalFieldsExpanded ? 'block' : 'none' }}>
                {/* 条形码 */}
                {!variantManager.hiddenFields.has('barcode') && (
                  <Form.Item label="条形码 (Barcode)" style={{ marginBottom: 12 }}>
                    <Space.Compact style={{ width: 'auto' }}>
                      <Form.Item name="barcode" noStyle>
                        <Input placeholder="商品条形码（FBP模式必填）" style={{ width: '250px' }} />
                      </Form.Item>
                      <Button
                        icon={<PlusOutlined />}
                        onClick={() => variantManager.addFieldAsVariant('barcode', '条形码', 'String')}
                        title="将当前属性添加变体属性"
                      />
                    </Space.Compact>
                  </Form.Item>
                )}

                {/* 增值税 */}
                {!variantManager.hiddenFields.has('vat') && (
                  <Form.Item
                    label="增值税 (VAT)"
                    tooltip="增值税率，0表示免税，0.1表示10%，0.2表示20%"
                    style={{ marginBottom: 12 }}
                    initialValue="0"
                  >
                    <Form.Item name="vat" noStyle initialValue="0">
                      <Input placeholder="0" style={{ width: '250px' }} />
                    </Form.Item>
                  </Form.Item>
                )}

                {/* 其他选填属性 */}
                {categoryAttributes
                  .filter((attr) => !attr.is_required)
                  .map((attr) => (
                    <AttributeField
                      key={attr.attribute_id}
                      attr={attr}
                      dictionaryValuesCache={dictionaryValuesCache}
                      loadDictionaryValues={loadDictionaryValues}
                      setDictionaryValuesCache={setDictionaryValuesCache}
                      variantManager={variantManager}
                    />
                  ))}

                {/* 高级字段 */}
                {!autoColorSample && (
                  <Form.Item
                    label="颜色营销图"
                    name="color_image"
                    tooltip="用于商品列表中展示该SKU的代表颜色，通常为商品颜色特写图"
                    style={{ marginBottom: 12 }}
                  >
                    <Input placeholder="输入颜色营销图URL" style={{ width: '500px' }} />
                  </Form.Item>
                )}

                <Form.Item
                  label="会员价"
                  name="premium_price"
                  tooltip="OZON Premium会员专享价格（可选）"
                  style={{ marginBottom: 12 }}
                >
                  <InputNumber
                    style={{ minWidth: '300px', maxWidth: '100%' }}
                    min={0}
                    precision={2}
                    placeholder="输入会员价"
                  />
                </Form.Item>

                <Form.Item
                  label="全景图片"
                  name="images360"
                  tooltip="上传一组连续角度拍摄的图片（建议36-72张），用于商品详情页360度展示"
                  style={{ marginBottom: 12 }}
                >
                  <Input.TextArea placeholder="每行输入一个图片URL" rows={4} style={{ width: '500px' }} />
                </Form.Item>

                <Form.Item
                  label="PDF文档"
                  name="pdf_list"
                  tooltip={specialFieldDescriptions['8790'] || '上传商品说明书、认证证书等PDF文档URL（最多5个）'}
                  style={{ marginBottom: 12 }}
                >
                  <Input.TextArea placeholder="每行输入一个PDF文件URL" rows={3} style={{ width: '500px' }} />
                </Form.Item>

                <Form.Item
                  label="参与促销"
                  name="promotions"
                  tooltip="选择该商品要参与的促销活动（可多选）"
                  style={{ marginBottom: 12 }}
                >
                  <Select
                    mode="multiple"
                    placeholder="选择促销活动"
                    style={{ width: '500px' }}
                    popupMatchSelectWidth={false}
                    loading={!promotionActions}
                    options={promotionActions?.map((action) => ({
                      label: `${action.title}${action.date_end ? ` (截止: ${action.date_end})` : ''}`,
                      value: action.action_id,
                    }))}
                  />
                </Form.Item>
              </div>
            </div>
          )}
        </>
      ) : (
        <div style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
          该类目暂无属性数据
        </div>
      )}
    </div>
  );
};
