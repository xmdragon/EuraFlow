// @ts-nocheck
// 独立的汇率图表组件，使用 @ts-nocheck 避免 recharts 与 React 19 类型冲突
import React from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface RateHistoryPoint {
  time: string;
  rate: number;
}

interface RateChartProps {
  data: RateHistoryPoint[];
  formatXAxis: (text: string) => string;
}

const RateChart: React.FC<RateChartProps> = ({ data, formatXAxis }) => (
  <ResponsiveContainer width="100%" height={300}>
    <LineChart data={data}>
      <CartesianGrid strokeDasharray="3 3" />
      <XAxis dataKey="time" tickFormatter={formatXAxis} />
      <YAxis tickFormatter={(value) => value.toFixed(4)} />
      <Tooltip formatter={(value) => [`${value.toFixed(6)}`, "汇率"]} />
      <Line type="monotone" dataKey="rate" stroke="#1890ff" strokeWidth={2} dot={false} />
    </LineChart>
  </ResponsiveContainer>
);

export default RateChart;
