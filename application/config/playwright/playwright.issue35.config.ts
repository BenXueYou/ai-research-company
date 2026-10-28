import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue35-dist/tests/browser',
  testMatch: 'issue35-navigation.spec.js',
  outputDir: '../../.scratch/playwright-results/issue35',
  workers: 1,
  timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3299', browserName: 'chromium' },
  reporter: [['list']]
});
