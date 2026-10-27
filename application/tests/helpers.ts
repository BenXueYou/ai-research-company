import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword, normalizeEmail, temporaryPassword } from '../server/policy.js';
import type pg from 'pg';
import { database, migrate } from '../server/database.js';
import { IdentityService } from '../server/identity.js';
export async function testDatabase() {
  process.env.ORG_CONTACT_KEY ??= randomBytes(32).toString('hex');
  process.env.SMTP_CREDENTIAL_KEY ??= randomBytes(32).toString('hex');
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('必须显式设置以 _test 结尾的 TEST_DATABASE_URL；将清空该库身份表');
  const pool = database(url);
  await migrate(pool);
  await pool.query('TRUNCATE application_keys,login_throttles,audit_events,sessions,bootstrap_marker,accounts,organizations RESTART IDENTITY CASCADE');
  return { pool, service: new IdentityService(pool) };
}

// Ordinary account fixture only; account creation remains a later ticket.
export async function ordinaryAccount(pool: pg.Pool, emailInput: string) {
  const email = normalizeEmail(emailInput);
  const password = temporaryPassword();
  const organizationId = randomUUID();
  await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'测试组织','platform')", [organizationId]);
  await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,temporary_expires_at)
    VALUES($1,$2,$3,$4,'admin',clock_timestamp() + interval '72 hours')`, [randomUUID(), organizationId, email, await hashPassword(password)]);
  return { email, password };
}
