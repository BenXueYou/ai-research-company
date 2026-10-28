import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue59/compiled/tests',
  testMatch: 'issue59-usage.spec.js',
  outputDir: '../../.scratch/issue59/playwright-results',
  workers: 1,
  timeout: 180000,
  preserveOutput: 'never',
  use: {
    baseURL: 'http://127.0.0.1:3459',
    browserName: 'chromium',
    actionTimeout: 10000,
    trace: 'off',
    screenshot: 'off'
  },
  reporter: [['list']]
});
