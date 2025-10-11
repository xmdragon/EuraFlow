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
  build: {
    // 设置chunk大小警告限制
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 优化代码分割策略：将大的vendor拆分为多个小chunk
        manualChunks(id) {
          // 1. React 核心库（react + react-dom + scheduler 必须在一起，避免多实例问题）
          if (id.includes('node_modules/react') ||
              id.includes('node_modules/react-dom') ||
              id.includes('node_modules/scheduler')) {
            return 'vendor-react';
          }

          // 2. Ant Design 生态（最大的库，包含所有 rc-* 组件）
          if (id.includes('node_modules/antd') ||
              id.includes('node_modules/@ant-design') ||
              id.includes('node_modules/rc-')) {
            return 'vendor-antd';
          }

          // 3. React Router
          if (id.includes('node_modules/react-router')) {
            return 'vendor-router';
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