/**
 * OZON新建商品页面
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  Card,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  message,
  Row,
  Col,
  Divider,
  Upload,
  Cascader,
} from 'antd';
import {
  PlusOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import ShopSelector from '@/components/ozon/ShopSelector';
import * as ozonApi from '@/services/ozonApi';
import type { UploadFile } from 'antd/es/upload/interface';

// 类目选项接口
interface CategoryOption {
  value: number;
  label: string;
  children?: CategoryOption[];
  isLeaf?: boolean;
  disabled?: boolean;
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

  // 创建商品
  const createProductMutation = useMutation({
    mutationFn: async (data: ozonApi.CreateProductRequest) => {
      return await ozonApi.createProduct(data);
    },
    onSuccess: (data) => {
      if (data.success) {
        message.success('商品创建成功！');
        queryClient.invalidateQueries({ queryKey: ['products'] });
        // 跳转到商品上架页面
        navigate('/dashboard/ozon/listing');
      } else {
        message.error(data.error || '创建失败');
      }
    },
    onError: (error: any) => {
      message.error(`创建失败: ${error.message}`);
    },
  });

  // 上传图片到Cloudinary
  const uploadImageMutation = useMutation({
    mutationFn: async (data: ozonApi.UploadMediaRequest) => {
      return await ozonApi.uploadMedia(data);
    },
  });

  // 加载类目树
  const loadCategoryTree = useCallback(async () => {
    if (!selectedShop) return;

    setCategoryLoading(true);
    try {
      const result = await ozonApi.getCategoryTree(selectedShop);
      if (result.success) {
        setCategoryTree(result.data || []);
        setHasCategoryData(result.data && result.data.length > 0);
      } else {
        message.error('加载类目失败');
      }
    } catch (error: any) {
      message.error(`加载类目失败: ${error.message}`);
    } finally {
      setCategoryLoading(false);
    }
  }, [selectedShop]);

  // 店铺变化时加载类目
  useEffect(() => {
    if (selectedShop) {
      loadCategoryTree();
    } else {
      setCategoryTree([]);
      setHasCategoryData(false);
    }
  }, [selectedShop, loadCategoryTree]);

  // 同步类目
  const syncCategoryMutation = useMutation({
    mutationFn: async () => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return await ozonApi.syncCategoryTree(selectedShop, false);
    },
    onSuccess: (data) => {
      if (data.success) {
        message.success(`同步成功！已同步 ${data.synced_count || 0} 个类目`);
        loadCategoryTree(); // 重新加载类目树
      } else {
        message.error(`同步失败: ${data.error || '未知错误'}`);
      }
    },
    onError: (error: any) => {
      message.error(`同步失败: ${error.message}`);
    },
  });

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
      message.error('请先选择店铺');
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
      message.error(`操作失败: ${error.message}`);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ marginBottom: 24 }}>
        <PlusOutlined /> 新建商品
      </h2>

      <Card>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleProductSubmit}
        >
          <Divider>基础信息</Divider>

          <Form.Item
            label="选择店铺"
            name="shop_id"
            rules={[{ required: true, message: '请选择店铺' }]}
          >
            <ShopSelector
              value={selectedShop}
              onChange={setSelectedShop}
              showAllOption={false}
            />
          </Form.Item>

          <Form.Item
            label="产品类目"
            name="category_id"
            rules={[{ required: true, message: '请选择产品类目' }]}
            extra={!hasCategoryData && selectedShop && (
              <span style={{ color: '#ff4d4f' }}>
                数据库无类目数据，请点击右侧"同步类目"按钮
              </span>
            )}
          >
            <Space.Compact style={{ width: '100%' }}>
              <Cascader
                options={categoryTree}
                onChange={(value) => {
                  const catId = value && value.length > 0
                    ? value[value.length - 1] as number
                    : null;
                  setSelectedCategory(catId);
                  form.setFieldValue('category_id', catId);
                }}
                placeholder="请选择产品类目"
                expandTrigger="hover"
                changeOnSelect={false}
                showSearch={{
                  filter: (inputValue, path) =>
                    path.some(option =>
                      (option.label as string).toLowerCase().includes(inputValue.toLowerCase())
                    )
                }}
                disabled={!selectedShop || categoryLoading}
                loading={categoryLoading}
                style={{ width: 'calc(100% - 100px)' }}
              />
              <Button
                icon={<SyncOutlined />}
                onClick={() => syncCategoryMutation.mutate()}
                loading={syncCategoryMutation.isPending || categoryLoading}
                disabled={!selectedShop}
              >
                同步类目
              </Button>
            </Space.Compact>
          </Form.Item>

          <Row gutter={16}>
            <Col span={8}>
              <Form.Item
                label="SKU"
                name="sku"
                rules={[{ required: true, message: '请输入SKU' }]}
              >
                <Input placeholder="商家内部SKU" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="Offer ID"
                name="offer_id"
                rules={[{ required: true, message: '请输入Offer ID' }]}
              >
                <Input placeholder="OZON商品标识符" />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="库存"
                name="stock"
                initialValue={0}
              >
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Form.Item
            label="商品名称"
            name="title"
            rules={[{ required: true, message: '请输入商品名称' }]}
          >
            <Input placeholder="商品标题" maxLength={200} showCount />
          </Form.Item>

          <Form.Item
            label="商品描述"
            name="description"
          >
            <TextArea rows={4} placeholder="商品详细描述" maxLength={5000} showCount />
          </Form.Item>

          <Divider>价格信息</Divider>

          <Row gutter={16}>
            <Col span={12}>
              <Form.Item
                label="售价（RUB）"
                name="price"
                rules={[{ required: true, message: '请输入售价' }]}
              >
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item
                label="原价（RUB）"
                name="old_price"
              >
                <InputNumber min={0} precision={2} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider>尺寸重量</Divider>

          <Row gutter={16}>
            <Col span={6}>
              <Form.Item label="长度（mm）" name="depth">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="宽度（mm）" name="width">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="高度（mm）" name="height">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={6}>
              <Form.Item label="重量（g）" name="weight">
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider>商品图片</Divider>

          <Form.Item label="上传图片" help="支持JPG/PNG格式，建议3:4比例，最多15张">
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
                  <div style={{ marginTop: 8 }}>上传</div>
                </div>
              )}
            </Upload>
          </Form.Item>

          <Form.Item>
            <Space>
              <Button
                type="primary"
                htmlType="submit"
                loading={createProductMutation.isPending || uploadImageMutation.isPending}
                icon={<PlusOutlined />}
              >
                创建商品
              </Button>
              <Button onClick={() => form.resetFields()}>
                重置
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
};

export default ProductCreate;
