import React from 'react';
import { Form, Input, InputNumber, Select, Switch, Button, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozonApi';
import { isColorAttribute, getColorValue, getTextColor } from '@/utils/colorMapper';

interface AttributeFieldProps {
  attr: CategoryAttribute;
  dictionaryValuesCache: Record<number, DictionaryValue[]>;
  loadDictionaryValues: (dictionaryId: number, searchText?: string) => Promise<DictionaryValue[]>;
  setDictionaryValuesCache: React.Dispatch<React.SetStateAction<Record<number, DictionaryValue[]>>>;
  variantManager: {
    hiddenFields: Set<string>;
    variantDimensions: Array<{ attribute_id: number }>;
    addVariantDimension: (attr: CategoryAttribute) => void;
  };
}

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
  const fieldName = `attr_${attr.attribute_id}`;
  const { label, bracketContent } = extractBracketContent(attr.name);
  const { displayLabel, originalLabel } = abbreviateLongLabel(label);
  const required = attr.is_required;
  const tooltipContent = renderTooltipContent(attr.description, bracketContent, originalLabel);

  // 根据类型渲染不同的控件
  // 使用完整label用于提示信息，使用displayLabel用于显示
  const fullLabel = originalLabel || displayLabel;

  // 过滤重复字段：隐藏与默认表单字段重复的类目特征
  // 4180=名称（对应title）, 4191=简介（对应description）, 8790=PDF文件（对应pdf_list）, 8789=PDF文件名称
  const DUPLICATE_ATTRIBUTE_IDS = [4180, 4191, 8790, 8789];
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

    inputControl = (
      <Select
        showSearch
        placeholder={`请选择${fullLabel}`}
        popupMatchSelectWidth={false}
        filterOption={false}
        style={{ width: '250px' }}
        onSearch={async (value) => {
          // 搜索时动态加载并更新缓存
          if (value) {
            const values = await loadDictionaryValues(attr.dictionary_id!, value);
            // 更新缓存以触发重新渲染
            setDictionaryValuesCache((prev) => ({
              ...prev,
              [attr.dictionary_id!]: values,
            }));
          }
        }}
        onFocus={async () => {
          // 获取焦点时加载初始值（如果缓存为空）
          if (!dictionaryValuesCache[attr.dictionary_id!]) {
            await loadDictionaryValues(attr.dictionary_id!);
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
      default:
        inputControl = <Input placeholder={`请输入${fullLabel}`} style={{ width: '250px' }} />;
        break;
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
          {React.cloneElement(inputControl as React.ReactElement<any>, {
            style: {
              ...((inputControl as React.ReactElement<any>).props?.style || {}),
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
      </div>
    </Form.Item>
  );
};
