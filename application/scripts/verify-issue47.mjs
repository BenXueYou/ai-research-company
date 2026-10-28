import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const container = `codex-issue47-${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(24).toString('hex');
const docker = (...args) => {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (result.status !== 0) throw new Error(`Docker command failed: ${args[0]}`);
  return result.stdout.trim();
};
docker('run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD',
  '-e', 'POSTGRES_USER=acquisition', '-e', 'POSTGRES_DB=issue47_test', 'postgres:17.6-alpine');
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', 'issue47_test'], { stdio: 'ignore' });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Isolated PostgreSQL did not become ready');
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const result = spawnSync(process.execPath, [
    'node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue47.config.ts'
  ], { env: { ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/issue47_test` }, stdio: 'inherit' });
  process.exitCode = result.status ?? 1;
} finally {
  docker('rm', '--force', '--volumes', container);
}
