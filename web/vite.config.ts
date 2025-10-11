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
        // 简化分包策略：只分两个 vendor chunk，确保依赖关系正确
        manualChunks(id) {
          // 1. Ant Design 相关（最大的依赖，单独打包）
          if (id.includes('node_modules/antd') ||
              id.includes('node_modules/@ant-design') ||
              id.includes('node_modules/rc-')) {
            return 'vendor-antd';
          }

          // 2. 所有其他第三方库（React、Router、TanStack Query、dayjs、axios 等）
          // 放在一起确保依赖关系正确
          if (id.includes('node_modules')) {
            return 'vendor';
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