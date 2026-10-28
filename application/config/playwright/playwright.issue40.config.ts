import { defineConfig } from '@playwright/test';

process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../.scratch/issue40/compiled/tests',
  testMatch: 'issue40-point-orders.spec.js',
  outputDir: '../../.scratch/issue40/playwright-results',
  workers: 1,
  timeout: 180000,
  preserveOutput: 'failures-only',
  use: {
    baseURL: 'http://127.0.0.1:3140',
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  reporter: [['list']]
});
