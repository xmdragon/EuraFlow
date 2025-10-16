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
    // 设置chunk大小警告限制
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        // 让 Vite 自动处理代码分割，确保依赖加载顺序正确
        // 注释掉自定义 manualChunks 以避免 React/Antd 加载顺序问题
        // manualChunks(id) {
        //   if (id.includes('node_modules')) {
        //     if (id.includes('antd') || id.includes('@ant-design/icons')) {
        //       return 'antd';
        //     }
        //     if (id.includes('recharts')) {
        //       return 'charts';
        //     }
        //     if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
        //       return 'react';
        //     }
        //     if (id.includes('@tanstack/react-query')) {
        //       return 'query';
        //     }
        //     return 'vendor';
        //   }
        // },
        // 用于命名代码拆分的块
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