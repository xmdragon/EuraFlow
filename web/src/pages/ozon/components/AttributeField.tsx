import React from 'react';
import { Form, Input, InputNumber, Select, Switch, Button, Space, Tag } from 'antd';
import { PlusOutlined, ThunderboltOutlined } from '@ant-design/icons';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozon';
import { isColorAttribute, getColorValue, getTextColor } from '@/utils/colorMapper';

/**
 * 生成随机字符串（大小写字母混合）
 * @param length 字符串长度，默认16
 * @returns 随机字符串
 */
const generateRandomString = (length: number = 16): string => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

interface AttributeFieldProps {
  attr: CategoryAttribute;
  dictionaryValuesCache: Record<number, DictionaryValue[]>;
  loadDictionaryValues: (categoryId: number, attributeId: number, searchText?: string) => Promise<DictionaryValue[]>;
  setDictionaryValuesCache: React.Dispatch<React.SetStateAction<Record<number, DictionaryValue[]>>>;
  variantManager: {
    hiddenFields: Set<string>;
    variantDimensions: Array<{ attribute_id: number }>;
    addVariantDimension: (attr: CategoryAttribute) => void;
  };
}

/**
 * 检测是否为"类型名称"或"型号名称"字段
 * 这些字段需要显示"生成"按钮，用于生成16位随机字符串
 */
const isTypeNameField = (name: string): boolean => {
  const lowerName = name.toLowerCase();
  return lowerName.includes('类型名称') ||
         lowerName.includes('型号名称') ||
         lowerName.includes('типовое название') ||
         lowerName.includes('type name') ||
         lowerName.includes('модельное название') ||
         lowerName.includes('model name');
};

/**
 * 检测是否为"品牌"字段
 */
const isBrandField = (name: string): boolean => {
  const lowerName = name.toLowerCase();
  return lowerName.includes('品牌') ||
         lowerName.includes('бренд') ||
         lowerName.includes('brand');
};

/**
 * 检测是否为"国家"字段
 */
const isCountryField = (name: string): boolean => {
  const lowerName = name.toLowerCase();
  return lowerName.includes('国家') ||
         lowerName.includes('品牌国家') ||
         lowerName.includes('制造国') ||
         lowerName.includes('生产国') ||
         lowerName.includes('страна') ||
         lowerName.includes('country') ||
         lowerName.includes('производства'); // 俄语"生产国"
};

// 从label中提取括号内容
const extractBracketContent = (text: string): { label: string; bracketContent: string | null } => {
  // 匹配中文括号（）或英文括号()中的内容
  const match = text.match(/^(.+?)[（(]([^）)]+)[）)]$/);
  if (match) {
    return {
      label: match[1].trim(),
      bracketContent: match[2].trim(),
    };
  }
  return { label: text, bracketContent: null };
};

// 长标题缩写映射表（中文标题 -> 英文缩写）
const LABEL_ABBREVIATIONS: Record<string, string> = {
  欧亚经济联盟对外经济活动商品命名代码: 'EAEU Code',
  // 可以继续添加其他长标题的缩写
};

// 处理长标题缩写（优先使用映射表，否则超过10个字符则自动缩写）
const abbreviateLongLabel = (
  label: string,
  maxLength: number = 10,
): { displayLabel: string; originalLabel: string | null } => {
  // 优先检查映射表
  if (LABEL_ABBREVIATIONS[label]) {
    return {
      displayLabel: LABEL_ABBREVIATIONS[label],
      originalLabel: label,
    };
  }

  // 如果没有映射且超过最大长度，则自动缩写
  if (label.length > maxLength) {
    return {
      displayLabel: label.substring(0, maxLength) + '...',
      originalLabel: label,
    };
  }

  return { displayLabel: label, originalLabel: null };
};

// 渲染tooltip内容（支持HTML链接 + 完整标题）
const renderTooltipContent = (
  description?: string,
  bracketContent?: string | null,
  originalLabel?: string | null,
) => {
  if (!description && !bracketContent && !originalLabel) return undefined;

  const parts: React.ReactNode[] = [];

  // 添加完整标题（如果被缩写）
  if (originalLabel) {
    parts.push(
      <div key="original-label" style={{ fontWeight: 600, marginBottom: '4px' }}>
        {originalLabel}
      </div>,
    );
  }

  // 添加括号内容
  if (bracketContent) {
    parts.push(<div key="bracket">{bracketContent}</div>);
  }

  // 处理description中的HTML链接
  if (description) {
    // 简单的HTML链接解析：匹配 <a href="...">text</a>
    const linkRegex = /<a\s+href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi;
    const textParts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = linkRegex.exec(description)) !== null) {
      // 添加链接前的文本
      if (match.index > lastIndex) {
        textParts.push(description.substring(lastIndex, match.index));
      }
      // 添加链接
      textParts.push(
        <a
          key={match.index}
          href={match[1]}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1890ff', textDecoration: 'underline' }}
        >
          {match[2]}
        </a>,
      );
      lastIndex = match.index + match[0].length;
    }

    // 添加剩余文本
    if (lastIndex < description.length) {
      textParts.push(description.substring(lastIndex));
    }

    // 如果没有匹配到链接，直接使用原文本
    if (textParts.length === 0) {
      textParts.push(description);
    }

    parts.push(
      <div key="description" style={{ marginTop: bracketContent ? '8px' : 0 }}>
        {textParts}
      </div>,
    );
  }

  return <div>{parts}</div>;
};

// 渲染属性字段（带"+"按钮添加到变体）
export const AttributeField: React.FC<AttributeFieldProps> = ({
  attr,
  dictionaryValuesCache,
  loadDictionaryValues,
  setDictionaryValuesCache,
  variantManager,
}) => {
  const form = Form.useFormInstance();
  const fieldName = `attr_${attr.attribute_id}`;
  const { label, bracketContent } = extractBracketContent(attr.name);
  const { displayLabel, originalLabel } = abbreviateLongLabel(label);
  const required = attr.is_required;
  const tooltipContent = renderTooltipContent(attr.description, bracketContent, originalLabel);

  // 检测特殊字段
  const isTypeName = isTypeNameField(attr.name);
  const isBrand = isBrandField(attr.name);
  const isCountry = isCountryField(attr.name);

  // 检测是否支持多选（优先使用 is_collection 字段，备选检查 description）
  const isMultiSelect = attr.is_collection ||
    (attr.description && attr.description.includes('您可以添加多个值'));

  // 处理类型名称生成按钮点击
  const handleGenerateTypeName = () => {
    const randomStr = generateRandomString(16);
    form.setFieldValue(fieldName, randomStr);
  };

  // 国家字段例外处理：主动加载所有字典值
  // 品牌字段不再自动加载，使用默认"无品牌"+搜索模式
  React.useEffect(() => {
    if (isCountry && attr.dictionary_id) {
      // 检查是否已有缓存或预加载值
      const hasCached = dictionaryValuesCache[attr.dictionary_id] && dictionaryValuesCache[attr.dictionary_id].length > 0;
      const hasPreloaded = attr.dictionary_values && attr.dictionary_values.length > 0;

      if (!hasCached && !hasPreloaded) {
        // 异步加载所有国家字典值（传空字符串以获取所有值）
        loadDictionaryValues(attr.category_id, attr.attribute_id, '')
          .then((values) => {
            setDictionaryValuesCache((prev) => ({
              ...prev,
              [attr.dictionary_id!]: values,
            }));
          })
          .catch((error) => {
            console.error('[AttributeField] 国家字典值加载失败:', error);
          });
      }
    }
  }, [isCountry, attr.dictionary_id, attr.category_id, attr.attribute_id, attr.name]);

  // 根据类型渲染不同的控件
  // 使用完整label用于提示信息，使用displayLabel用于显示
  const fullLabel = originalLabel || displayLabel;

  // 过滤重复字段：隐藏与默认表单字段重复的类目特征
  // 4180=名称（对应title）, 4191=简介（对应description）, 8790=PDF文件（对应pdf_list）, 8789=PDF文件名称
  // 8229=类型（对应选择的类目本身，后端自动填充）
  const DUPLICATE_ATTRIBUTE_IDS = [4180, 4191, 8790, 8789, 8229];
  if (DUPLICATE_ATTRIBUTE_IDS.includes(attr.attribute_id)) {
    return null;
  }

  // 检查是否已添加到变体维度（已隐藏的不显示）
  if (variantManager.hiddenFields.has(fieldName)) {
    return null;
  }

  // 检查是否已添加到变体维度
  const isInVariant = variantManager.variantDimensions.some((d) => d.attribute_id === attr.attribute_id);

  // 渲染输入控件
  let inputControl: React.ReactNode;

  // 优先检查是否有字典值（所有类型都可能有字典值）
  if (attr.dictionary_id) {
    // 检测是否为颜色属性
    const isColor = isColorAttribute(attr.name);

    // 品牌字段特殊处理：默认只显示"无品牌"，搜索时加载其他品牌
    if (isBrand) {
      // 获取缓存值（搜索后的结果）
      const cachedValues = dictionaryValuesCache[attr.dictionary_id] || [];

      // 默认选项：无品牌（显示中文，value_id = 126745801 对应 OZON 的 "Нет бренда"）
      const defaultBrandOption = { value_id: 126745801, value: '无品牌' } as DictionaryValue;

      // 合并默认选项和搜索结果（去重）
      const brandOptions = [
        defaultBrandOption,
        ...cachedValues.filter((v: DictionaryValue) => v.value_id !== 126745801)
      ];

      inputControl = (
        <Select
          mode={isMultiSelect ? 'multiple' : undefined}
          showSearch
          placeholder={`请选择${fullLabel}`}
          popupMatchSelectWidth={false}
          filterOption={false}
          style={{ width: '250px' }}
          onSearch={async (value) => {
            if (value && value.length >= 2) {
              const values = await loadDictionaryValues(attr.category_id, attr.attribute_id, value);
              setDictionaryValuesCache((prev) => ({
                ...prev,
                [attr.dictionary_id!]: values,
              }));
            } else if (!value) {
              // 清空搜索时，只保留默认选项
              setDictionaryValuesCache((prev) => ({
                ...prev,
                [attr.dictionary_id!]: [],
              }));
            }
          }}
          options={brandOptions.map((v: DictionaryValue) => ({
            label: v.value,
            value: v.value_id,
          }))}
        />
      );
    } else {
      // 其他字段的智能模式
      // - 如果有预加载的值（≤100条），直接下拉选择
      // - 如果没有预加载（>100条），使用搜索模式
      // - 国家字段例外：即使超过100条也使用下拉模式
      const hasPreloadedValues = attr.dictionary_values && attr.dictionary_values.length > 0;
      const hasCachedValues = dictionaryValuesCache[attr.dictionary_id] && dictionaryValuesCache[attr.dictionary_id].length > 0;
      const shouldUseDropdownMode = hasPreloadedValues || (isCountry && hasCachedValues);

      if (shouldUseDropdownMode) {
        // 模式1：直接下拉（≤100条 或 国家字段）
        // 获取字典值列表（优先使用缓存，其次使用预加载值）
        const dictionaryValues = hasCachedValues
          ? dictionaryValuesCache[attr.dictionary_id]
          : (attr.dictionary_values || []);

      inputControl = (
        <Select
          mode={isMultiSelect ? 'multiple' : undefined}
          showSearch
          placeholder={`请选择${fullLabel}`}
          popupMatchSelectWidth={false}
          filterOption={(input, option) =>
            (option?.label as string)?.toLowerCase().includes(input.toLowerCase())
          }
          style={{ width: '250px' }}
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
            dictionaryValues.map((v: DictionaryValue) => ({
              label: v.value,
              value: v.value_id,
            }))
          }
        />
      );
    } else {
      // 模式2：搜索模式（>100条）
      inputControl = (
        <Select
          mode={isMultiSelect ? 'multiple' : undefined}
          showSearch
          placeholder={`请输入至少2个字符搜索${fullLabel}`}
          popupMatchSelectWidth={false}
          filterOption={false}
          style={{ width: '250px' }}
          notFoundContent={
            <div style={{ padding: '8px', textAlign: 'center', color: '#999' }}>
              请输入至少2个字符进行搜索
            </div>
          }
          onSearch={async (value) => {
            // 搜索时动态加载（至少2个字符）
            if (value && value.length >= 2) {
              const values = await loadDictionaryValues(attr.category_id, attr.attribute_id, value);
              // 更新缓存以触发重新渲染
              setDictionaryValuesCache((prev) => ({
                ...prev,
                [attr.dictionary_id!]: values,
              }));
            } else {
              // 清空缓存
              setDictionaryValuesCache((prev) => ({
                ...prev,
                [attr.dictionary_id!]: [],
              }));
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
            dictionaryValuesCache[attr.dictionary_id]?.map((v: DictionaryValue) => ({
              label: v.value,
              value: v.value_id,
            })) || []
          }
        />
      );
    }
    }
  } else {
    // 没有字典值，根据类型渲染对应控件
    switch (attr.attribute_type) {
      case 'Boolean':
        inputControl = <Switch />;
        break;

      case 'Integer':
      case 'Decimal':
        inputControl = (
          <InputNumber
            min={attr.min_value ?? undefined}
            max={attr.max_value ?? undefined}
            placeholder={`请输入${fullLabel}`}
            controls={false}
            style={{ width: '150px' }}
          />
        );
        break;

      case 'String':
      case 'URL':
      default: {
        // 判断是否为多行文本字段（JSON富内容等）
        const isMultilineField = attr.name.includes('JSON') || attr.name.includes('富内容');

        if (isMultilineField) {
          inputControl = (
            <Input.TextArea
              placeholder={`请输入${fullLabel}`}
              rows={4}
              style={{ width: '500px' }}
            />
          );
        } else {
          inputControl = <Input placeholder={`请输入${fullLabel}`} style={{ width: '250px' }} />;
        }
        break;
      }
    }
  }

  // 为 is_aspect 属性添加"变体属性"标签
  const labelNode = attr.is_aspect ? (
    <Space size={4}>
      {displayLabel}
      <Tag color="blue" style={{ marginLeft: 4 }}>
        变体属性
      </Tag>
    </Space>
  ) : (
    displayLabel
  );

  return (
    <Form.Item key={attr.attribute_id} label={labelNode} tooltip={tooltipContent} style={{ marginBottom: 12 }}>
      <div
        style={{
          display: 'flex',
          gap: '0',
          alignItems: 'center',
          minWidth: '300px',
          maxWidth: '600px',
        }}
      >
        <Form.Item
          name={fieldName}
          valuePropName={attr.attribute_type === 'Boolean' ? 'checked' : undefined}
          rules={[
            { required, message: `请${attr.attribute_type === 'Boolean' ? '选择' : '输入'}${fullLabel}` },
            ...(attr.min_value !== undefined && attr.min_value !== null
              ? [
                  {
                    type: 'number' as const,
                    min: attr.min_value,
                    message: `${fullLabel}最小值为${attr.min_value}`,
                  },
                ]
              : []),
            ...(attr.max_value !== undefined && attr.max_value !== null
              ? [
                  {
                    type: 'number' as const,
                    max: attr.max_value,
                    message: `${fullLabel}最大值为${attr.max_value}`,
                  },
                ]
              : []),
          ]}
          noStyle
        >
          {/* 动态设置输入框样式：flex自适应 + 移除右侧圆角 */}
          {React.cloneElement(inputControl as React.ReactElement<{ style?: React.CSSProperties }>, {
            style: {
              ...((inputControl as React.ReactElement<{ style?: React.CSSProperties }>).props?.style || {}),
              // Switch 不需要 flex 拉伸，其他控件使用 flex: 1
              ...(attr.attribute_type !== 'Boolean'
                ? {
                    flex: 1,
                    minWidth: 0,
                    borderTopRightRadius: 0,
                    borderBottomRightRadius: 0,
                  }
                : {}),
            },
          })}
        </Form.Item>
        {/* 根据字段类型显示不同的按钮 */}
        {isTypeName ? (
          // 类型名称字段：显示生成按钮
          <Button
            icon={<ThunderboltOutlined />}
            onClick={handleGenerateTypeName}
            title="生成16位随机字符串"
            style={{
              flexShrink: 0,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              marginLeft: -1, // 紧贴输入框，覆盖边框
            }}
          >
            生成
          </Button>
        ) : (
          // 其他字段：显示"+"按钮（添加到变体）
          <Button
            icon={<PlusOutlined />}
            onClick={() => variantManager.addVariantDimension(attr)}
            disabled={isInVariant}
            title={isInVariant ? '已添加到变体' : '将当前属性添加变体属性'}
            style={{
              flexShrink: 0,
              borderTopLeftRadius: 0,
              borderBottomLeftRadius: 0,
              marginLeft: -1, // 紧贴输入框，覆盖边框
            }}
          />
        )}
      </div>
    </Form.Item>
  );
};
