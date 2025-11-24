/**
 * Type declarations for @ant-design/plots to fix React 18 compatibility issues
 * These declarations extend Ant Design Plots component types to work with React 18's stricter JSX typing
 */

declare module '@ant-design/plots' {
  import { ComponentType } from 'react';

  // Re-export all types from @ant-design/plots but with React 18 compatible JSX types
  export * from '@ant-design/plots';

  // Fix JSX component type compatibility for all @ant-design/plots components
  export const Line: ComponentType<unknown>;
  export const Area: ComponentType<unknown>;
  export const Column: ComponentType<unknown>;
  export const Bar: ComponentType<unknown>;
  export const Pie: ComponentType<unknown>;
  export const Rose: ComponentType<unknown>;
  export const Scatter: ComponentType<unknown>;
  export const Histogram: ComponentType<unknown>;
  export const Heatmap: ComponentType<unknown>;
  export const Box: ComponentType<unknown>;
  export const Violin: ComponentType<unknown>;
  export const Radar: ComponentType<unknown>;
  export const Funnel: ComponentType<unknown>;
  export const Waterfall: ComponentType<unknown>;
  export const WordCloud: ComponentType<unknown>;
  export const Sunburst: ComponentType<unknown>;
  export const DualAxes: ComponentType<unknown>;
  export const Stock: ComponentType<unknown>;
  export const RadialBar: ComponentType<unknown>;
  export const Gauge: ComponentType<unknown>;
  export const Liquid: ComponentType<unknown>;
  export const Bullet: ComponentType<unknown>;
  export const TinyLine: ComponentType<unknown>;
  export const TinyArea: ComponentType<unknown>;
  export const TinyColumn: ComponentType<unknown>;
  export const Progress: ComponentType<unknown>;
  export const RingProgress: ComponentType<unknown>;
}
