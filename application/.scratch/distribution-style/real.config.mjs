export default {
  testDir: './compiled/tests',
  testMatch: ['issue48-organizations.spec.js', 'issue50-distribution-orders.spec.js', 'issue51-profit.spec.js'],
  outputDir: './results',
  workers: 1,
  timeout: 240000,
  use: { baseURL: 'http://127.0.0.1:3250', browserName: 'chromium', actionTimeout: 10000, trace: 'off', screenshot: 'only-on-failure' },
  reporter: [['list']]
};
