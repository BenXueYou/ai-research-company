import { spawnSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const id = randomUUID().replaceAll('-', '');
const container = `codex-integration-terminal-${id}`;
const database = `integration_terminal_${id}_test`;
const env = { ...process.env, POSTGRES_PASSWORD: randomBytes(24).toString('hex') };
function run(command, args, variables = env, quiet = false) {
  const result = spawnSync(command, args, { env: variables, encoding: 'utf8', stdio: quiet ? 'pipe' : 'inherit' });
  if (result.status !== 0) throw new Error(`Terminal integration command failed: ${args[0]}`);
  return result.stdout?.trim();
}
mkdirSync('.scratch/integration-terminal', { recursive: true });
writeFileSync('.scratch/integration-terminal/.gitignore', '*\n');
function sources(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? sources(join(directory, entry.name)) : [join(directory, entry.name)])
    .filter(path => !path.endsWith('.test.ts'));
}
function fingerprint() {
  return Object.fromEntries([...sources('web'), ...sources('server'), 'vite.config.ts'].sort().map(path =>
    [path.replaceAll('\\', '/'), createHash('sha256').update(readFileSync(path)).digest('hex')]));
}
const beforeSources = fingerprint();
run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'integration-terminal/tsconfig.json']);
run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--outDir', '.scratch/integration-terminal/web']);
run('docker', ['run', '--detach', '--name', container, '--publish', '127.0.0.1::5432', '-e', 'POSTGRES_PASSWORD',
  '-e', 'POSTGRES_USER=acquisition', '-e', `POSTGRES_DB=${database}`, 'postgres:17.6-alpine'], env, true);
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (spawnSync('docker', ['exec', container, 'pg_isready', '-U', 'acquisition', '-d', database], { stdio: 'ignore' }).status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (!ready) throw new Error('Isolated database not ready');
  const port = run('docker', ['port', container, '5432/tcp'], env, true).split(':').at(-1);
  const testEnv = { ...env, TEST_DATABASE_URL: `postgresql://acquisition:${env.POSTGRES_PASSWORD}@127.0.0.1:${port}/${database}` };
  const browser = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'integration-terminal/playwright.config.mjs'], { env: testEnv, stdio: 'inherit' });
  const afterSources = fingerprint();
  const stable = JSON.stringify(beforeSources) === JSON.stringify(afterSources);
  writeFileSync('../docs/delivery/application/TERMINAL-INTEGRATION-SOURCE.json', JSON.stringify({ stable, browserExitCode: browser.status, completedAt: new Date().toISOString(), sources: afterSources }, null, 2));
  if (!stable) throw new Error('Application sources changed during integration; repeat after parallel source work settles');
  if (browser.status !== 0) throw new Error('Terminal integration contains a failing acceptance assertion; see completion record');
} finally {
  run('docker', ['rm', '--force', '--volumes', container], env, true);
}
