import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: '../../dist/tests/browser',
  testMatch: ['account-header.spec.js', 'issue34-layout.spec.js', 'issue34-contract.spec.js'],
  outputDir: '../../.scratch/issue34-results',
  workers: 1,
  timeout: 45000,
  preserveOutput: 'never',
  use: { browserName: 'chromium', trace: 'off', screenshot: 'off' },
  reporter: [['list']]
});
