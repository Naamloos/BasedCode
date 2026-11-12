import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: { host: '127.0.0.1', strictPort: true, port: 5317 },
  build: {
    outDir: 'dist/ui',
    rollupOptions: { input: { app: 'index.html', mcpUi: 'mcp-ui.html' } },
  },
});
