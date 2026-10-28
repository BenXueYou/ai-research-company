import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, copyFileSync } from 'node:fs';
import { createServer } from 'node:net';
const freePort = async () => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return String(port);
};
const run = (args, env = process.env) => {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Verification failed: ${args[0]}`);
};
mkdirSync('.scratch/issue54', { recursive: true });
run(['node_modules/typescript/bin/tsc', '-p', 'config/tsconfig.issue54.json']);
copyFileSync('package.json', '.scratch/issue54/package.json');
run(['node_modules/vite/bin/vite.js', 'build', '--outDir', '.scratch/issue54/web']);
const container = `codex-issue54-${randomUUID().replaceAll('-', '')}`;
const databaseName = `issue54_${randomUUID().replaceAll('-', '')}_test`;
const password = randomBytes(24).toString('hex');
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (result.status !== 0) throw new Error(`Docker failed: ${args[0]}`);
  return result.stdout.trim();
};
docker('run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD',
  '-e', 'POSTGRES_USER=acquisition', '-e', `POSTGRES_DB=${databaseName}`, 'postgres:17.6-alpine');
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const check = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', databaseName], { stdio: 'ignore' });
    if (check.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Isolated database unavailable');
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const env = {
    ...process.env,
    TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/${databaseName}`,
    PRODUCT_SEARCH_TEST_PORT: await freePort(),
    DETAIL_RECONCILIATION_TEST_PORT: await freePort()
  };
  run(['--test', '--test-concurrency=1', '.scratch/issue54/compiled/tests/product-search.test.js', '.scratch/issue54/compiled/tests/detail-reconciliation.test.js'], env);
  run(['node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue54.config.ts'], env);
} finally {
  docker('rm', '--force', '--volumes', container);
}
