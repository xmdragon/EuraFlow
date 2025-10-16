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
    // 设置chunk大小警告限制（优化后每个chunk应≤600KB）
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        // 按依赖类型智能分割，优化缓存和并行加载
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Ant Design 生态 (~600KB)
            if (id.includes('antd') || id.includes('@ant-design/icons')) {
              return 'antd';
            }
            // 图表库 (~400KB) - 仅在特定页面使用
            if (id.includes('recharts') || id.includes('@ant-design/plots')) {
              return 'charts';
            }
            // React 核心 (~180KB) - 最稳定，缓存命中率高
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react';
            }
            // TanStack Query (~80KB)
            if (id.includes('@tanstack/react-query')) {
              return 'query';
            }
            // 其他工具库 (~240KB)
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