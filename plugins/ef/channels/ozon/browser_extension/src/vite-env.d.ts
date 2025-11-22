/// <reference types="vite/client" />

/**
 * Vite CSS 模块类型声明
 */

// 支持 ?inline CSS 导入
declare module '*.css?inline' {
  const content: string;
  export default content;
}

// 支持普通 CSS 模块导入
declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
