import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './compiled/.scratch/email-style',
  testMatch: 'issue56-emails.spec.js',
  outputDir: './playwright-results',
  workers: 1,
  timeout: 180000,
  use: { browserName: 'chromium', actionTimeout: 10000, trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
