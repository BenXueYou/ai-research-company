import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/t25-dist/tests',
  testMatch: 'email-cross-day.spec.js',
  workers: 1,
  timeout: 60000,
  outputDir: '../../.scratch/playwright-results/t25',
  use: { baseURL: 'http://127.0.0.1:3145', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
