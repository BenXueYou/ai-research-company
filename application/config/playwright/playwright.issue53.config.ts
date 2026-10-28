import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue53/compiled/tests',
  testMatch: 'issue53-search.spec.js',
  outputDir: '../../.scratch/issue53/results',
  workers: 1,
  timeout: 240000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
