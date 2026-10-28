import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../dist/tests/browser',
  testMatch: 'coefficient.spec.js',
  workers: 1,
  timeout: 90000,
  outputDir: '../../.scratch/playwright-results/t27',
  use: { baseURL: 'http://127.0.0.1:3178', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
