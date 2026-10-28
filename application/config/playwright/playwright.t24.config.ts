import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/t24-dist/tests',
  testMatch: 'email-evidence.spec.js',
  workers: 1,
  timeout: 60000,
  outputDir: '../../.scratch/t24-playwright-results',
  use: { baseURL: 'http://127.0.0.1:3144', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
