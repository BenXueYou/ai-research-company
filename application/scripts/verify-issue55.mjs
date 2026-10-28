import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
const container = `codex-issue55-${randomUUID().replaceAll('-', '')}`;
const databaseName = `issue55_${randomUUID().replaceAll('-', '')}_test`;
const password = randomBytes(24).toString('hex');
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (result.status !== 0) throw new Error(`Docker command failed: ${args[0]}`);
  return result.stdout.trim();
};
docker('run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD',
  '-e', 'POSTGRES_USER=acquisition', '-e', `POSTGRES_DB=${databaseName}`, 'postgres:17.6-alpine');
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', databaseName], { stdio: 'ignore' }).status === 0) {
      ready = true; break;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const env = { ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/${databaseName}` };
  const browser = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config',
    'config/playwright/playwright.issue55.config.ts'], { env, stdio: 'inherit' });
  if (browser.status !== 0) process.exitCode = browser.status ?? 1;
  else {
    const integration = spawnSync(process.execPath, ['--test', '--test-concurrency=1',
      '.scratch/issue55/compiled/tests/company-contacts.test.js',
      '.scratch/issue55/compiled/tests/email-preview.test.js',
      '.scratch/issue55/compiled/tests/email-send.test.js'], { env, stdio: 'inherit' });
    process.exitCode = integration.status ?? 1;
  }
} finally {
  docker('rm', '--force', '--volumes', container);
}
