import pg from 'pg';
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const secret = randomBytes(24).toString('hex');
writeFileSync('.scratch/issue43-postgres.env', `POSTGRES_USER=acquisition\nPOSTGRES_PASSWORD=${secret}\nPOSTGRES_DB=acquisition_issue43_20261028_test\n`);
execFileSync('docker', ['run', '--detach', '--name', 'codex-issue43-20261028', '--env-file', '.scratch/issue43-postgres.env', '-p', '127.0.0.1:55463:5432', 'postgres:17.6-alpine']);
await new Promise(resolve => setTimeout(resolve, 3000));
const url = new URL(`postgresql://acquisition:${secret}@127.0.0.1:55463/postgres`);
const pool = new pg.Pool({ connectionString: url.toString() });
const name = 'acquisition_issue43_20261028_test';
try {
  if (!(await pool.query('SELECT 1 FROM pg_database WHERE datname=$1', [name])).rowCount)
    await pool.query(`CREATE DATABASE ${name}`);
  url.pathname = `/${name}`;
  writeFileSync('.scratch/issue43-test.env', `TEST_DATABASE_URL=${url}\n`);
  console.log(`Dedicated database ready: ${name}`);
} finally { await pool.end(); }
