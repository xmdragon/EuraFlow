/**
 * Type declarations for Recharts to fix React 18 compatibility issues
 * These declarations extend Recharts component types to work with React 18's stricter JSX typing
 */

declare module 'recharts' {
  import { ComponentType } from 'react';

  // Re-export all types from recharts but with React 18 compatible JSX types
  export * from 'recharts';

  // Fix JSX component type compatibility for all Recharts components
  export const ResponsiveContainer: ComponentType<unknown>;
  export const PieChart: ComponentType<unknown>;
  export const Pie: ComponentType<unknown>;
  export const Cell: ComponentType<unknown>;
  export const Legend: ComponentType<unknown>;
  export const Tooltip: ComponentType<unknown>;
  export const BarChart: ComponentType<unknown>;
  export const Bar: ComponentType<unknown>;
  export const XAxis: ComponentType<unknown>;
  export const YAxis: ComponentType<unknown>;
  export const CartesianGrid: ComponentType<unknown>;
  export const Line: ComponentType<unknown>;
  export const LineChart: ComponentType<unknown>;
  export const Area: ComponentType<unknown>;
  export const AreaChart: ComponentType<unknown>;
  export const ComposedChart: ComponentType<unknown>;
  export const Scatter: ComponentType<unknown>;
  export const ScatterChart: ComponentType<unknown>;
  export const Radar: ComponentType<unknown>;
  export const RadarChart: ComponentType<unknown>;
  export const PolarGrid: ComponentType<unknown>;
  export const PolarAngleAxis: ComponentType<unknown>;
  export const PolarRadiusAxis: ComponentType<unknown>;
  export const Treemap: ComponentType<unknown>;
  export const Sankey: ComponentType<unknown>;
  export const ReferenceLine: ComponentType<unknown>;
  export const ReferenceDot: ComponentType<unknown>;
  export const ReferenceArea: ComponentType<unknown>;
  export const Brush: ComponentType<unknown>;
  export const ErrorBar: ComponentType<unknown>;
  export const Funnel: ComponentType<unknown>;
  export const FunnelChart: ComponentType<unknown>;
  export const LabelList: ComponentType<unknown>;
}
