/**
 * 增强的Cron表达式编辑器
 * 支持预设选项和自定义输入两种模式
 */
import { Radio, Input, Space, Typography } from 'antd';
import { useState } from 'react';
import { Cron } from 'react-js-cron';
import 'react-js-cron/dist/styles.css';

const { Text } = Typography;

interface CronEditorProps {
  value?: string;
  onChange?: (_value: string) => void;
}

// 预设的Cron表达式选项
const PRESET_OPTIONS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每30分钟', value: '*/30 * * * *' },
  { label: '每6小时', value: '0 */6 * * *' },
  { label: '每天00:00', value: '0 0 * * *' },
  { label: '每天01:00', value: '0 1 * * *' },
  { label: '每天06:00', value: '0 6 * * *' },
  { label: '每天13:00', value: '0 13 * * *' },
  { label: '每天01:00和13:00', value: '0 1,13 * * *' },
  { label: '自定义', value: '__custom__' },
];

export default function CronEditor({ value, onChange }: CronEditorProps) {
  // 判断当前值是否在预设列表中
  const isPreset = PRESET_OPTIONS.some((opt) => opt.value === value);
  const [mode, setMode] = useState<string>(isPreset ? value! : '__custom__');
  const [customValue, setCustomValue] = useState<string>(
    isPreset ? '0 * * * *' : value || '0 * * * *'
  );

  const handleModeChange = (newMode: string) => {
    setMode(newMode);

    if (newMode !== '__custom__') {
      // 选择了预设选项
      onChange?.(newMode);
    } else {
      // 切换到自定义模式，使用当前自定义值
      onChange?.(customValue);
    }
  };

  const handleCustomChange = (newValue: string) => {
    setCustomValue(newValue);
    if (mode === '__custom__') {
      onChange?.(newValue);
    }
  };

  return (
    <Space direction="vertical" style={{ width: '100%' }}>
      {/* 预设选项 */}
      <Radio.Group
        value={mode}
        onChange={(e) => handleModeChange(e.target.value)}
        optionType="button"
        buttonStyle="solid"
      >
        {PRESET_OPTIONS.map((opt) => (
          <Radio.Button key={opt.value} value={opt.value}>
            {opt.label}
          </Radio.Button>
        ))}
      </Radio.Group>

      {/* 自定义输入区域 */}
      {mode === '__custom__' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text type="secondary">可视化编辑器：</Text>
          <Cron value={customValue} setValue={handleCustomChange} clearButton={false} />
          <Text type="secondary">或直接输入：</Text>
          <Input
            value={customValue}
            onChange={(e) => handleCustomChange(e.target.value)}
            placeholder="例如: 0 17,5 * * * (UTC 17:00和05:00)"
          />
          <Text type="secondary" style={{ fontSize: '12px' }}>
            提示：格式为 "分 时 日 月 周"，北京时间需减8小时转为UTC时间
          </Text>
        </Space>
      )}

      {/* 显示当前选择的值 */}
      <Text type="secondary" style={{ fontSize: '12px' }}>
        当前表达式: <Text code>{mode === '__custom__' ? customValue : mode}</Text>
      </Text>
    </Space>
  );
}
