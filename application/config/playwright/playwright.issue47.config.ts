import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue47/compiled/tests',
  testMatch: 'issue47-overview.spec.js',
  outputDir: '../../.scratch/issue47/playwright-results',
  workers: 1,
  timeout: 180000,
  use: {
    baseURL: 'http://127.0.0.1:3247',
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
