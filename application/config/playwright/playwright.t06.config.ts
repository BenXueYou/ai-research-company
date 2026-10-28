import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: '../../dist-t06/tests/browser',
  testMatch: 'procurement.spec.js',
  outputDir: '../../test-results-t06',
  workers: 1,
  timeout: 90000,
  preserveOutput: 'never',
  use: { baseURL: 'http://127.0.0.1:3096', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
