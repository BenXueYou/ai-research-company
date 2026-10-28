import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../dist/tests/browser',
  testMatch: 'email-preview.spec.js',
  workers: 1,
  timeout: 60000,
  outputDir: '../../test-results-t21',
  use: { baseURL: 'http://127.0.0.1:3112', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
