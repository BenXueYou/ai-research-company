import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/issue57-tests',
  testMatch: /issue57-page\.spec\.ts/,
  outputDir: '../../.scratch/playwright-results/issue57',
  preserveOutput: 'never',
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:3217', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  webServer: { cwd: '../..', command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 3217 --strictPort', url: 'http://127.0.0.1:3217', reuseExistingServer: false },
  reporter: [['list']]
});


