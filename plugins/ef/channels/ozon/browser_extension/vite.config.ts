import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifestBase from './manifest.json';
import path from 'path';

// BUILD_MODE:
// - 'production': 正式版（无调试日志，压缩代码）
// - 'debug': 调试版（保留调试日志，压缩代码）
// - 其他/未设置: 开发模式（保留调试日志，不压缩）
const buildMode = process.env.BUILD_MODE;
const isProduction = buildMode === 'production';
const isDebug = buildMode === 'debug';
const isDev = !isProduction && !isDebug;

// 调试版添加 [调试版] 后缀，方便区分
const manifest = isDebug
  ? { ...manifestBase, name: `${manifestBase.name}[调试版]` }
  : manifestBase;

export default defineConfig({
  plugins: [
    react(),
    crx({ manifest })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  // 定义编译时常量，用于控制调试日志
  define: {
    // 调试模式：debug 版和开发模式启用，production 版禁用
    __DEBUG__: JSON.stringify(isDebug || isDev),
  },
  build: {
    outDir: 'dist',
    minify: isDev ? false : 'esbuild',  // 开发模式不压缩，生产/调试版压缩
    sourcemap: isDev,  // 仅开发模式生成 sourcemap
    // production 版移除 console.log，保留 console.error/warn
    // debug 版和开发模式保留所有 console
    ...(isProduction && {
      esbuild: {
        drop: ['console'],  // 移除所有 console.*
      }
    }),
    rollupOptions: {
      input: {
        popup: 'src/popup/popup.html'
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name].[ext]'
      }
    }
  }
});
