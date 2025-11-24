/**
 * 翻译配置 Tab - 阿里云翻译和 ChatGPT 翻译
 */
import { TranslationOutlined, RobotOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  Form,
  Input,
  Button,
  Space,
  Alert,
  Tabs,
  Spin,
  Tag,
  Switch,
  Select,
} from 'antd';
import React, { useEffect } from 'react';

import { usePermission } from '@/hooks/usePermission';
import * as translationApi from '@/services/translationApi';
import { notifySuccess, notifyError } from '@/utils/notification';

const { TextArea } = Input;

const TranslationConfigTab: React.FC = () => {
  const queryClient = useQueryClient();
  const { canOperate } = usePermission();
  const [aliyunForm] = Form.useForm();
  const [chatgptForm] = Form.useForm();

  // ============ 阿里云翻译配置查询 ============
  const {
    data: aliyunConfig,
    isLoading: aliyunLoading,
  } = useQuery({
    queryKey: ['aliyunTranslationConfig'],
    queryFn: async () => {
      try {
        return await translationApi.getAliyunTranslationConfig();
      } catch (error: unknown) {
        console.error('Failed to load Aliyun Translation config:', error);
        return null;
      }
    },
    retry: false,
  });

  // ============ ChatGPT 翻译配置查询 ============
  const {
    data: chatgptConfig,
    isLoading: chatgptLoading,
  } = useQuery({
    queryKey: ['chatgptTranslationConfig'],
    queryFn: async () => {
      try {
        return await translationApi.getChatGPTTranslationConfig();
      } catch (error: unknown) {
        console.error('Failed to load ChatGPT Translation config:', error);
        return null;
      }
    },
    retry: false,
  });

  // ============ 查询当前激活的翻译引擎 ============
  const { data: activeProvider } = useQuery({
    queryKey: ['activeTranslationProvider'],
    queryFn: () => translationApi.getActiveProvider(),
    retry: false,
  });

  // ============ 保存阿里云翻译配置 ============
  const saveAliyunMutation = useMutation({
    mutationFn: (values: translationApi.AliyunTranslationConfigRequest) =>
      translationApi.saveAliyunTranslationConfig(values),
    onSuccess: () => {
      notifySuccess('阿里云翻译配置保存成功');
      queryClient.invalidateQueries({ queryKey: ['aliyunTranslationConfig'] });
      queryClient.invalidateQueries({ queryKey: ['activeTranslationProvider'] });
    },
    onError: (error: Error) => {
      notifyError(`保存失败: ${error.message}`);
    },
  });

  // ============ 测试阿里云翻译连接 ============
  const testAliyunMutation = useMutation({
    mutationFn: () => translationApi.testAliyunTranslationConnection(),
    onSuccess: () => {
      notifySuccess('阿里云翻译连接测试成功');
      queryClient.invalidateQueries({ queryKey: ['aliyunTranslationConfig'] });
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      notifyError(`测试失败: ${err.response?.data?.detail || err.message}`);
    },
  });

  // ============ 设置阿里云翻译为默认 ============
  const setAliyunDefaultMutation = useMutation({
    mutationFn: () => translationApi.setAliyunTranslationAsDefault(),
    onSuccess: () => {
      notifySuccess('已切换到阿里云翻译');
      queryClient.invalidateQueries({ queryKey: ['aliyunTranslationConfig'] });
      queryClient.invalidateQueries({ queryKey: ['chatgptTranslationConfig'] });
      queryClient.invalidateQueries({ queryKey: ['activeTranslationProvider'] });
    },
    onError: (error: Error) => {
      notifyError(`切换失败: ${error.message}`);
    },
  });

  // ============ 保存 ChatGPT 翻译配置 ============
  const saveChatGPTMutation = useMutation({
    mutationFn: (values: translationApi.ChatGPTTranslationConfigRequest) =>
      translationApi.saveChatGPTTranslationConfig(values),
    onSuccess: () => {
      notifySuccess('ChatGPT 翻译配置保存成功');
      queryClient.invalidateQueries({ queryKey: ['chatgptTranslationConfig'] });
      queryClient.invalidateQueries({ queryKey: ['activeTranslationProvider'] });
    },
    onError: (error: Error) => {
      notifyError(`保存失败: ${error.message}`);
    },
  });

  // ============ 测试 ChatGPT 翻译连接 ============
  const testChatGPTMutation = useMutation({
    mutationFn: () => translationApi.testChatGPTTranslationConnection(),
    onSuccess: () => {
      notifySuccess('ChatGPT 翻译连接测试成功');
      queryClient.invalidateQueries({ queryKey: ['chatgptTranslationConfig'] });
    },
    onError: (error: unknown) => {
      const err = error as { response?: { data?: { detail?: string } }; message?: string };
      notifyError(`测试失败: ${err.response?.data?.detail || err.message}`);
    },
  });

  // ============ 设置 ChatGPT 翻译为默认 ============
  const setChatGPTDefaultMutation = useMutation({
    mutationFn: () => translationApi.setChatGPTTranslationAsDefault(),
    onSuccess: () => {
      notifySuccess('已切换到 ChatGPT 翻译');
      queryClient.invalidateQueries({ queryKey: ['aliyunTranslationConfig'] });
      queryClient.invalidateQueries({ queryKey: ['chatgptTranslationConfig'] });
      queryClient.invalidateQueries({ queryKey: ['activeTranslationProvider'] });
    },
    onError: (error: Error) => {
      notifyError(`切换失败: ${error.message}`);
    },
  });

  // 自动填充阿里云翻译表单
  useEffect(() => {
    if (aliyunConfig) {
      aliyunForm.setFieldsValue({
        access_key_id: aliyunConfig.access_key_id || '',
        region_id: aliyunConfig.region_id || 'cn-hangzhou',
        enabled: aliyunConfig.enabled ?? true,
      });
    }
  }, [aliyunConfig, aliyunForm]);

  // 自动填充 ChatGPT 翻译表单
  useEffect(() => {
    if (chatgptConfig) {
      chatgptForm.setFieldsValue({
        base_url: chatgptConfig.base_url || '',
        model_name: chatgptConfig.model_name || 'gpt-5-mini',
        // gpt-5-mini 不支持自定义 temperature，不填充此字段
        system_prompt: chatgptConfig.system_prompt || '',
        enabled: chatgptConfig.enabled ?? true,
      });
    }
  }, [chatgptConfig, chatgptForm]);

  return (
    <div>
      {/* 翻译引擎状态概览 */}
      <Alert
        message={
          <Space>
            <span>当前激活的翻译引擎:</span>
            {activeProvider === 'aliyun' && (
              <Tag color="blue" icon={<TranslationOutlined />}>
                阿里云翻译
              </Tag>
            )}
            {activeProvider === 'chatgpt' && (
              <Tag color="green" icon={<RobotOutlined />}>
                ChatGPT 翻译
              </Tag>
            )}
            {activeProvider === 'none' && <Tag>未配置</Tag>}
          </Space>
        }
        type={activeProvider === 'none' ? 'warning' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Tabs
        defaultActiveKey="aliyun"
        items={[
          {
            key: 'aliyun',
            label: (
              <Space>
                <TranslationOutlined />
                阿里云翻译
                {aliyunConfig?.is_default && (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                )}
              </Space>
            ),
            children: (
              <Card>
                <Alert
                  message="阿里云机器翻译"
                  description="支持中俄互译，适用于电商、客服等场景"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {aliyunConfig?.is_default && (
                  <Alert
                    message="当前激活"
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Spin spinning={aliyunLoading}>
                  <Form
                    form={aliyunForm}
                    layout="vertical"
                    onFinish={(values) => saveAliyunMutation.mutate(values)}
                  >
                    <Form.Item
                      label="Access Key ID"
                      name="access_key_id"
                      rules={[{ required: true, message: '请输入 Access Key ID' }]}
                    >
                      <Input placeholder="请输入阿里云 Access Key ID" style={{ width: 500 }} />
                    </Form.Item>

                    <Form.Item
                      label="Access Key Secret"
                      name="access_key_secret"
                      extra="留空表示不修改现有密钥"
                    >
                      <Input.Password placeholder="请输入 Access Key Secret（留空不修改）" style={{ width: 500 }} />
                    </Form.Item>

                    <Form.Item
                      label="Region ID"
                      name="region_id"
                      rules={[{ required: true, message: '请选择区域' }]}
                    >
                      <Select style={{ width: 280 }}>
                        <Select.Option value="cn-hangzhou">华东1（杭州）</Select.Option>
                        <Select.Option value="cn-shanghai">华东2（上海）</Select.Option>
                        <Select.Option value="cn-beijing">华北2（北京）</Select.Option>
                        <Select.Option value="cn-shenzhen">华南1（深圳）</Select.Option>
                      </Select>
                    </Form.Item>

                    <Form.Item
                      label="是否启用"
                      name="enabled"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>

                    {aliyunConfig?.last_test_at && (
                      <Alert
                        message={
                          <Space>
                            <span>上次测试:</span>
                            <span>{new Date(aliyunConfig.last_test_at).toLocaleString()}</span>
                            {aliyunConfig.last_test_success ? (
                              <Tag color="success">成功</Tag>
                            ) : (
                              <Tag color="error">失败</Tag>
                            )}
                          </Space>
                        }
                        type={aliyunConfig.last_test_success ? 'success' : 'error'}
                        style={{ marginBottom: 16 }}
                      />
                    )}

                    <Space>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={saveAliyunMutation.isPending}
                        disabled={!canOperate}
                      >
                        保存配置
                      </Button>
                      <Button
                        onClick={() => testAliyunMutation.mutate()}
                        loading={testAliyunMutation.isPending}
                        disabled={!canOperate || !aliyunConfig}
                      >
                        测试连接
                      </Button>
                      {!aliyunConfig?.is_default && aliyunConfig && (
                        <Button
                          type="dashed"
                          onClick={() => setAliyunDefaultMutation.mutate()}
                          loading={setAliyunDefaultMutation.isPending}
                          disabled={!canOperate}
                        >
                          设为默认翻译引擎
                        </Button>
                      )}
                    </Space>
                  </Form>
                </Spin>
              </Card>
            ),
          },
          {
            key: 'chatgpt',
            label: (
              <Space>
                <RobotOutlined />
                ChatGPT 翻译
                {chatgptConfig?.is_default && (
                  <CheckCircleOutlined style={{ color: '#52c41a' }} />
                )}
              </Space>
            ),
            children: (
              <Card>
                <Alert
                  message="ChatGPT 机器翻译"
                  description="基于 OpenAI API，支持自定义 Prompt，翻译更自然地道"
                  type="info"
                  showIcon
                  style={{ marginBottom: 16 }}
                />

                {chatgptConfig?.is_default && (
                  <Alert
                    message="当前激活"
                    type="success"
                    showIcon
                    style={{ marginBottom: 16 }}
                  />
                )}

                <Spin spinning={chatgptLoading}>
                  <Form
                    form={chatgptForm}
                    layout="vertical"
                    onFinish={(values) => saveChatGPTMutation.mutate(values)}
                  >
                    <Form.Item
                      label="API Key"
                      name="api_key"
                      extra="留空表示不修改现有密钥"
                      rules={
                        chatgptConfig
                          ? []
                          : [{ required: true, message: '首次配置时必须提供 API Key' }]
                      }
                    >
                      <Input.Password placeholder="请输入 OpenAI API Key（留空不修改）" style={{ width: 500 }} />
                    </Form.Item>

                    <Form.Item
                      label="Base URL"
                      name="base_url"
                      extra="可选，默认使用官方地址（如使用中转服务可填写）"
                    >
                      <Input placeholder="https://api.openai.com/v1" style={{ width: 500 }} />
                    </Form.Item>

                    <Form.Item
                      label="模型名称"
                      name="model_name"
                      rules={[{ required: true, message: '请选择模型' }]}
                    >
                      <Select style={{ width: 200 }}>
                        <Select.Option value="gpt-5-mini">gpt-5-mini</Select.Option>
                      </Select>
                    </Form.Item>

                    {/* gpt-5-mini 不支持 temperature 参数，已移除此配置 */}

                    <Form.Item
                      label="System Prompt（翻译规则）"
                      name="system_prompt"
                      rules={[{ required: true, message: '请输入 System Prompt' }]}
                      extra="定义翻译风格和规则"
                    >
                      <TextArea
                        rows={6}
                        placeholder="你是一名专业的中俄互译翻译器..."
                      />
                    </Form.Item>

                    <Form.Item
                      label="是否启用"
                      name="enabled"
                      valuePropName="checked"
                    >
                      <Switch />
                    </Form.Item>

                    {chatgptConfig?.last_test_at && (
                      <Alert
                        message={
                          <Space>
                            <span>上次测试:</span>
                            <span>{new Date(chatgptConfig.last_test_at).toLocaleString()}</span>
                            {chatgptConfig.last_test_success ? (
                              <Tag color="success">成功</Tag>
                            ) : (
                              <Tag color="error">失败</Tag>
                            )}
                          </Space>
                        }
                        type={chatgptConfig.last_test_success ? 'success' : 'error'}
                        style={{ marginBottom: 16 }}
                      />
                    )}

                    <Space>
                      <Button
                        type="primary"
                        htmlType="submit"
                        loading={saveChatGPTMutation.isPending}
                        disabled={!canOperate}
                      >
                        保存配置
                      </Button>
                      <Button
                        onClick={() => testChatGPTMutation.mutate()}
                        loading={testChatGPTMutation.isPending}
                        disabled={!canOperate || !chatgptConfig}
                      >
                        测试连接
                      </Button>
                      {!chatgptConfig?.is_default && chatgptConfig && (
                        <Button
                          type="dashed"
                          onClick={() => setChatGPTDefaultMutation.mutate()}
                          loading={setChatGPTDefaultMutation.isPending}
                          disabled={!canOperate}
                        >
                          设为默认翻译引擎
                        </Button>
                      )}
                    </Space>
                  </Form>
                </Spin>
              </Card>
            ),
          },
        ]}
      />
    </div>
  );
};

export default TranslationConfigTab;
