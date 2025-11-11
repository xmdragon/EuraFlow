/**
 * 变体表格组件
 *
 * 功能：
 * - 动态生成变体表格列（图片、视频、Offer ID、维度列、价格、操作）
 * - 支持批量操作（生成Offer ID、批量设价）
 * - 支持字典值Select和颜色样本渲染
 */
import React, { useMemo } from 'react';
import {
  PlusOutlined,
  ThunderboltOutlined,
  MinusCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { Table, Input, InputNumber, Button, Select, Space, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type { ProductVariant, VariantDimension } from '@/hooks/useVariantManager';
import type { DictionaryValue } from '@/services/ozonApi';
import { isColorAttribute, getColorValue, getTextColor } from '@/utils/colorMapper';
import styles from './VariantTable.module.scss';

export interface VariantTableProps {
  // 数据
  variants: ProductVariant[];
  variantDimensions: VariantDimension[];

  // 回调
  onUpdateVariant: (id: string, field: string, value: unknown) => void;
  onDeleteVariant: (id: string) => void;
  onBatchGenerateOfferId: () => void;
  onBatchSetPrice: (price: number | null) => void;
  onBatchSetOldPrice: (oldPrice: number | null) => void;
  onRemoveVariantDimension: (attributeId: number) => void;

  // 图片/视频管理
  onOpenImageModal: (variant: ProductVariant) => void;
  onOpenVideoModal: (variant: ProductVariant) => void;

  // 字典值加载
  dictionaryValuesCache: Record<number, DictionaryValue[]>;
  loadDictionaryValues: (dictionaryId: number) => Promise<void>;
}

/**
 * 变体表格组件
 */
export const VariantTable: React.FC<VariantTableProps> = ({
  variants,
  variantDimensions,
  onUpdateVariant,
  onDeleteVariant,
  onBatchGenerateOfferId,
  onBatchSetPrice,
  onBatchSetOldPrice,
  onRemoveVariantDimension,
  onOpenImageModal,
  onOpenVideoModal,
  dictionaryValuesCache,
  loadDictionaryValues,
}) => {
  /**
   * 动态生成变体表格列
   */
  const columns = useMemo((): ColumnsType<ProductVariant> => {
    const cols: ColumnsType<ProductVariant> = [];

    // 图片列（第一列，左固定）
    cols.push({
      title: '图片',
      key: 'image',
      width: 64,
      fixed: 'left',
      render: (_: unknown, record: ProductVariant) => {
        const imageCount = record.images?.length || 0;
        return (
          <div className={styles.variantImageCell} onClick={() => onOpenImageModal(record)}>
            {imageCount > 0 ? (
              <div className={styles.variantImagePreview}>
                <img src={record.images![0]} alt="variant" className={styles.variantImage} />
                <span className={styles.imageCount}>{imageCount}</span>
              </div>
            ) : (
              <div className={styles.variantImagePlaceholder}>
                <PlusOutlined />
                <span className={styles.imageCountZero}>0</span>
              </div>
            )}
          </div>
        );
      },
    });

    // 视频列（第二列）
    cols.push({
      title: '视频',
      key: 'video',
      width: 64,
      render: (_: unknown, record: ProductVariant) => {
        const videoCount = record.videos?.length || 0;
        return (
          <div className={styles.variantVideoCell} onClick={() => onOpenVideoModal(record)}>
            {videoCount > 0 ? (
              <div className={styles.variantVideoPreview}>
                <div className={styles.videoPreviewIconSmall}>
                  <PlusOutlined style={{ fontSize: 16 }} />
                </div>
                <span className={styles.videoCount}>{videoCount}</span>
                {record.videos?.some((v) => v.is_cover) && (
                  <Tag
                    color="gold"
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: 2,
                      fontSize: 10,
                      padding: '0 4px',
                      lineHeight: '16px',
                    }}
                  >
                    封面
                  </Tag>
                )}
              </div>
            ) : (
              <div className={styles.variantVideoPlaceholder}>
                <PlusOutlined />
                <span className={styles.videoCountZero}>0</span>
              </div>
            )}
          </div>
        );
      },
    });

    // Offer ID 列（第三列，表头带批量生成）
    cols.push({
      title: (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            justifyContent: 'space-between',
          }}
        >
          <span>货号</span>
          <Button
            size="small"
            icon={<ThunderboltOutlined />}
            onClick={onBatchGenerateOfferId}
            title="批量生成所有变体的 Offer ID"
          >
            生成
          </Button>
        </div>
      ),
      key: 'offer_id',
      width: 160,
      render: (_: unknown, record: ProductVariant) => (
        <Input
          size="small"
          value={record.offer_id}
          onChange={(e) => onUpdateVariant(record.id, 'offer_id', e.target.value)}
          placeholder="货号"
        />
      ),
    });

    // 添加用户选择的维度列
    variantDimensions.forEach((dim) => {
      // 检测是否为颜色属性
      const isColor = isColorAttribute(dim.name);
      const hasDictionary = !!dim.dictionary_id;

      cols.push({
        title: (
          <Space size={4}>
            {dim.name}
            <MinusCircleOutlined
              style={{ color: '#ff4d4f', cursor: 'pointer', fontSize: 14 }}
              onClick={() => onRemoveVariantDimension(dim.attribute_id)}
              title="移除此维度"
            />
          </Space>
        ),
        key: `dim_${dim.attribute_id}`,
        width: 110,
        render: (_: unknown, record: ProductVariant) => {
          // 如果有字典值，使用 Select；否则使用 Input
          if (hasDictionary) {
            return (
              <Select
                size="small"
                value={record.dimension_values[dim.attribute_id] || undefined}
                onChange={(value) =>
                  onUpdateVariant(record.id, `dim_${dim.attribute_id}`, value)
                }
                placeholder={`${dim.name}`}
                style={{ width: '100%' }}
                showSearch
                filterOption={false}
                onFocus={async () => {
                  // 加载字典值
                  if (!dictionaryValuesCache[dim.dictionary_id!]) {
                    await loadDictionaryValues(dim.dictionary_id!);
                  }
                }}
                optionRender={
                  isColor
                    ? (option) => {
                        const colorValue = getColorValue(option.label as string);
                        if (colorValue) {
                          return (
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                padding: '4px 8px',
                                backgroundColor: colorValue,
                                color: getTextColor(colorValue),
                                borderRadius: '4px',
                              }}
                            >
                              {option.label}
                            </div>
                          );
                        }
                        return <span>{option.label}</span>;
                      }
                    : undefined
                }
                options={
                  dictionaryValuesCache[dim.dictionary_id!]?.map((v: DictionaryValue) => ({
                    label: v.value,
                    value: v.value_id,
                  })) || []
                }
              />
            );
          } else {
            return (
              <Input
                size="small"
                value={(record.dimension_values[dim.attribute_id] as string) || ''}
                onChange={(e) =>
                  onUpdateVariant(record.id, `dim_${dim.attribute_id}`, e.target.value)
                }
                placeholder={`${dim.name}`}
              />
            );
          }
        },
      });
    });

    // 售价列（表头带批量设置输入框）
    cols.push({
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ whiteSpace: 'nowrap' }}>售价</span>
          <InputNumber
            size="small"
            placeholder="批量"
            min={0}
            controls={false}
            style={{ width: '60px' }}
            onChange={onBatchSetPrice}
            onPressEnter={(e: React.KeyboardEvent<HTMLInputElement>) => {
              const value = (e.target as HTMLInputElement).value;
              onBatchSetPrice(value ? Number(value) : null);
            }}
          />
        </div>
      ),
      key: 'price',
      width: 100,
      render: (_: unknown, record: ProductVariant) => (
        <InputNumber
          size="small"
          value={record.price}
          onChange={(value) => onUpdateVariant(record.id, 'price', value)}
          placeholder="0"
          min={0}
          controls={false}
        />
      ),
    });

    // 原价列（表头带批量设置输入框）
    cols.push({
      title: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ whiteSpace: 'nowrap' }}>原价</span>
          <InputNumber
            size="small"
            placeholder="批量"
            min={0}
            controls={false}
            style={{ width: '60px' }}
            onChange={onBatchSetOldPrice}
            onPressEnter={(e: React.KeyboardEvent<HTMLInputElement>) => {
              const value = (e.target as HTMLInputElement).value;
              onBatchSetOldPrice(value ? Number(value) : null);
            }}
          />
        </div>
      ),
      key: 'old_price',
      width: 100,
      render: (_: unknown, record: ProductVariant) => (
        <InputNumber
          size="small"
          value={record.old_price}
          onChange={(value) => onUpdateVariant(record.id, 'old_price', value)}
          placeholder="0"
          min={0}
          controls={false}
        />
      ),
    });

    // 操作列（固定在右侧）
    cols.push({
      title: '操作',
      key: 'action',
      width: 60,
      fixed: 'right',
      render: (_: unknown, record: ProductVariant) => (
        <Button
          type="link"
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => onDeleteVariant(record.id)}
        >
          删除
        </Button>
      ),
    });

    return cols;
  }, [
    variantDimensions,
    dictionaryValuesCache,
    onUpdateVariant,
    onDeleteVariant,
    onBatchGenerateOfferId,
    onBatchSetPrice,
    onBatchSetOldPrice,
    onRemoveVariantDimension,
    onOpenImageModal,
    onOpenVideoModal,
    loadDictionaryValues,
  ]);

  return (
    <Table
      columns={columns}
      dataSource={variants}
      rowKey="id"
      pagination={false}
      scroll={{ x: 'max-content' }}
      size="small"
    />
  );
};
