import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// https://vitejs.dev/config/
export default defineConfig({
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
        // 手动分割代码块，优化加载性能
        manualChunks(id) {
          // 将node_modules中的代码单独打包
          if (id.includes('node_modules')) {
            // React相关库
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router')) {
              return 'react-vendor';
            }
            // Ant Design相关
            if (id.includes('antd') || id.includes('@ant-design')) {
              return 'antd-vendor';
            }
            // 图表库
            if (id.includes('recharts') || id.includes('d3')) {
              return 'charts-vendor';
            }
            // 其他第三方库
            return 'vendor';
          }
        },
        // 使用contenthash确保文件内容变化才更新文件名
        // 这样可以最大化利用浏览器缓存
        chunkFileNames: (chunkInfo) => {
          // 对于vendor chunks，使用更稳定的命名
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split('/').pop() : 'chunk';
          return `assets/js/${chunkInfo.name || facadeModuleId}-[hash].js`;
        },
        // 入口文件命名
        entryFileNames: 'assets/js/[name]-[hash].js',
        // 静态资源命名
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const extType = info[info.length - 1];
          // CSS文件使用contenthash
          if (/css/.test(extType)) {
            return `assets/css/[name]-[hash].css`;
          }
          // 其他资源
          return `assets/[ext]/[name]-[hash].[ext]`;
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