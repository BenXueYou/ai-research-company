import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './dist/tests/browser',
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:3092', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']],
});
