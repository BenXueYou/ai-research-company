import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/router-dist/tests/browser',
  testMatch: 'router-navigation.spec.js',
  outputDir: '../../.scratch/playwright-results/router',
  workers: 1,
  timeout: 90000,
  use: { baseURL: 'http://127.0.0.1:3309', browserName: 'chromium' },
  reporter: [['list']]
});
