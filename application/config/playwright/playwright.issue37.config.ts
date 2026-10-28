import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  testDir: '../../tests',
  testMatch: 'issue37-platform.spec.ts',
  outputDir: '../../.scratch/issue37-results',
  webServer: {
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197 --strictPort',
    cwd: fileURLToPath(new URL('../..', import.meta.url)),
    url: 'http://127.0.0.1:5197/platform/organizations',
    reuseExistingServer: false
  },
  use: { baseURL: 'http://127.0.0.1:5197', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
