import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../.scratch/issue58/compiled/tests',
  testMatch: 'issue58-members.spec.js',
  outputDir: '../../.scratch/issue58/results',
  workers: 1,
  timeout: 180000,
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
