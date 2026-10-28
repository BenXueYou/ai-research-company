import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './t15-style-compiled/tests',
  testMatch: 'issue52-profiles.spec.js',
  outputDir: './t15-style-results',
  workers: 1,
  timeout: 60000,
  use: { baseURL: 'http://127.0.0.1:3252', browserName: 'chromium', trace: 'retain-on-failure', screenshot: 'off' },
  reporter: [['list']]
});
