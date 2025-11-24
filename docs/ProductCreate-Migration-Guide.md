# ProductCreate.tsx 拆分迁移指南

## 概述

本次重构将 `ProductCreate.tsx` 的核心业务逻辑拆分到独立的 Service 层，降低文件复杂度，提高代码可维护性和可测试性。

**重构时间**：2025-11-24
**重构类型**：渐进式拆分（第一阶段）
**文件变化**：2547 行 → 2102 行（减少 445 行，约 17.5%）

---

## 新增 Service 文件

### 1. `productTitleService.ts`

**路径**：`web/src/services/ozon/productTitleService.ts`

**职责**：
- 商品标题生成（按 OZON 官方命名规范）
- 标题翻译（中文 ↔ 俄文）
- 检查类目是否支持自动生成标题

**主要函数**：
- `generateProductTitle(params)` - 生成商品标题
- `translateTitle(params)` - 翻译标题
- `isAutoTitleCategory(categoryName)` - 检查是否自动生成标题的类目
- `getCategoryNameById(categoryId, tree)` - 从类目树查找类目名称

**导出常量**：
- `OZON_AUTO_TITLE_CATEGORIES` - 自动生成标题的类目列表

---

### 2. `categoryService.ts`

**路径**：`web/src/services/ozon/categoryService.ts`

**职责**：
- 类目树数据加载与管理
- 类目属性加载
- 字典值搜索
- 类目路径查询与转换

**主要函数**：
- `loadCategoryTree()` - 从 public 目录加载类目树
- `loadCategoryAttributes(params)` - 加载类目属性
- `loadDictionaryValues(...)` - 加载字典值（属性值搜索）
- `getCategoryPath(categoryId, tree)` - 获取类目完整路径
- `getCategoryNameById(categoryId, tree)` - 获取类目名称
- `extractSpecialFieldDescriptions(attributes)` - 提取特殊字段说明
- `extractAspectAttributes(attributes)` - 筛选变体维度属性
- `batchLoadDictionaryValues(...)` - 批量加载字典值

**类型导出**：
- `CategoryOption` - 类目选项接口
- `CategoryAttributesResult` - 类目属性加载结果

---

### 3. `productSubmitService.ts`

**路径**：`web/src/services/ozon/productSubmitService.ts`

**职责**：
- 包装尺寸同步到类目属性
- 表单数据转换为 OZON API 格式
- 属性与变体的格式转换
- 商品提交参数组装

**主要函数**：
- `syncDimensionsToAttributes(params)` - 同步包装尺寸到类目属性
- `formatAttributeForAPI(attribute, value)` - 转换单个属性为 API 格式
- `formatAttributesForAPI(form, categoryAttributes)` - 转换表单属性为 API 格式
- `formatVariantForAPI(variant, categoryAttributes)` - 转换变体为 API 格式
- `formatVariantsForAPI(variants, categoryAttributes)` - 转换变体列表为 API 格式
- `parseTextAreaToArray(text)` - 解析 TextArea 多行文本为数组
- `getDescriptionCategoryId(categoryPath)` - 获取描述类目 ID（父类目 ID）

**类型导出**：
- `ProductVariant` - 变体接口
- `OzonAttribute` - OZON API 属性格式
- `OzonVariant` - OZON API 变体格式
- `ProductSubmitParams` - 商品提交参数

---

## ProductCreate.tsx 代码变更

### 导入语句变更

**新增导入**：
```typescript
import * as productTitleService from '@/services/ozon/productTitleService';
import * as categoryService from '@/services/ozon/categoryService';
import * as productSubmitService from '@/services/ozon/productSubmitService';
```

---

### 函数变更对照表

| 原函数名 | 变更类型 | 新位置/调用方式 |
|---------|----------|---------------|
| `loadCategoryTree()` | 迁移 | `categoryService.loadCategoryTree()` |
| `getCategoryPath()` | 迁移 | `categoryService.getCategoryPath()` |
| `loadCategoryAttributes()` | 简化 | 调用 `categoryService.loadCategoryAttributes()` |
| `loadDictionaryValues()` | 简化 | 调用 `categoryService.loadDictionaryValues()` |
| `getCategoryNameById()` | 迁移 | `productTitleService.getCategoryNameById()` |
| `handleGenerateTitle()` | 大幅简化 | 调用 `productTitleService.generateProductTitle()` |
| `handleTranslateTitle()` | 简化 | 调用 `productTitleService.translateTitle()` |
| `syncDimensionsToAttributes()` | 简化 | 调用 `productSubmitService.syncDimensionsToAttributes()` |
| `handleProductSubmit()` | 大幅简化 | 调用多个 `productSubmitService` 函数 |

---

### 详细变更示例

#### 1. 标题生成函数

**Before**（~220 行）：
```typescript
const handleGenerateTitle = () => {
  const categoryName = selectedCategory ? getCategoryNameById(selectedCategory, categoryTree) : null;

  if (categoryName && OZON_AUTO_TITLE_CATEGORIES.includes(categoryName)) {
    Modal.info({ ... });
    return;
  }

  // 大量的标题组装逻辑（品牌、型号、颜色、重量等）
  // ...

  form.setFieldsValue({ title: generatedTitle });
  notifySuccess('标题已生成', '...');
};
```

**After**（~25 行）：
```typescript
const handleGenerateTitle = () => {
  const generatedTitle = productTitleService.generateProductTitle({
    form,
    selectedCategory,
    categoryTree,
    categoryAttributes,
    dictionaryValuesCache,
    variantManager
  });

  if (generatedTitle) {
    form.setFieldsValue({ title: generatedTitle });
    setTitleTranslationCache('');
    setShowingTranslation(false);
    notifySuccess('标题已生成', 'OZON 官方命名规范：...');
  }
};
```

**收益**：
- 函数长度从 220 行降低到 25 行（减少 88%）
- 业务逻辑可独立测试
- 可在其他页面复用（如 `ProductEdit.tsx`）

---

#### 2. 商品提交函数

**Before**（~190 行）：
```typescript
const handleProductSubmit = async (values: ProductFormValues) => {
  // ...

  // 属性转换（~50 行）
  const attributes = categoryAttributes.filter(...).map(attr => {
    // 复杂的格式转换逻辑
  });

  // 变体转换（~50 行）
  const formattedVariants = variantManager.variants.map(variant => {
    // 复杂的格式转换逻辑
  });

  // TextArea 解析（~10 行）
  const images360 = allFormValues.images360
    ? String(allFormValues.images360).split('\n').map(...).filter(...)
    : undefined;

  // 类目 ID 提取（~5 行）
  const descriptionCategoryId = categoryPath && categoryPath.length >= 2
    ? categoryPath[categoryPath.length - 2]
    : undefined;

  // 提交
  await createProductMutation.mutateAsync({ ... });
};
```

**After**（~85 行）：
```typescript
const handleProductSubmit = async (values: ProductFormValues) => {
  // ...

  // 属性转换（1 行）
  const attributes = productSubmitService.formatAttributesForAPI(form, categoryAttributes);

  // 变体转换（1 行）
  const formattedVariants = productSubmitService.formatVariantsForAPI(
    variantManager.variants,
    categoryAttributes
  );

  // TextArea 解析（2 行）
  const images360 = productSubmitService.parseTextAreaToArray(allFormValues.images360);
  const pdfList = productSubmitService.parseTextAreaToArray(allFormValues.pdf_list);

  // 类目 ID 提取（1 行）
  const descriptionCategoryId = productSubmitService.getDescriptionCategoryId(categoryPath);

  // 提交
  await createProductMutation.mutateAsync({ ... });
};
```

**收益**：
- 函数长度从 190 行降低到 85 行（减少 55%）
- 格式转换逻辑可独立测试
- 更易于维护和调试

---

## 迁移影响评估

### ✅ 优点
- **可维护性提升**：核心业务逻辑独立，易于理解和修改
- **可测试性提升**：Service 层纯函数，易于编写单元测试
- **可复用性提升**：Service 可在其他页面复用（如 `ProductEdit.tsx`）
- **代码结构清晰**：UI 层与业务逻辑分离
- **减少 Git 冲突**：文件变小，多人协作时冲突概率降低

### ⚠️ 注意事项
- Service 层函数需要传递较多参数（通过参数对象解决）
- 类型定义需要在 Service 层重新声明（保持类型安全）
- 导入路径变更（需要更新 import 语句）

### 📊 性能影响
- **无**：仅代码组织变更，不影响运行时性能
- **构建时间**：略微增加（多 3 个文件）
- **包体积**：无明显变化

---

## 后续改进建议

### 第二阶段拆分（可选）

如果未来需要进一步优化，可以考虑拆分 UI 组件层：

**建议新增组件**：
1. `ProductBasicSection.tsx` - 店铺选择、类目选择、基础信息
2. `ProductAttributesSection.tsx` - 必填属性、选填属性渲染
3. `ProductVariantSection.tsx` - 变体表格区域
4. `ProductMediaSection.tsx` - 图片管理、视频管理
5. `ProductPriceSection.tsx` - 价格信息、采购信息

**预期收益**：
- 文件大小降低到 800-1000 行
- 组件职责更加清晰
- 更易于并行开发

---

### 单元测试建议

**优先测试的 Service 函数**：

1. **productTitleService.ts**
   - `generateProductTitle()` - 测试各种属性组合生成的标题是否符合规范
   - `isAutoTitleCategory()` - 测试类目判断逻辑
   - `getCategoryNameById()` - 测试类目树递归查找

2. **categoryService.ts**
   - `getCategoryPath()` - 测试类目路径提取
   - `extractAspectAttributes()` - 测试变体维度属性筛选
   - `parseTextAreaToArray()` - 测试多行文本解析

3. **productSubmitService.ts**
   - `formatAttributeForAPI()` - 测试属性格式转换
   - `formatVariantForAPI()` - 测试变体格式转换
   - `syncDimensionsToAttributes()` - 测试尺寸单位转换
   - `getDescriptionCategoryId()` - 测试父类目 ID 提取

---

## 回滚方案

如果遇到问题，可以通过 Git 回退到重构前的版本：

```bash
# 查看重构前的提交
git log --oneline --grep="refactor(ozon): 移除 setup() 函数中的数据库访问"

# 回退到重构前（示例）
git revert <commit-hash>
```

**注意**：回退后需要同时删除 3 个新增的 Service 文件。

---

## 常见问题

### Q1: 为什么不一次性拆分为多个子组件？

**A**: 渐进式拆分策略：
- 第一阶段拆分 Service 层，风险低，易于测试和回滚
- 第二阶段拆分 UI 组件层，需要更多的架构设计
- 分步进行降低风险，便于增量验证

### Q2: Service 层函数参数过多怎么办？

**A**: 使用参数对象模式：
```typescript
// ✅ 好的做法
generateProductTitle(params: GenerateTitleParams)

// ❌ 不好的做法
generateProductTitle(form, selectedCategory, categoryTree, ...)
```

### Q3: 如何在其他页面复用这些 Service？

**A**: 直接导入使用：
```typescript
import * as productTitleService from '@/services/ozon/productTitleService';

// 在 ProductEdit.tsx 中使用
const title = productTitleService.generateProductTitle({ ... });
```

### Q4: Service 层是否需要处理错误？

**A**: 分层处理：
- Service 层抛出异常
- 组件层捕获并显示用户友好的错误提示
- 示例：`categoryService.loadCategoryTree()` 失败时会抛出异常

---

## 相关文档

- [COMPONENTS.md](../COMPONENTS.md) - 新增 Service 的使用说明
- [CLAUDE.md](../CLAUDE.md) - 项目开发规范
- [FAQ.md](../FAQ.md) - 常见问题解答

---

## 总结

本次渐进式拆分成功将 ProductCreate.tsx 的核心业务逻辑迁移到独立的 Service 层，降低了文件复杂度，提高了代码可维护性和可测试性。

**关键成果**：
- ✅ 文件大小降低 17.5%（2547 → 2102 行）
- ✅ 创建 3 个可复用的 Service 模块
- ✅ 保持 UI 层稳定，降低回归风险
- ✅ 为未来进一步拆分奠定基础

**下一步**：
- 执行 `npm run type-check` 验证编译
- 更新 `COMPONENTS.md` 文档
- 本地测试验证功能正常
