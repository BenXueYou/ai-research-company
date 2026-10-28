import { defineConfig } from 'vite';
import base from '../../vite.config';

export default defineConfig({
  ...base,
  cacheDir: '.scratch/issue50/vite-cache',
  build: { outDir: '.scratch/issue50/web', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    port: 5250,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3250' }
  }
});
