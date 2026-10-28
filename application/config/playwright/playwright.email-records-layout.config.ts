import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '../../tests/browser',
  testMatch: 'email-records-empty.spec.ts',
  outputDir: '../../.scratch/email-style/empty-test-results',
  workers: 1,
  timeout: 45000,
  reporter: 'list',
  use: { browserName: 'chromium' }
});
