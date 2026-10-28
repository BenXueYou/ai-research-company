import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/t16-dist/tests',
  testMatch: 'company-profiles.spec.js',
  workers: 1,
  timeout: 60000,
  outputDir: '../../.scratch/playwright-results/t16',
  use: { baseURL: 'http://127.0.0.1:3166', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
