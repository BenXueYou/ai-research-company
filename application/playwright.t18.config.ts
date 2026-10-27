import { defineConfig } from '@playwright/test';
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';
export default defineConfig({
  testDir: './.scratch/t18-dist/tests/browser',
  testMatch: 'company-attachments.spec.js',
  outputDir: './.scratch/t18-playwright-results',
  workers: 1,
  timeout: 60_000,
  preserveOutput: 'never',
  use: { baseURL: 'http://127.0.0.1:3189', browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
