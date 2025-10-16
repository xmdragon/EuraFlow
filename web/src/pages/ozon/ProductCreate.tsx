/**
 * OZON新建商品页面
 * 支持全新商品创建和跟卖模式
 */
import React, { useState } from 'react';
import {
  Card,
  Tabs,
  Form,
  Input,
  InputNumber,
  Button,
  Space,
  message,
  Row,
  Col,
  Alert,
  Divider,
  Upload,
} from 'antd';
import {
  PlusOutlined,
  SearchOutlined,
  ArrowRightOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import ShopSelector from '@/components/ozon/ShopSelector';
import * as ozonApi from '@/services/ozonApi';
import type { UploadFile } from 'antd/es/upload/interface';

const { TextArea } = Input;

const ProductCreate: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedShop, setSelectedShop] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('new');
  const [newForm] = Form.useForm();
  const [followForm] = Form.useForm();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [ozonProductData, setOzonProductData] = useState<any>(null);

  // 搜索OZON商品（跟卖）
  const searchOzonProductMutation = useMutation({
    mutationFn: async (values: { sku: string }) => {
      if (!selectedShop) throw new Error('请先选择店铺');
      return await ozonApi.getOzonProductInfo(selectedShop, undefined, undefined, parseInt(values.sku));
    },
    onSuccess: (data) => {
      if (data.success && data.data) {
        setOzonProductData(data.data);
        // 自动填充表单
        followForm.setFieldsValue({
          title: data.data.name,
          barcode: data.data.barcode,
          price: data.data.price,
          old_price: data.data.old_price,
          description: data.data.description,
          weight: data.data.weight,
          height: data.data.height,
          width: data.data.width,
          depth: data.data.depth,
        });
        message.success('成功获取OZON商品信息');
      } else {
        message.error(data.error || '未找到商品');
      }
    },
    onError: (error: any) => {
      message.error(`搜索失败: ${error.message}`);
    },
  });

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

  // 提交新建商品表单
  const handleNewProductSubmit = async (values: any) => {
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

  // 提交跟卖商品表单
  const handleFollowProductSubmit = async (values: any) => {
    if (!selectedShop) {
      message.error('请先选择店铺');
      return;
    }

    if (!ozonProductData) {
      message.error('请先搜索OZON商品');
      return;
    }

    try {
      // 使用OZON商品图片
      const imageUrls = ozonProductData.images || [];

      await createProductMutation.mutateAsync({
        shop_id: selectedShop,
        sku: values.sku,
        offer_id: values.offer_id,
        title: values.title,
        description: values.description || ozonProductData.description,
        price: values.price?.toString(),
        old_price: values.old_price?.toString(),
        stock: values.stock || 0,
        barcode: values.barcode || ozonProductData.barcode,
        category_id: ozonProductData.category_id,
        images: imageUrls,
        attributes: ozonProductData.attributes,
        height: values.height || ozonProductData.height,
        width: values.width || ozonProductData.width,
        depth: values.depth || ozonProductData.depth,
        weight: values.weight || ozonProductData.weight,
        dimension_unit: ozonProductData.dimension_unit || 'mm',
        weight_unit: ozonProductData.weight_unit || 'g',
      });
    } catch (error: any) {
      message.error(`操作失败: ${error.message}`);
    }
  };

  return (
    <div style={{ padding: 24 }}>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col span={12}>
          <h2 style={{ margin: 0 }}>
            <PlusOutlined /> 新建商品
          </h2>
        </Col>
        <Col span={12} style={{ textAlign: 'right' }}>
          <ShopSelector
            value={selectedShop}
            onChange={setSelectedShop}
            style={{ width: 200 }}
          />
        </Col>
      </Row>

      {!selectedShop && (
        <Alert
          message="请先选择店铺"
          description="在右上角选择一个店铺以创建商品"
          type="info"
          showIcon
          style={{ marginBottom: 24 }}
        />
      )}

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'new',
              label: '全新商品',
              children: (
                <Form
                  form={newForm}
                  layout="vertical"
                  onFinish={handleNewProductSubmit}
                  disabled={!selectedShop}
                >
                  <Alert
                    message="创建全新商品"
                    description="从零开始创建商品，需要填写完整信息。创建后需要在商品上架页面选择类目和填写属性。"
                    type="info"
                    showIcon
                    style={{ marginBottom: 24 }}
                  />

                  <Divider>基础信息</Divider>

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
                      <Button onClick={() => newForm.resetFields()}>
                        重置
                      </Button>
                    </Space>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'follow',
              label: '跟卖商品',
              children: (
                <Form
                  form={followForm}
                  layout="vertical"
                  onFinish={handleFollowProductSubmit}
                  disabled={!selectedShop}
                >
                  <Alert
                    message="跟卖模式"
                    description="通过OZON SKU搜索现有商品，自动获取商品信息（图片、类目、属性等），只需填写自己的价格和库存。"
                    type="success"
                    showIcon
                    style={{ marginBottom: 24 }}
                  />

                  <Divider>第一步：搜索OZON商品</Divider>

                  <Row gutter={16}>
                    <Col span={18}>
                      <Form.Item
                        label="OZON SKU"
                        name="ozon_sku"
                        rules={[{ required: true, message: '请输入OZON SKU' }]}
                      >
                        <Input placeholder="输入OZON平台的SKU编号" />
                      </Form.Item>
                    </Col>
                    <Col span={6}>
                      <Form.Item label=" ">
                        <Button
                          type="primary"
                          icon={<SearchOutlined />}
                          onClick={() => followForm.validateFields(['ozon_sku']).then((values) => {
                            searchOzonProductMutation.mutate({ sku: values.ozon_sku });
                          })}
                          loading={searchOzonProductMutation.isPending}
                          block
                        >
                          搜索商品
                        </Button>
                      </Form.Item>
                    </Col>
                  </Row>

                  {ozonProductData && (
                    <>
                      <Alert
                        message="找到商品"
                        description={`商品名称: ${ozonProductData.name} | 条形码: ${ozonProductData.barcode || '无'}`}
                        type="success"
                        showIcon
                        style={{ marginBottom: 24 }}
                      />

                      <Divider>第二步：填写您的信息</Divider>

                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Item
                            label="您的SKU"
                            name="sku"
                            rules={[{ required: true, message: '请输入SKU' }]}
                          >
                            <Input placeholder="您的内部SKU" />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item
                            label="Offer ID"
                            name="offer_id"
                            rules={[{ required: true, message: '请输入Offer ID' }]}
                          >
                            <Input placeholder="OZON商品标识符" />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Form.Item label="商品名称" name="title">
                        <Input disabled />
                      </Form.Item>

                      <Form.Item label="条形码" name="barcode">
                        <Input disabled />
                      </Form.Item>

                      <Row gutter={16}>
                        <Col span={8}>
                          <Form.Item
                            label="您的售价（RUB）"
                            name="price"
                            rules={[{ required: true, message: '请输入售价' }]}
                          >
                            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item label="原价（RUB）" name="old_price">
                            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item
                            label="库存"
                            name="stock"
                            rules={[{ required: true, message: '请输入库存' }]}
                          >
                            <InputNumber min={0} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Form.Item label="商品描述" name="description">
                        <TextArea rows={3} placeholder="可选：自定义描述" />
                      </Form.Item>

                      <Form.Item>
                        <Space>
                          <Button
                            type="primary"
                            htmlType="submit"
                            loading={createProductMutation.isPending}
                            icon={<ArrowRightOutlined />}
                          >
                            创建并跟卖
                          </Button>
                          <Button onClick={() => {
                            followForm.resetFields();
                            setOzonProductData(null);
                          }}>
                            重置
                          </Button>
                        </Space>
                      </Form.Item>
                    </>
                  )}
                </Form>
              ),
            },
          ]}
        />
      </Card>
    </div>
  );
};

export default ProductCreate;
