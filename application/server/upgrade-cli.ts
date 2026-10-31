import { database } from './database.js';
import { applyUpgrade, planUpgrade, verifyUpgrade } from './migrations/upgrade.js';

const pool = database();
function printable(value: Awaited<ReturnType<typeof planUpgrade>>) {
  return { ...value, snapshot: value.snapshot ? { schema: value.snapshot.schema, tables: Object.keys(value.snapshot.data).length } : undefined };
}
try {
  const command = process.argv[2];
  if (command === 'plan') console.log(JSON.stringify(printable(await planUpgrade(pool)), null, 2));
  else if (command === 'apply') console.log(JSON.stringify(printable(await applyUpgrade(pool, { backupDir: process.argv.includes('--backup-dir') ? process.argv[process.argv.indexOf('--backup-dir') + 1] : undefined, failAfterBaseline: process.argv.includes('--fail-after-baseline') })), null, 2));
  else if (command === 'verify') console.log(JSON.stringify(await verifyUpgrade(pool), null, 2));
  else throw new Error('使用 upgrade plan、upgrade apply 或 upgrade verify');
} catch (error) {
  console.error(`升级失败：${error instanceof Error ? error.message : '未知错误'}`);
  process.exitCode = 1;
} finally { await pool.end(); }
