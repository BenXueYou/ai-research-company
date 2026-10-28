import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue40-shortage/compiled/tests',
  testMatch: 'issue40-point-orders.spec.js',
  outputDir: '../../.scratch/issue40-shortage/results',
  workers: 1,
  timeout: 240000,
  use: {
    baseURL: 'http://127.0.0.1:3240',
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  reporter: [['list']]
});
