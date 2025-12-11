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
    // 生成版本文件，用于检测更新
    {
      name: 'generate-version',
      closeBundle() {
        const distPath = path.resolve(__dirname, 'dist')
        const versionFile = path.join(distPath, 'version.json')
        const version = {
          version: Date.now().toString(), // 使用时间戳作为版本号
          buildTime: new Date().toISOString(),
        }
        // 确保 dist 目录存在
        if (!fs.existsSync(distPath)) {
          fs.mkdirSync(distPath, { recursive: true })
        }
        fs.writeFileSync(versionFile, JSON.stringify(version, null, 2))
        console.log('✓ Generated version.json:', version)
      }
    }
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
    include: [
      'react', 'react-dom', 'react-router-dom',
      'antd', '@ant-design/icons',
      '@tanstack/react-query',
      'recharts',
      'dayjs',
      'axios',
    ],
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
        // 手动代码分割
        // 注意：所有依赖 React 的库必须在 vendor-ui 之后加载
        // 使用函数形式无法保证加载顺序，改用对象形式
        manualChunks: {
          // 纯工具库（无 React 依赖，可以独立）
          'vendor-utils': ['dayjs', 'axios', 'loglevel', 'md5'],
          // d3 图表底层库（无 React 依赖）
          'vendor-d3': ['d3-shape', 'd3-scale', 'd3-interpolate', 'd3-color', 'd3-path', 'd3-time', 'd3-time-format', 'd3-format', 'd3-array'],
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