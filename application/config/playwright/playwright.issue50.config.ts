import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue50/compiled/tests',
  testMatch: 'issue50-distribution-orders.spec.js',
  outputDir: '../../.scratch/issue50/results',
  workers: 1,
  timeout: 240000,
  use: {
    baseURL: 'http://127.0.0.1:3250',
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
