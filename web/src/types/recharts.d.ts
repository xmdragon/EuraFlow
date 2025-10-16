/**
 * Type declarations for Recharts to fix React 18 compatibility issues
 * These declarations extend Recharts component types to work with React 18's stricter JSX typing
 */

declare module 'recharts' {
  import { ComponentType, ReactElement } from 'react';

  // Re-export all types from recharts but with React 18 compatible JSX types
  export * from 'recharts';

  // Fix JSX component type compatibility for all Recharts components
  export const ResponsiveContainer: ComponentType<any>;
  export const PieChart: ComponentType<any>;
  export const Pie: ComponentType<any>;
  export const Cell: ComponentType<any>;
  export const Legend: ComponentType<any>;
  export const Tooltip: ComponentType<any>;
  export const BarChart: ComponentType<any>;
  export const Bar: ComponentType<any>;
  export const XAxis: ComponentType<any>;
  export const YAxis: ComponentType<any>;
  export const CartesianGrid: ComponentType<any>;
  export const Line: ComponentType<any>;
  export const LineChart: ComponentType<any>;
  export const Area: ComponentType<any>;
  export const AreaChart: ComponentType<any>;
  export const ComposedChart: ComponentType<any>;
  export const Scatter: ComponentType<any>;
  export const ScatterChart: ComponentType<any>;
  export const Radar: ComponentType<any>;
  export const RadarChart: ComponentType<any>;
  export const PolarGrid: ComponentType<any>;
  export const PolarAngleAxis: ComponentType<any>;
  export const PolarRadiusAxis: ComponentType<any>;
  export const Treemap: ComponentType<any>;
  export const Sankey: ComponentType<any>;
  export const ReferenceLine: ComponentType<any>;
  export const ReferenceDot: ComponentType<any>;
  export const ReferenceArea: ComponentType<any>;
  export const Brush: ComponentType<any>;
  export const ErrorBar: ComponentType<any>;
  export const Funnel: ComponentType<any>;
  export const FunnelChart: ComponentType<any>;
  export const LabelList: ComponentType<any>;
}
