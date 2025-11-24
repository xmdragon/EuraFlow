/**
 * 标题翻译Hook
 * 管理商品标题生成、翻译、切换等逻辑
 */
import { useState } from 'react';
import type { FormInstance } from 'antd';
import type { CategoryAttribute, DictionaryValue } from '@/services/ozon';
import type { ProductVariant } from '@/hooks/useVariantManager';
import * as productTitleService from '@/services/ozon/productTitleService';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';
import type { CategoryOption } from './useCategoryManager';

export interface UseTitleTranslationProps {
  form: FormInstance;
  selectedCategory: number | null;
  categoryTree: CategoryOption[];
  categoryAttributes: CategoryAttribute[];
  dictionaryValuesCache: Record<number, DictionaryValue[]>;
  variantDimensions: Array<{ attribute_id: number }>;
  variants: ProductVariant[];
}

export interface UseTitleTranslationReturn {
  // 状态
  titleTranslationCache: string;
  showingTranslation: boolean;
  isTranslating: boolean;

  // 状态更新函数
  setTitleTranslationCache: (cache: string) => void;
  setShowingTranslation: (showing: boolean) => void;

  // 业务逻辑函数
  handleGenerateTitle: () => void;
  handleTranslateTitle: () => Promise<void>;
}

export const useTitleTranslation = ({
  form,
  selectedCategory,
  categoryTree,
  categoryAttributes,
  dictionaryValuesCache,
  variantDimensions,
  variants,
}: UseTitleTranslationProps): UseTitleTranslationReturn => {
  const [titleTranslationCache, setTitleTranslationCache] = useState<string>('');
  const [showingTranslation, setShowingTranslation] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);

  /**
   * 生成商品标题（根据 OZON 官方命名规范）
   * 格式：类型 + 品牌 + 型号（系列 + 说明）+ 制造商货号 + ，（逗号）+ 属性
   */
  const handleGenerateTitle = () => {
    const generatedTitle = productTitleService.generateProductTitle({
      form,
      selectedCategory,
      categoryTree,
      categoryAttributes,
      dictionaryValuesCache,
      variantDimensions,
      variants,
    });

    if (generatedTitle) {
      // 设置生成的标题
      form.setFieldsValue({ title: generatedTitle });

      // 清空翻译缓存
      setTitleTranslationCache('');
      setShowingTranslation(false);

      // 提示用户
      notifySuccess(
        '标题已生成',
        'OZON 官方命名规范：类型 + 品牌 + 型号 + 制造商货号 + ，（逗号）+ 属性（颜色、重量、体积等）'
      );
    }
  };

  /**
   * 翻译标题（中文 <-> 俄文）
   */
  const handleTranslateTitle = async () => {
    const currentTitle = form.getFieldValue('title');

    if (!currentTitle?.trim()) {
      notifyWarning('无标题', '请先输入或生成标题');
      return;
    }

    // 如果正在显示翻译，切换回原文
    if (showingTranslation && titleTranslationCache) {
      form.setFieldsValue({ title: titleTranslationCache });
      setShowingTranslation(false);
      return;
    }

    // 如果有缓存且当前显示的是原文，直接使用缓存
    if (titleTranslationCache && !showingTranslation) {
      const originalTitle = currentTitle;
      form.setFieldsValue({ title: titleTranslationCache });
      setTitleTranslationCache(originalTitle); // 缓存原文
      setShowingTranslation(true);
      return;
    }

    // 执行翻译（使用真实翻译 API）
    setIsTranslating(true);
    try {
      const translatedText = await productTitleService.translateTitle({
        text: currentTitle,
        sourceLang: 'zh',
        targetLang: 'ru',
      });

      setTitleTranslationCache(currentTitle); // 缓存原文
      form.setFieldsValue({ title: translatedText });
      setShowingTranslation(true);
      notifySuccess('翻译成功', '标题已翻译为俄文');
    } catch (error) {
      notifyError('翻译失败', (error as Error).message);
    } finally {
      setIsTranslating(false);
    }
  };

  return {
    // 状态
    titleTranslationCache,
    showingTranslation,
    isTranslating,

    // 状态更新函数
    setTitleTranslationCache,
    setShowingTranslation,

    // 业务逻辑函数
    handleGenerateTitle,
    handleTranslateTitle,
  };
};
