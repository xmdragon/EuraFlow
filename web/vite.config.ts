import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',  // 允许局域网访问
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // 确保 React 只有一个实例
    dedupe: ['react', 'react-dom'],
  },
  // 优化依赖预构建
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'antd'],
  },
  css: {
    preprocessorOptions: {
      scss: {
        // 明确使用 sass-embedded，避免 legacy-js-api 警告
        api: 'modern-compiler',
      },
    },
  },
  build: {
    // 设置chunk大小警告限制（Ant Design 单个 chunk 约 1.1 MB，gzip 后 348 KB）
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // 优化代码分割策略：将大的vendor拆分为多个小chunk
        manualChunks(id) {
          // 注意：匹配顺序很重要！先匹配更具体的路径，再匹配通用路径

          // 1. React Router（必须在 React 之前匹配，避免被 react 匹配）
          if (id.includes('node_modules/react-router')) {
            return 'vendor-router';
          }

          // 2. React 核心库和 React 生态库
          // 包含: react, react-dom, scheduler, @tanstack/react-query 等所有依赖 React 的库
          if (id.match(/node_modules\/(react|react-dom|scheduler)\//) ||
              id.match(/node_modules[\\/](react|react-dom|scheduler)[\\/]/) ||
              id.includes('node_modules/@tanstack/react-query')) {
            return 'vendor-react';
          }

          // 3. Ant Design 生态（最大的库，包含所有 rc-* 组件）
          if (id.includes('node_modules/antd') ||
              id.includes('node_modules/@ant-design') ||
              id.includes('node_modules/rc-')) {
            return 'vendor-antd';
          }

          // 4. 其他第三方库（TanStack Query、dayjs、axios 等）
          if (id.includes('node_modules')) {
            return 'vendor-misc';
          }
        },
        // 用于命名代码拆分的块（保留 manualChunks 的命名）
        chunkFileNames: 'assets/js/[name]-[hash].js',
        // 用于命名入口文件
        entryFileNames: 'assets/js/[name]-[hash].js',
        // 用于命名静态资源
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
      },
    },
    // 压缩配置
    terserOptions: {
      compress: {
        drop_console: true, // 生产环境移除console
        drop_debugger: true, // 移除debugger
      },
    },
    // 启用css代码分割
    cssCodeSplit: true,
    // 生成源映射文件用于调试
    sourcemap: false,
  },
})