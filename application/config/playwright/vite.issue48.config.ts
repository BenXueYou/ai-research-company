import { defineConfig } from 'vite';
import base from '../../vite.config';

export default defineConfig({
  ...base,
  server: {
    host: '127.0.0.1',
    port: 5488,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:3490' }
  }
});
