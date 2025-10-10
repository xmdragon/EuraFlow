// vite.config.ts
import { defineConfig } from "file:///home/grom/EuraFlow/web/node_modules/vite/dist/node/index.js";
import react from "file:///home/grom/EuraFlow/web/node_modules/@vitejs/plugin-react/dist/index.js";
import path from "path";
var __vite_injected_original_dirname = "/home/grom/EuraFlow/web";
var vite_config_default = defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    // 允许局域网访问
    port: 3e3,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__vite_injected_original_dirname, "./src")
    }
  },
  build: {
    // 设置chunk大小警告限制
    chunkSizeWarningLimit: 1e3,
    rollupOptions: {
      output: {
        // 简化代码分割策略，避免React导入问题
        manualChunks(id) {
          if (id.includes("node_modules")) {
            return "vendor";
          }
        },
        // 用于从入口点创建单独的块
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? chunkInfo.facadeModuleId.split("/").pop() : "chunk";
          return `assets/js/${facadeModuleId}-[hash].js`;
        },
        // 用于命名代码拆分的块
        entryFileNames: "assets/js/[name]-[hash].js",
        // 用于命名静态资源
        assetFileNames: "assets/[ext]/[name]-[hash].[ext]"
      }
    },
    // 压缩配置
    terserOptions: {
      compress: {
        drop_console: true,
        // 生产环境移除console
        drop_debugger: true
        // 移除debugger
      }
    },
    // 启用css代码分割
    cssCodeSplit: true,
    // 生成源映射文件用于调试
    sourcemap: false
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS9ncm9tL0V1cmFGbG93L3dlYlwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiL2hvbWUvZ3JvbS9FdXJhRmxvdy93ZWIvdml0ZS5jb25maWcudHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL2hvbWUvZ3JvbS9FdXJhRmxvdy93ZWIvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJ1xuaW1wb3J0IHJlYWN0IGZyb20gJ0B2aXRlanMvcGx1Z2luLXJlYWN0J1xuaW1wb3J0IHBhdGggZnJvbSAncGF0aCdcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFtyZWFjdCgpXSxcbiAgc2VydmVyOiB7XG4gICAgaG9zdDogJzAuMC4wLjAnLCAgLy8gXHU1MTQxXHU4QkI4XHU1QzQwXHU1N0RGXHU3RjUxXHU4QkJGXHU5NUVFXG4gICAgcG9ydDogMzAwMCxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMCcsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH1cbiAgICB9XG4gIH0sXG4gIHJlc29sdmU6IHtcbiAgICBhbGlhczoge1xuICAgICAgJ0AnOiBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi9zcmMnKSxcbiAgICB9LFxuICB9LFxuICBidWlsZDoge1xuICAgIC8vIFx1OEJCRVx1N0Y2RWNodW5rXHU1OTI3XHU1QzBGXHU4QjY2XHU1NDRBXHU5NjUwXHU1MjM2XG4gICAgY2h1bmtTaXplV2FybmluZ0xpbWl0OiAxMDAwLFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICAvLyBcdTdCODBcdTUzMTZcdTRFRTNcdTc4MDFcdTUyMDZcdTUyNzJcdTdCNTZcdTc1NjVcdUZGMENcdTkwN0ZcdTUxNERSZWFjdFx1NUJGQ1x1NTE2NVx1OTVFRVx1OTg5OFxuICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcbiAgICAgICAgICAvLyBcdTVDMDZcdTYyNDBcdTY3MDlub2RlX21vZHVsZXNcdTc2ODRcdTUxODVcdTVCQjlcdTY1M0VcdTU3MjhcdTRFMDBcdTRFMkFcdTU5MjdcdTc2ODR2ZW5kb3IgY2h1bmtcdTRFMkRcbiAgICAgICAgICBpZiAoaWQuaW5jbHVkZXMoJ25vZGVfbW9kdWxlcycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3ZlbmRvcic7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICAvLyBcdTc1MjhcdTRFOEVcdTRFQ0VcdTUxNjVcdTUzRTNcdTcwQjlcdTUyMUJcdTVFRkFcdTUzNTVcdTcyRUNcdTc2ODRcdTU3NTdcbiAgICAgICAgY2h1bmtGaWxlTmFtZXM6IChjaHVua0luZm8pID0+IHtcbiAgICAgICAgICBjb25zdCBmYWNhZGVNb2R1bGVJZCA9IGNodW5rSW5mby5mYWNhZGVNb2R1bGVJZCA/IGNodW5rSW5mby5mYWNhZGVNb2R1bGVJZC5zcGxpdCgnLycpLnBvcCgpIDogJ2NodW5rJztcbiAgICAgICAgICByZXR1cm4gYGFzc2V0cy9qcy8ke2ZhY2FkZU1vZHVsZUlkfS1baGFzaF0uanNgO1xuICAgICAgICB9LFxuICAgICAgICAvLyBcdTc1MjhcdTRFOEVcdTU0N0RcdTU0MERcdTRFRTNcdTc4MDFcdTYyQzZcdTUyMDZcdTc2ODRcdTU3NTdcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdhc3NldHMvanMvW25hbWVdLVtoYXNoXS5qcycsXG4gICAgICAgIC8vIFx1NzUyOFx1NEU4RVx1NTQ3RFx1NTQwRFx1OTc1OVx1NjAwMVx1OEQ0NFx1NkU5MFxuICAgICAgICBhc3NldEZpbGVOYW1lczogJ2Fzc2V0cy9bZXh0XS9bbmFtZV0tW2hhc2hdLltleHRdJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBcdTUzOEJcdTdGMjlcdTkxNERcdTdGNkVcbiAgICB0ZXJzZXJPcHRpb25zOiB7XG4gICAgICBjb21wcmVzczoge1xuICAgICAgICBkcm9wX2NvbnNvbGU6IHRydWUsIC8vIFx1NzUxRlx1NEVBN1x1NzNBRlx1NTg4M1x1NzlGQlx1OTY2NGNvbnNvbGVcbiAgICAgICAgZHJvcF9kZWJ1Z2dlcjogdHJ1ZSwgLy8gXHU3OUZCXHU5NjY0ZGVidWdnZXJcbiAgICAgIH0sXG4gICAgfSxcbiAgICAvLyBcdTU0MkZcdTc1Mjhjc3NcdTRFRTNcdTc4MDFcdTUyMDZcdTUyNzJcbiAgICBjc3NDb2RlU3BsaXQ6IHRydWUsXG4gICAgLy8gXHU3NTFGXHU2MjEwXHU2RTkwXHU2NjIwXHU1QzA0XHU2NTg3XHU0RUY2XHU3NTI4XHU0RThFXHU4QzAzXHU4QkQ1XG4gICAgc291cmNlbWFwOiBmYWxzZSxcbiAgfSxcbn0pIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1UCxTQUFTLG9CQUFvQjtBQUNwUixPQUFPLFdBQVc7QUFDbEIsT0FBTyxVQUFVO0FBRmpCLElBQU0sbUNBQW1DO0FBS3pDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLFNBQVMsQ0FBQyxNQUFNLENBQUM7QUFBQSxFQUNqQixRQUFRO0FBQUEsSUFDTixNQUFNO0FBQUE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFDQSxTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDdEM7QUFBQSxFQUNGO0FBQUEsRUFDQSxPQUFPO0FBQUE7QUFBQSxJQUVMLHVCQUF1QjtBQUFBLElBQ3ZCLGVBQWU7QUFBQSxNQUNiLFFBQVE7QUFBQTtBQUFBLFFBRU4sYUFBYSxJQUFJO0FBRWYsY0FBSSxHQUFHLFNBQVMsY0FBYyxHQUFHO0FBQy9CLG1CQUFPO0FBQUEsVUFDVDtBQUFBLFFBQ0Y7QUFBQTtBQUFBLFFBRUEsZ0JBQWdCLENBQUMsY0FBYztBQUM3QixnQkFBTSxpQkFBaUIsVUFBVSxpQkFBaUIsVUFBVSxlQUFlLE1BQU0sR0FBRyxFQUFFLElBQUksSUFBSTtBQUM5RixpQkFBTyxhQUFhLGNBQWM7QUFBQSxRQUNwQztBQUFBO0FBQUEsUUFFQSxnQkFBZ0I7QUFBQTtBQUFBLFFBRWhCLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSxlQUFlO0FBQUEsTUFDYixVQUFVO0FBQUEsUUFDUixjQUFjO0FBQUE7QUFBQSxRQUNkLGVBQWU7QUFBQTtBQUFBLE1BQ2pCO0FBQUEsSUFDRjtBQUFBO0FBQUEsSUFFQSxjQUFjO0FBQUE7QUFBQSxJQUVkLFdBQVc7QUFBQSxFQUNiO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
