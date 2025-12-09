/**
 * 第三方服务配置Tab
 * 整合：Cloudinary图床、汇率API、翻译配置、象寄图片
 */
import {
  DollarOutlined,
  PictureOutlined,
  ReloadOutlined,
  LineChartOutlined,
  TranslationOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Alert,
  Row,
  Col,
  Statistic,
  Spin,
  Segmented,
  Tabs,
} from "antd";
import React, { useEffect, useState } from "react";

import styles from "./ThirdPartyServicesTab.module.scss";

import ImageStorageConfigTab from "./ImageStorageConfigTab";
import RateChart from "./RateChart";
import TranslationConfigTab from "./TranslationConfigTab";
import { usePermission } from "@/hooks/usePermission";
import * as exchangeRateApi from "@/services/exchangeRateApi";
import * as xiangjifanyiApi from "@/services/xiangjifanyiApi";
import type { FormValues } from "@/types/common";
import { notifySuccess, notifyError, notifyInfo } from "@/utils/notification";

const ThirdPartyServicesTab: React.FC = () => {
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const [exchangeRateForm] = Form.useForm();
  const [xiangjifanyiForm] = Form.useForm();
  const [timeRange, setTimeRange] = useState<"today" | "week" | "month">(
    "today",
  );

  // ========== 汇率配置 ==========
  const { data: exchangeRateConfig } = useQuery({
    queryKey: ["exchange-rate", "config"],
    queryFn: exchangeRateApi.getExchangeRateConfig,
  });

  const { data: currentRate, isLoading: rateLoading } = useQuery({
    queryKey: ["exchange-rate", "current"],
    queryFn: () => exchangeRateApi.getExchangeRate("CNY", "RUB"),
    enabled: exchangeRateConfig?.configured === true,
    refetchInterval: 60000,
  });

  // 获取汇率历史
  const { data: history, isLoading: historyLoading } = useQuery({
    queryKey: ["exchange-rate", "history", timeRange],
    queryFn: () =>
      exchangeRateApi.getExchangeRateHistory("CNY", "RUB", timeRange),
    enabled: exchangeRateConfig?.configured === true,
  });

  // X轴格式化函数
  const formatXAxis = (text: string) => {
    const date = new Date(text);
    if (timeRange === "today") {
      return date.toLocaleTimeString("zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
      });
    } else {
      return date.toLocaleDateString("zh-CN", {
        month: "2-digit",
        day: "2-digit",
      });
    }
  };

  const configExchangeRateMutation = useMutation({
    mutationFn: exchangeRateApi.configureExchangeRateApi,
    onSuccess: () => {
      notifySuccess("配置成功", "汇率API配置成功");
      queryClient.invalidateQueries({ queryKey: ["exchange-rate"] });
      exchangeRateForm.resetFields();
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { error?: { detail?: string } } }; message?: string };
      notifyError(
        "配置失败",
        `配置失败: ${err.response?.data?.error?.detail || err.message}`,
      );
    },
  });

  const refreshRateMutation = useMutation({
    mutationFn: exchangeRateApi.refreshExchangeRate,
    onSuccess: (data) => {
      if (data.status === "success") {
        notifySuccess("刷新成功", data.message);
        queryClient.invalidateQueries({ queryKey: ["exchange-rate"] });
      } else {
        notifyInfo("刷新提示", data.message);
      }
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { error?: { detail?: string } } }; message?: string };
      notifyError(
        "刷新失败",
        `刷新失败: ${err.response?.data?.error?.detail || err.message}`,
      );
    },
  });


  // ========== 象寄图片配置 ==========
  const { data: xiangjifanyiConfig } = useQuery({
    queryKey: ["xiangjifanyi", "config"],
    queryFn: xiangjifanyiApi.getXiangjifanyiConfig,
  });

  const saveXiangjifanyiMutation = useMutation({
    mutationFn: (values: FormValues) =>
      xiangjifanyiApi.saveXiangjifanyiConfig(
        values as unknown as xiangjifanyiApi.XiangjifanyiConfigRequest
      ),
    onSuccess: () => {
      notifySuccess("保存成功", "象寄图片配置已保存");
      queryClient.invalidateQueries({ queryKey: ["xiangjifanyi"] });
      xiangjifanyiForm.setFieldsValue({
        password: "",
        user_key: "",
        video_trans_key: "",
        fetch_key: "",
        img_trans_key_ali: "",
        img_trans_key_google: "",
        img_trans_key_papago: "",
        img_trans_key_deepl: "",
        img_trans_key_chatgpt: "",
        img_trans_key_baidu: "",
        img_matting_key: "",
        text_trans_key: "",
        aigc_key: "",
      });
    },
    onError: (error: Error) => {
      notifyError("保存失败", `保存失败: ${error.message}`);
    },
  });

  const testXiangjifanyiMutation = useMutation({
    mutationFn: () => xiangjifanyiApi.testXiangjifanyiConnection(),
    onSuccess: () => {
      notifySuccess("测试成功", "象寄图片连接测试成功");
    },
    onError: (error: Error) => {
      notifyError("测试失败", `测试失败: ${error.message}`);
    },
  });

  useEffect(() => {
    if (xiangjifanyiConfig) {
      xiangjifanyiForm.setFieldsValue({
        phone: xiangjifanyiConfig.phone || "",
        api_url: xiangjifanyiConfig.api_url || "",
        enabled: xiangjifanyiConfig.enabled || false,
      });
    }
  }, [xiangjifanyiConfig, xiangjifanyiForm]);

  return (
    <div className={styles.container}>
      <Tabs
        defaultActiveKey="image-storage"
        destroyInactiveTabPane
        items={[
          {
            key: "image-storage",
            label: (
              <>
                <PictureOutlined /> 图床配置
              </>
            ),
            children: (
              <Card className={styles.card}>
                <ImageStorageConfigTab />
              </Card>
            ),
          },
          {
            key: "exchange-rate",
            label: (
              <>
                <DollarOutlined /> 汇率API
              </>
            ),
            children: (
              <Card className={styles.card}>
                <Alert
                  message="汇率API用于实时获取人民币→卢布汇率"
                  description="免费账户每月1500次请求，系统每小时自动刷新一次"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {exchangeRateConfig?.configured && (
                  <Alert
                    message={`API已配置 | 服务商: ${exchangeRateConfig.api_provider} | 状态: ${exchangeRateConfig.is_enabled ? "启用" : "禁用"}`}
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Form
                  form={exchangeRateForm}
                  layout="vertical"
                  onFinish={(values) => {
                    configExchangeRateMutation.mutate({
                      api_key: values.api_key,
                      api_provider: "exchangerate-api",
                      base_currency: "CNY",
                      is_enabled: true,
                    });
                  }}
                >
                  <Form.Item
                    name="api_key"
                    label="API Key"
                    rules={[{ required: true, message: "请输入API Key" }]}
                  >
                    <Input.Password id="exchange_rate_api_key" placeholder="请输入exchangerate-api.com的API Key" style={{ width: 200 }} />
                  </Form.Item>

                  {canOperate && (
                    <Form.Item>
                      <Space>
                        <Button
                          type="primary"
                          htmlType="submit"
                          loading={configExchangeRateMutation.isPending}
                        >
                          保存配置
                        </Button>
                        <Button
                          onClick={() => refreshRateMutation.mutate()}
                          loading={refreshRateMutation.isPending}
                          disabled={!exchangeRateConfig?.configured}
                          icon={<ReloadOutlined />}
                        >
                          手动刷新汇率
                        </Button>
                      </Space>
                    </Form.Item>
                  )}
                </Form>

                {exchangeRateConfig?.configured && (
                  <>
                    <Row gutter={16} style={{ marginTop: 24 }}>
                      <Col span={12}>
                        {rateLoading ? (
                          <Spin />
                        ) : currentRate ? (
                          <Statistic
                            title="当前汇率：人民币 (CNY) → 卢布 (RUB)"
                            value={parseFloat(currentRate.rate)}
                            precision={6}
                            valueStyle={{ color: "#3f8600" }}
                            suffix={
                              <span style={{ fontSize: 14 }}>
                                {currentRate.cached && "(缓存)"}
                              </span>
                            }
                          />
                        ) : (
                          <Alert message="无法获取汇率数据" type="warning" showIcon />
                        )}
                      </Col>
                    </Row>

                    {/* 汇率趋势图 */}
                    <div style={{ marginTop: 24 }}>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 16,
                        }}
                      >
                        <Space>
                          <LineChartOutlined />
                          <span style={{ fontWeight: 500 }}>汇率趋势</span>
                        </Space>
                        <Segmented
                          options={[
                            { label: "今日", value: "today" },
                            { label: "本周", value: "week" },
                            { label: "本月", value: "month" },
                          ]}
                          value={timeRange}
                          onChange={(value) =>
                            setTimeRange(value as "today" | "week" | "month")
                          }
                        />
                      </div>

                      {historyLoading ? (
                        <div style={{ textAlign: "center", padding: "40px 0" }}>
                          <Spin />
                        </div>
                      ) : history?.data && history.data.length > 0 ? (
                        <RateChart data={history.data} formatXAxis={formatXAxis} />
                      ) : (
                        <Alert
                          message="暂无历史数据"
                          description="系统会在后台自动获取汇率数据，请稍后查看"
                          type="info"
                          showIcon
                        />
                      )}
                    </div>
                  </>
                )}

                <Alert
                  message="提示"
                  description={
                    <div>
                      <p>
                        1. 前往{" "}
                        <a
                          href="https://www.exchangerate-api.com"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          exchangerate-api.com
                        </a>{" "}
                        注册获取免费API Key
                      </p>
                      <p>2. 配置后系统会自动同步汇率数据</p>
                    </div>
                  }
                  type="info"
                  style={{ marginTop: 16 }}
                />
              </Card>
            ),
          },
          {
            key: "translation",
            label: (
              <>
                <TranslationOutlined /> 翻译配置
              </>
            ),
            children: <TranslationConfigTab />,
          },
          {
            key: "xiangjifanyi",
            label: (
              <>
                <PictureOutlined /> 象寄图片
              </>
            ),
            children: (
              <Card className={styles.card}>
                <Alert
                  message="象寄图片用于商品图片处理和翻译"
                  description="提供图片翻译、智能抠图、视频翻译、商品解析等功能"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {xiangjifanyiConfig && (
                  <Alert
                    message={`服务${xiangjifanyiConfig.enabled ? "已启用" : "已禁用"}`}
                    type={xiangjifanyiConfig.enabled ? "success" : "warning"}
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Form
                  form={xiangjifanyiForm}
                  layout="vertical"
                  onFinish={(values) => saveXiangjifanyiMutation.mutate(values)}
                >
                  <Form.Item
                    name="enabled"
                    label="启用服务"
                    valuePropName="checked"
                  >
                    <Switch checkedChildren="启用" unCheckedChildren="禁用" />
                  </Form.Item>

                  <Form.Item
                    name="phone"
                    label="手机号"
                    rules={[{ required: true, message: "请输入手机号" }]}
                  >
                    <Input placeholder="请输入手机号" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[{ required: !xiangjifanyiConfig, message: "请输入密码" }]}
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="api_url"
                    label="API地址"
                  >
                    <Input placeholder="https://www.xiangjifanyi.com" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="user_key"
                    label="私人密钥 (UserKey)"
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="video_trans_key"
                    label="视频翻译 (VideoTransKey)"
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="fetch_key"
                    label="商品解析 (FetchKey)"
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item label="图片翻译 (ImgTransKey)" style={{ marginBottom: 8 }}>
                    <div style={{ paddingLeft: 16, borderLeft: '2px solid #e8e8e8' }}>
                      <Form.Item
                        name="img_trans_key_ali"
                        label="阿里标识码"
                        style={{ marginBottom: 8 }}
                      >
                        <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        name="img_trans_key_google"
                        label="谷歌标识码"
                        style={{ marginBottom: 8 }}
                      >
                        <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        name="img_trans_key_papago"
                        label="Papago标识码"
                        style={{ marginBottom: 8 }}
                      >
                        <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        name="img_trans_key_deepl"
                        label="DeepL标识码"
                        style={{ marginBottom: 8 }}
                      >
                        <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        name="img_trans_key_chatgpt"
                        label="ChatGPT标识码"
                        style={{ marginBottom: 8 }}
                      >
                        <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                      </Form.Item>

                      <Form.Item
                        name="img_trans_key_baidu"
                        label="百度标识码"
                        style={{ marginBottom: 0 }}
                      >
                        <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                      </Form.Item>
                    </div>
                  </Form.Item>

                  <Form.Item
                    name="img_matting_key"
                    label="智能抠图 (ImgMattingKey)"
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="text_trans_key"
                    label="文本翻译 (TextTransKey)"
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  <Form.Item
                    name="aigc_key"
                    label="智能生成 (AigcKey)"
                  >
                    <Input.Password placeholder="保存后不显示" style={{ width: 300 }} />
                  </Form.Item>

                  {canOperate && (
                    <Form.Item>
                      <Space>
                        <Button
                          type="primary"
                          htmlType="submit"
                          loading={saveXiangjifanyiMutation.isPending}
                        >
                          保存配置
                        </Button>
                        <Button
                          onClick={() => testXiangjifanyiMutation.mutate()}
                          loading={testXiangjifanyiMutation.isPending}
                        >
                          测试连接
                        </Button>
                      </Space>
                    </Form.Item>
                  )}
                </Form>

                <Alert
                  message="提示"
                  description={
                    <div>
                      <p>
                        1. 前往{" "}
                        <a
                          href="https://www.xiangjifanyi.com"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          象寄图片官网
                        </a>{" "}
                        获取API密钥
                      </p>
                      <p>2. 配置后可在商品管理中使用图片处理功能</p>
                    </div>
                  }
                  type="info"
                  style={{ marginTop: 16 }}
                />
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default ThirdPartyServicesTab;
