import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
  appType: 'mpa',
  plugins: [vue(), {
    name: 'console-history',
    configureServer(server) {
      const paths = new Set([
        '/platform/overview', '/platform/organizations', '/platform/ledger', '/platform/reconciliation', '/platform/reconciliation/upstream', '/platform/settings',
        '/platform/ledger/profit', '/platform/ledger/flows',
        '/distribution/organizations', '/distribution/orders', '/distribution/profit',
        '/terminal/search', '/terminal/profiles', '/terminal/emails', '/terminal/sending-settings', '/terminal/members', '/terminal/usage',
        '/account/settings', '/help'
      ]);
      server.middlewares.use((request, _response, next) => {
        const url = new URL(request.url ?? '/', 'http://localhost');
        if ((request.method === 'GET' || request.method === 'HEAD') && paths.has(url.pathname))
          request.url = `/index.html${url.search}`;
        next();
      });
    }
  }],
  build: { outDir: 'dist/web' },
  server: { proxy: { '/api': 'http://127.0.0.1:3000' } }
});
