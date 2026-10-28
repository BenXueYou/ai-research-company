import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const name = `email_style_${randomUUID().replaceAll('-', '')}_test`;
const container = `codex-${name}`;
const password = randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (result.status !== 0) throw new Error(`Docker ${args[0]} failed: ${result.stderr}`);
  return result.stdout.trim();
}
docker('run', '--detach', '--name', container, '--publish', '127.0.0.1::5432',
  '-e', 'POSTGRES_PASSWORD', '-e', 'POSTGRES_USER=acquisition', '-e', `POSTGRES_DB=${name}`, 'postgres:17.6-alpine');
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', name], { stdio: 'ignore' });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Dedicated PostgreSQL did not become ready');
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  const result = spawnSync(process.execPath, [
    'node_modules/tsx/dist/cli.mjs', '--tsconfig', 'tsconfig.server.json', '--test', 'tests/email-send.test.ts'
  ], { env: { ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/${name}` }, stdio: 'inherit' });
  const compiled = spawnSync(process.execPath, [
    'node_modules/typescript/bin/tsc', '-p', '.scratch/email-style/tsconfig.json'
  ], { env: process.env, stdio: 'inherit' });
  if (compiled.status !== 0) throw new Error('Isolated browser test compile failed');
  const browser = spawnSync(process.execPath, [
    'node_modules/@playwright/test/cli.js', 'test', '--config', '.scratch/email-style/playwright.config.ts'
  ], { env: { ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/${name}` }, stdio: 'inherit' });
  process.exitCode = result.status || browser.status || 0;
} finally {
  docker('rm', '--force', '--volumes', container);
}
