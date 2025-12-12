import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// 静态资源 CDN 域名（生产环境）
const STATIC_CDN = process.env.STATIC_CDN || ''

// https://vitejs.dev/config/
export default defineConfig({
  // 生产环境使用 CDN 域名加载静态资源
  base: STATIC_CDN ? `${STATIC_CDN}/` : '/',
  plugins: [
    react(),
    // 构建完成后删除 dist/downloads 目录（nginx 直接提供 public/downloads）
    {
      name: 'remove-downloads',
      closeBundle() {
        const downloadsPath = path.resolve(__dirname, 'dist/downloads')
        if (fs.existsSync(downloadsPath)) {
          fs.rmSync(downloadsPath, { recursive: true, force: true })
        }
      }
    },
  ],
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
    chunkSizeWarningLimit: 1500,
    // 禁用 modulePreload，避免首屏加载不必要的大型库
    // 懒加载的模块会在真正需要时才加载
    modulePreload: false,
    rollupOptions: {
      // 开发专用依赖不打包到生产构建
      external: ['react-scan', 'stats.js'],
      output: {
        // 用于命名代码拆分的块
        chunkFileNames: 'assets/js/[name]-[hash].js',
        // 用于命名入口文件
        entryFileNames: 'assets/js/[name]-[hash].js',
        // 用于命名静态资源
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]',
        // 手动分割策略：最小化干预，只拆分确定无依赖问题的大型库
        // 注意：不合并业务代码（hooks/services），因为它们可能导入 antd
        manualChunks: (id: string) => {
          // 1. 图表库（~385KB）- 仅报表页使用，完全独立
          if (id.includes('node_modules/recharts/') ||
              id.includes('node_modules/d3-') ||
              id.includes('node_modules/victory-vendor/')) {
            return 'vendor-charts'
          }

          // 2. 拖拽库（~50KB）- 仅商品创建使用，完全独立
          if (id.includes('node_modules/@dnd-kit/')) {
            return 'vendor-dnd'
          }

          // 3. Markdown（~100KB）- 仅聊天页使用，完全独立
          if (id.includes('node_modules/react-markdown/') ||
              id.includes('node_modules/remark-') ||
              id.includes('node_modules/rehype-') ||
              id.includes('node_modules/unified/') ||
              id.includes('node_modules/micromark/') ||
              id.includes('node_modules/mdast-') ||
              id.includes('node_modules/hast-')) {
            return 'vendor-markdown'
          }
        },
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