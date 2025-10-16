/**
 * Type declarations for @ant-design/plots to fix React 18 compatibility issues
 * These declarations extend Ant Design Plots component types to work with React 18's stricter JSX typing
 */

declare module '@ant-design/plots' {
  import { ComponentType } from 'react';

  // Re-export all types from @ant-design/plots but with React 18 compatible JSX types
  export * from '@ant-design/plots';

  // Fix JSX component type compatibility for all @ant-design/plots components
  export const Line: ComponentType<any>;
  export const Area: ComponentType<any>;
  export const Column: ComponentType<any>;
  export const Bar: ComponentType<any>;
  export const Pie: ComponentType<any>;
  export const Rose: ComponentType<any>;
  export const Scatter: ComponentType<any>;
  export const Histogram: ComponentType<any>;
  export const Heatmap: ComponentType<any>;
  export const Box: ComponentType<any>;
  export const Violin: ComponentType<any>;
  export const Radar: ComponentType<any>;
  export const Funnel: ComponentType<any>;
  export const Waterfall: ComponentType<any>;
  export const WordCloud: ComponentType<any>;
  export const Sunburst: ComponentType<any>;
  export const DualAxes: ComponentType<any>;
  export const Stock: ComponentType<any>;
  export const RadialBar: ComponentType<any>;
  export const Gauge: ComponentType<any>;
  export const Liquid: ComponentType<any>;
  export const Bullet: ComponentType<any>;
  export const TinyLine: ComponentType<any>;
  export const TinyArea: ComponentType<any>;
  export const TinyColumn: ComponentType<any>;
  export const Progress: ComponentType<any>;
  export const RingProgress: ComponentType<any>;
}
