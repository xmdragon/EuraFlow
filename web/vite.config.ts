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
  },
  build: {
    // 设置chunk大小警告限制
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 手动分割代码块
        manualChunks(id) {
          // node_modules 中的包
          if (id.includes('node_modules')) {
            // React 核心库 - 合并到一个chunk中避免导入问题
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-vendor';
            }
            // Ant Design
            if (id.includes('@ant-design/icons')) {
              return 'antd-icons';
            }
            if (id.includes('antd')) {
              return 'antd';
            }
            // 路由
            if (id.includes('react-router')) {
              return 'react-router';
            }
            // 工具库
            if (id.includes('axios')) {
              return 'axios';
            }
            if (id.includes('@tanstack/react-query')) {
              return 'react-query';
            }
            if (id.includes('dayjs')) {
              return 'dayjs';
            }
            // 其他第三方库
            return 'vendor';
          }
        },
        // 用于从入口点创建单独的块
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : 'chunk';
          return `assets/js/${facadeModuleId}-[hash].js`;
        },
        // 用于命名代码拆分的块
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