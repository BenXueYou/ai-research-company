import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue45-dist/issue45-tests',
  testMatch: 'upstream.spec.js',
  outputDir: '../../.scratch/playwright-results/issue45',
  workers: 1,
  timeout: 90000,
  preserveOutput: 'never',
  use: { baseURL: 'http://127.0.0.1:3205', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});


