import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../.scratch/issue43-dist/tests/browser',
  testMatch: 'issue43-email-settings.spec.js',
  outputDir: '../../.scratch/issue43-results',
  workers: 1,
  timeout: 120000,
  preserveOutput: 'never',
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
