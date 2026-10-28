import { defineConfig } from 'vite';
import base from '../../vite.config';

export default defineConfig({
  ...base,
  server: {
    host: '127.0.0.1',
    port: Number(process.env.ISSUE49_VITE_PORT ?? 5591),
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:' + (process.env.ISSUE49_VITE_BACKEND ?? 3593) }
  }
});
