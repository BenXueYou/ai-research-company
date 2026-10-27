import { database, migrate } from '../server/database.js';
import { IdentityService } from '../server/identity.js';
export async function testDatabase() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('必须显式设置以 _test 结尾的 TEST_DATABASE_URL；将清空该库身份表');
  const pool = database(url);
  await migrate(pool);
  await pool.query('TRUNCATE login_throttles,audit_events,sessions,bootstrap_marker,accounts,organizations RESTART IDENTITY CASCADE');
  return { pool, service: new IdentityService(pool) };
}
