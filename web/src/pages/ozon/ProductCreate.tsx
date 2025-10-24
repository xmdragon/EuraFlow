/**
 * OZON新建商品页面 - 优化版
 * 参照OZON官方界面设计
 */
import {
  PlusOutlined,
  SyncOutlined,
  ExclamationCircleOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Form, Input, InputNumber, Button, Space, Upload, Cascader, Modal, Table } from 'antd';
import type { UploadFile } from 'antd/es/upload/interface';
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import styles from './ProductCreate.module.scss';

import ShopSelector from '@/components/ozon/ShopSelector';
import PageTitle from '@/components/PageTitle';
import { categoryTree as categoryTreeData } from '@/data/categoryTree';
import * as ozonApi from '@/services/ozonApi';
import { getNumberFormatter, getNumberParser } from '@/utils/formatNumber';
import { notifySuccess, notifyError, notifyWarning } from '@/utils/notification';

// 类目选项接口
interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
}

// 变体接口
interface ProductVariant {
  id: string;
  image?: string;
  video?: string;
  sku: string;
  price: number;
  oldPrice?: number;
}

const { TextArea } = Input;

const ProductCreate: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<number | null>(null);
  const [categoryTree, setCategoryTree] = useState<CategoryOption[]>([]);
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [hasCategoryData, setHasCategoryData] = useState(false);
  const [form] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [variants, setVariants] = useState<ProductVariant[]>([{ id: '1', sku: '', price: 0 }]);

  // 创建商品
  const createProductMutation = useMutation({
    mutationFn: async (data: ozonApi.CreateProductRequest) => {
      return await ozonApi.createProduct(data);
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('创建成功', '商品创建成功！');
        queryClient.invalidateQueries({ queryKey: ['products'] });
        navigate('/dashboard/ozon/listing');
      } else {
        notifyError('创建失败', data.error || '创建失败');
      }
    },
    onError: (error: any) => {
      notifyError('创建失败', `创建失败: ${error.message}`);
    },
  });

  // 上传图片到Cloudinary
  const uploadImageMutation = useMutation({
    mutationFn: async (data: ozonApi.UploadMediaRequest) => {
      return await ozonApi.uploadMedia(data);
    },
  });

  // 店铺变化时加载类目（从静态文件）
  useEffect(() => {
    if (selectedShop) {
      setCategoryTree(categoryTreeData);
      setHasCategoryData(categoryTreeData.length > 0);
    } else {
      setCategoryTree([]);
      setHasCategoryData(false);
    }
  }, [selectedShop]);

  // 同步类目
  const syncCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return await ozonApi.syncCategoryTree(selectedShop, true);
    },
    onSuccess: (data) => {
      if (data.success) {
        notifySuccess('同步成功', `已同步 ${data.synced_count || 0} 个类目。页面即将刷新...`);
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        notifyError('同步失败', `同步失败: ${data.error || '未知错误'}`);
      }
    },
    onError: (error: any) => {
      notifyError('同步失败', `同步失败: ${error.message}`);
    },
  });

  // 确认同步类目
  const handleSyncCategory = () => {
    if (!selectedShop) {
      notifyWarning('操作失败', '请先选择店铺');
      return;
    }

    Modal.confirm({
      title: '确认同步类目',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>此操作将：</p>
          <ul className={styles.helpText}>
            <li>清空数据库中的所有类目数据</li>
            <li>从OZON重新获取完整类目树</li>
            <li>预计耗时 10-30 秒</li>
          </ul>
          <p className={styles.errorText}>
            <strong>提示：</strong>
            同步期间请勿重复操作，同步完成后会自动刷新类目列表
          </p>
        </div>
      ),
      okText: '确认同步',
      okType: 'primary',
      cancelText: '取消',
      onOk() {
        syncCategoryMutation.mutate();
      },
    });
  };

  // 处理图片上传
  const handleImageUpload = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64 = reader.result as string;
          const result = await uploadImageMutation.mutateAsync({
            shop_id: selectedShop!,
            type: 'base64',
            data: base64,
            folder: 'products',
          });

          if (result.success) {
            resolve(result.url);
          } else {
            reject(new Error(result.error || '上传失败'));
          }
        } catch (error: any) {
          reject(error);
        }
      };
      reader.onerror = () => reject(new Error('文件读取失败'));
      reader.readAsDataURL(file);
    });
  };

  // 提交商品表单
  const handleProductSubmit = async (values: any) => {
    if (!selectedShop) {
      notifyError('操作失败', '请先选择店铺');
      return;
    }

    try {
      // 上传图片
      const imageUrls: string[] = [];
      for (const file of fileList) {
        if (file.originFileObj) {
          const url = await handleImageUpload(file.originFileObj);
          imageUrls.push(url);
        }
      }

      // 创建商品
      await createProductMutation.mutateAsync({
        shop_id: selectedShop,
        sku: values.sku,
        offer_id: values.offer_id,
        title: values.title,
        description: values.description,
        price: values.price?.toString(),
        old_price: values.old_price?.toString(),
        stock: values.stock || 0,
        category_id: selectedCategory || undefined,
        images: imageUrls,
        height: values.height,
        width: values.width,
        depth: values.depth,
        weight: values.weight,
        dimension_unit: 'mm',
        weight_unit: 'g',
      });
    } catch (error: any) {
      notifyError('操作失败', `操作失败: ${error.message}`);
    }
  };

  // 变体表格列定义
  const variantColumns = [
    {
      title: '图片',
      dataIndex: 'image',
      key: 'image',
      width: 80,
      render: (image: string) =>
        image ? (
          <img src={image} alt="variant" className={styles.variantImage} />
        ) : (
          <div className={styles.variantPlaceholder}>-</div>
        ),
    },
    {
      title: '视频',
      dataIndex: 'video',
      key: 'video',
      width: 80,
      render: (video: string) =>
        video ? '有' : <div className={styles.variantPlaceholder}>-</div>,
    },
    {
      title: '货号',
      dataIndex: 'sku',
      key: 'sku',
      render: (sku: string) => sku || '-',
    },
    {
      title: '售价（₽）',
      dataIndex: 'price',
      key: 'price',
      width: 120,
      render: (price: number) => price.toFixed(2),
    },
    {
      title: '划线价（₽）',
      dataIndex: 'oldPrice',
      key: 'oldPrice',
      width: 120,
      render: (oldPrice?: number) => (oldPrice ? oldPrice.toFixed(2) : '-'),
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: ProductVariant) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDeleteVariant(record.id)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  // 添加变体
  const handleAddVariant = () => {
    const newVariant: ProductVariant = {
      id: Date.now().toString(),
      sku: '',
      price: 0,
    };
    setVariants([...variants, newVariant]);
  };

  // 删除变体
  const handleDeleteVariant = (id: string) => {
    if (variants.length === 1) {
      notifyWarning('操作失败', '至少保留一个变体');
      return;
    }
    setVariants(variants.filter((v) => v.id !== id));
  };

  return (
    <div className={styles.container}>
      <PageTitle icon={<PlusOutlined />} title="新建商品" />

      <div className={styles.formCard}>
        <Form form={form} layout="vertical" onFinish={handleProductSubmit}>
          {/* 主要信息 */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>主要信息</h3>

            <Form.Item
              label="选择店铺"
              name="shop_id"
              rules={[{ required: true, message: '请选择店铺' }]}
            >
              <ShopSelector
                value={selectedShop}
                onChange={(shopId) => setSelectedShop(shopId as number)}
                showAllOption={false}
              />
            </Form.Item>

            <Form.Item
              label="产品类目"
              name="category_id"
              rules={[{ required: true, message: '请选择产品类目' }]}
            >
              <div className={styles.categorySelector}>
                <Cascader
                  className={styles.cascader}
                  options={categoryTree}
                  onChange={(value) => {
                    const catId =
                      value && value.length > 0 ? (value[value.length - 1] as number) : null;
                    setSelectedCategory(catId);
                    form.setFieldValue('category_id', catId);
                  }}
                  placeholder="请选择产品类目"
                  expandTrigger="click"
                  changeOnSelect={false}
                  showSearch={{
                    filter: (inputValue, path) =>
                      path.some((option) =>
                        (option.label as string).toLowerCase().includes(inputValue.toLowerCase())
                      ),
                  }}
                  disabled={!selectedShop || categoryLoading}
                  loading={categoryLoading}
                />
                <Button
                  className={styles.syncBtn}
                  icon={<SyncOutlined />}
                  onClick={handleSyncCategory}
                  loading={syncCategoryMutation.isPending || categoryLoading}
                  disabled={!selectedShop || syncCategoryMutation.isPending}
                >
                  同步类目
                </Button>
              </div>
              {!hasCategoryData && selectedShop && (
                <span className={styles.errorText}>数据库无类目数据，请点击"同步类目"按钮</span>
              )}
            </Form.Item>

            <Form.Item
              label="商品名称"
              name="title"
              rules={[{ required: true, message: '请输入商品名称' }]}
            >
              <Input placeholder="商品标题" maxLength={200} showCount />
            </Form.Item>

            <Form.Item label="商品描述" name="description">
              <TextArea rows={4} placeholder="商品详细描述" maxLength={5000} showCount />
            </Form.Item>

            <div className={styles.formRow}>
              <div className={styles.formCol}>
                <Form.Item
                  label="SKU"
                  name="sku"
                  rules={[{ required: true, message: '请输入SKU' }]}
                >
                  <Input placeholder="商家内部SKU" />
                </Form.Item>
              </div>
              <div className={styles.formCol}>
                <Form.Item
                  label="Offer ID"
                  name="offer_id"
                  rules={[{ required: true, message: '请输入Offer ID' }]}
                >
                  <Input placeholder="OZON商品标识符" />
                </Form.Item>
              </div>
            </div>

            <div className={styles.dimensionGroup}>
              <div className={styles.dimensionItem}>
                <Form.Item label="包装长度（mm）" name="depth">
                  <InputNumber min={0} placeholder="长" controls={false} />
                </Form.Item>
              </div>
              <div className={styles.dimensionItem}>
                <Form.Item label="包装宽度（mm）" name="width">
                  <InputNumber min={0} placeholder="宽" controls={false} />
                </Form.Item>
              </div>
              <div className={styles.dimensionItem}>
                <Form.Item label="包装高度（mm）" name="height">
                  <InputNumber min={0} placeholder="高" controls={false} />
                </Form.Item>
              </div>
              <div className={styles.dimensionItem}>
                <Form.Item label="重量（g）" name="weight">
                  <InputNumber min={0} placeholder="重量" controls={false} />
                </Form.Item>
              </div>
            </div>
          </div>

          {/* 价格信息 */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>价格信息</h3>

            <div className={styles.formRow}>
              <div className={styles.formCol}>
                <Form.Item
                  label="售价（RUB）"
                  name="price"
                  rules={[{ required: true, message: '请输入售价' }]}
                >
                  <InputNumber
                    min={0}
                    placeholder="0"
                    controls={false}
                    formatter={getNumberFormatter(2)}
                    parser={getNumberParser()}
                  />
                </Form.Item>
              </div>
              <div className={styles.formCol}>
                <Form.Item label="原价（RUB）" name="old_price">
                  <InputNumber
                    min={0}
                    placeholder="0"
                    controls={false}
                    formatter={getNumberFormatter(2)}
                    parser={getNumberParser()}
                  />
                </Form.Item>
              </div>
            </div>

            <Form.Item label="库存" name="stock" initialValue={0}>
              <InputNumber min={0} placeholder="0" controls={false} />
            </Form.Item>
          </div>

          {/* 商品图片 */}
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>商品图片</h3>

            <div className={styles.uploadArea}>
              <Upload
                listType="picture-card"
                fileList={fileList}
                beforeUpload={() => false}
                onChange={({ fileList }) => setFileList(fileList)}
                maxCount={15}
              >
                {fileList.length < 15 && (
                  <div>
                    <PlusOutlined />
                    <div>上传</div>
                  </div>
                )}
              </Upload>
              <div className={styles.uploadHint}>支持JPG/PNG格式，建议3:4比例，最多15张</div>
            </div>
          </div>

          {/* 变体设置 */}
          <div className={styles.section}>
            <div className={styles.variantSection}>
              <div className={styles.variantHeader}>
                <span className={styles.variantInfo}>共 {variants.length} 个变体</span>
                <div className={styles.variantActions}>
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleAddVariant}>
                    添加变体
                  </Button>
                </div>
              </div>

              <Table
                columns={variantColumns}
                dataSource={variants}
                rowKey="id"
                pagination={false}
                size="small"
              />
            </div>
          </div>
        </Form>
      </div>

      {/* 底部操作栏 */}
      <div className={styles.actionBar}>
        <div className={styles.leftActions}>
          <Button onClick={() => form.resetFields()}>重置</Button>
        </div>
        <div className={styles.rightActions}>
          <Button size="large">保存草稿</Button>
          <Button
            type="primary"
            size="large"
            className={styles.primaryBtn}
            icon={<PlusOutlined />}
            loading={createProductMutation.isPending || uploadImageMutation.isPending}
            onClick={() => form.submit()}
          >
            上架至 OZON
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductCreate;
