import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../dist/tests/browser',
  testMatch: 'upstream-monitor.spec.js',
  workers: 1,
  timeout: 60000,
  preserveOutput: 'never',
  use: { baseURL: 'http://127.0.0.1:3198', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
