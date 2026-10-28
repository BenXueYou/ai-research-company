import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const container = `codex-issue58-${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(24).toString('hex');
const database = `issue58_${randomUUID().replaceAll('-', '')}_test`;
function docker(...args) {
  const result = spawnSync('docker', args, { encoding: 'utf8', env: { ...process.env, POSTGRES_PASSWORD: password } });
  if (result.status !== 0) throw new Error(`Docker failed: ${args[0]}`);
  return result.stdout.trim();
}
function node(args, env = process.env) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Verification step failed: ${args[0]}`);
}
docker('run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD',
  '-e', 'POSTGRES_USER=acquisition', '-e', `POSTGRES_DB=${database}`, 'postgres:17.6-alpine');
try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', database], { stdio: 'ignore' }).status === 0) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const port = docker('port', container, '5432/tcp').split(':').at(-1);
  node(['node_modules/typescript/bin/tsc', '-p', 'config/tsconfig.issue58.json']);
  node(['node_modules/vite/bin/vite.js', 'build', '--outDir', '.scratch/issue58/web']);
  node(['node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue58.config.ts'], {
    ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${port}/${database}`
  });
} finally {
  docker('rm', '--force', '--volumes', container);
}
