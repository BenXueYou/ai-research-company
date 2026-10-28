import { spawnSync } from 'node:child_process';

// The test itself creates and drops only a random issue40_<uuid>_test database.
if (!process.env.DATABASE_URL) throw new Error('需要本地数据库管理连接以创建独立测试库');
const source = new URL(process.env.DATABASE_URL);
source.pathname = '/issue40_connection_test';
const args = process.argv.includes('--http') ? [
  '--test', '--test-concurrency=1',
  '.scratch/issue40-shortage/compiled/tests/point-orders.test.js',
  '.scratch/issue40-shortage/compiled/tests/point-transfers.test.js',
  '.scratch/issue40-shortage/compiled/tests/point-refunds.test.js'
] : [
  'node_modules/@playwright/test/cli.js', 'test',
  '--config', 'config/playwright/playwright.issue40-shortage.config.ts'
];
const result = spawnSync(process.execPath, args, {
  env: { ...process.env, TEST_DATABASE_URL: source.toString() },
  stdio: 'inherit'
});
process.exitCode = result.status ?? 1;
