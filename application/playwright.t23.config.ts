import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './.scratch/t23-dist/tests/browser',
  testMatch: 'email-send.spec.js',
  workers: 1,
  timeout: 60000,
  outputDir: '.scratch/t23-playwright-results',
  use: { baseURL: 'http://127.0.0.1:3133', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
