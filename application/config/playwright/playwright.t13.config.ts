import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../dist/tests/browser',
  testMatch: 'detail-reconciliation.spec.js',
  workers: 1,
  timeout: 45000,
  outputDir: '../../.scratch/playwright-results/t13',
  use: { baseURL: 'http://127.0.0.1:3104', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
