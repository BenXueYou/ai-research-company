import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';

const container = `codex-issue57-${randomUUID().replaceAll('-', '')}`;
const password = randomBytes(24).toString('hex');
function run(command, args, env = process.env, output = 'inherit') {
  const result = spawnSync(command, args, { env, stdio: output, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Verification command failed: ${args[0]}`);
  return result.stdout?.trim();
}
async function port() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const number = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return number;
}
const dockerEnv = { ...process.env, POSTGRES_PASSWORD: password };
run('docker', ['run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD',
  '-e', 'POSTGRES_USER=acquisition', '-e', 'POSTGRES_DB=issue57_test', 'postgres:17.6-alpine'], dockerEnv, 'pipe');
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const status = spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', 'issue57_test'], { stdio: 'ignore' });
    if (status.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Isolated PostgreSQL not ready');
  const dbPort = run('docker', ['port', container, '5432/tcp'], dockerEnv, 'pipe').split(':').at(-1);
  const env = { ...process.env, TEST_DATABASE_URL: `postgresql://acquisition:${password}@127.0.0.1:${dbPort}/issue57_test` };
  run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json', '--outDir', '.scratch/issue57/compiled'], env);
  run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.scratch/issue57/web'], env);
  // Existing service suites retain their assertions, with only isolated runtime ports.
  for (const [file, oldPort] of process.argv.includes('--browser-only') ? [] : [['smtp-channel', 3093], ['umail', 3094]]) {
    const path = `.scratch/issue57/compiled/tests/${file}.test.js`;
    writeFileSync(path, readFileSync(path, 'utf8').replaceAll(String(oldPort), String(await port())));
    run(process.execPath, ['--test', path], env);
  }
  run(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'config/playwright/playwright.issue57-real.config.ts'], env);
} finally {
  run('docker', ['rm', '--force', '--volumes', container], dockerEnv, 'pipe');
}
