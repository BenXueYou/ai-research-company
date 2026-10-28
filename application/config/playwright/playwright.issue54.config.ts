import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue54/compiled/tests',
  testMatch: 'issue54-products.spec.js',
  outputDir: '../../.scratch/issue54/results',
  workers: 1,
  timeout: 180000,
  preserveOutput: 'never',
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
