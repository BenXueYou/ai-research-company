import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue51/compiled/tests',
  testMatch: 'issue51-profit.spec.js',
  outputDir: '../../.scratch/issue51/playwright-results',
  workers: 1,
  timeout: 180000,
  preserveOutput: 'never',
  use: {
    baseURL: 'http://127.0.0.1:3351',
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
