import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue55/compiled/tests',
  testMatch: 'issue55-contacts.spec.js',
  outputDir: '../../.scratch/issue55/results',
  workers: 1,
  timeout: 180000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off', actionTimeout: 15000 },
  reporter: [['list']]
});
