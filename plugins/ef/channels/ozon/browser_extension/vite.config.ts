import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.json';
import path from 'path';

// 开发模式：保留 console 输出便于调试
// 生产模式：可以通过 BUILD_MODE=production 启用 minify
const isDev = process.env.BUILD_MODE !== 'production';

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
  build: {
    outDir: 'dist',
    minify: isDev ? false : 'esbuild',  // 开发模式不压缩，保留可读性
    sourcemap: isDev,  // 开发模式生成 sourcemap
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
