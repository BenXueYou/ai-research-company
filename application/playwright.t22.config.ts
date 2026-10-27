import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './dist/tests/browser',
  testMatch: 'email-send.spec.js',
  workers: 1,
  timeout: 60000,
  outputDir: 'test-results-t22',
  use: { baseURL: 'http://127.0.0.1:3122', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
