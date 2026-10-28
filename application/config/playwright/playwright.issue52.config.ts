import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue52/compiled/tests',
  testMatch: 'issue52-profiles.spec.js',
  outputDir: '../../.scratch/issue52/results',
  workers: 1,
  timeout: 180000,
  use: { baseURL: 'http://127.0.0.1:3252', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
