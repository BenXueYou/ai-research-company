import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../tests/browser',
  testMatch: 'issue42-settings.spec.ts',
  outputDir: '../../.scratch/issue42-results',
  use: { baseURL: 'http://127.0.0.1:5198', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  webServer: {
    cwd: '../..',
    command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: false
  },
  reporter: [['list']]
});
