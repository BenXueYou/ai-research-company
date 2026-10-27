import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from './database.js';
import { hashPassword, normalizeEmail, temporaryPassword, validNewPassword, verifyPassword } from './policy.js';

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');
export interface Identity {
  id: string;
  email: string;
  role: string;
  organization_id: string;
  must_change: boolean;
  csrf_hash: string;
}
const loginFailure = (): UnauthorizedException => new UnauthorizedException('邮箱或密码错误，或凭据已失效');
export class IdentityService {
  private readonly dummyHash = hashPassword(randomBytes(32).toString('hex'));
  constructor(readonly pool: pg.Pool) {}

  async bootstrap(emailInput: unknown, organizationName: string): Promise<{ email: string; password: string }> {
    const email = normalizeEmail(emailInput);
    if (!organizationName.trim() || organizationName.length > 120)
      throw new BadRequestException('组织名称无效');
    const password = temporaryPassword();
    const hash = await hashPassword(password);
    await transaction(this.pool, async client => {
      await client.query('SELECT pg_advisory_xact_lock(712011)');
      const marker = await client.query('SELECT 1 FROM bootstrap_marker');
      if (marker.rowCount)
        throw new ConflictException('初始引导已完成');
      const org = randomUUID();
      const id = randomUUID();
      await client.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'platform')", [org, organizationName]);
      await client.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,temporary_expires_at)
        VALUES($1,$2,$3,$4,'platform',clock_timestamp() + interval '72 hours')`, [id, org, email, hash]);
      await client.query('INSERT INTO bootstrap_marker(account_id) VALUES($1)', [id]);
      await client.query("INSERT INTO audit_events(event,account_id) VALUES('bootstrap',$1)", [id]);
    });
    return { email, password };
  }

  async login(input: Record<string, unknown>, address: string): Promise<{ token: string; csrf: string }> {
    let email: string;
    try { email = normalizeEmail(input.email); } catch { throw loginFailure(); }
    if (typeof input.password !== 'string' || Buffer.byteLength(input.password) > 1024)
      throw loginFailure();
    // A persistent, atomic per-source budget bounds KDF work without logging source addresses.
    const throttle = await this.pool.query(`INSERT INTO login_throttles(key_hash,attempts,window_start)
      VALUES($1,1,clock_timestamp()) ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN login_throttles.window_start < clock_timestamp() - interval '15 minutes' THEN 1 ELSE login_throttles.attempts + 1 END,
      window_start = CASE WHEN login_throttles.window_start < clock_timestamp() - interval '15 minutes' THEN clock_timestamp() ELSE login_throttles.window_start END
      RETURNING attempts`, [digest(address)]);
    if (throttle.rows[0].attempts > 40)
      throw loginFailure();
    const password = input.password;
    const result = await transaction(this.pool, async client => {
      const found = await client.query('SELECT * FROM accounts WHERE email=$1 FOR UPDATE', [email]);
      const account = found.rows[0];
      const verified = await verifyPassword(password, account?.password_hash ?? await this.dummyHash);
      const validity = account && await client.query(`SELECT active AND (NOT must_change OR temporary_expires_at > clock_timestamp()) AS valid
        FROM accounts WHERE id=$1`, [account.id]);
      if (!verified || !validity?.rows[0].valid) {
        await client.query("INSERT INTO audit_events(event,account_id) VALUES('login_failed',$1)", [account?.id ?? null]);
        return null;
      }
      const token = randomBytes(32).toString('base64url');
      const csrf = randomBytes(32).toString('base64url');
      await client.query('INSERT INTO sessions(token_hash,account_id,csrf_hash) VALUES($1,$2,$3)', [digest(token), account.id, digest(csrf)]);
      await client.query("INSERT INTO audit_events(event,account_id) VALUES('login_ok',$1)", [account.id]);
      return { token, csrf };
    });
    if (!result)
      throw loginFailure();
    return result;
  }

  async authenticate(token: string): Promise<Identity> {
    const result = await this.pool.query(`UPDATE sessions s SET last_seen_at=clock_timestamp() FROM accounts a
      WHERE s.token_hash=$1 AND a.id=s.account_id AND a.active
      AND s.expires_at > clock_timestamp() AND s.last_seen_at > clock_timestamp() - interval '30 minutes'
      AND (NOT a.must_change OR a.temporary_expires_at > clock_timestamp())
      RETURNING a.id,a.email,a.role,a.organization_id,a.must_change,s.csrf_hash`, [digest(token)]);
    if (!result.rowCount)
      throw new UnauthorizedException('请重新登录');
    return result.rows[0] as Identity;
  }

  async changePassword(token: string, input: Record<string, unknown>): Promise<void> {
    if (!validNewPassword(input.newPassword) || input.newPassword !== input.confirmPassword)
      throw new BadRequestException('新密码须为12～128个Unicode字符，且两次输入一致');
    if (typeof input.currentPassword !== 'string' || Buffer.byteLength(input.currentPassword) > 1024)
      throw new BadRequestException('当前密码错误');
    const current = input.currentPassword;
    const next = input.newPassword;
    const result = await transaction(this.pool, async client => {
      const lookup = await client.query('SELECT account_id FROM sessions WHERE token_hash=$1', [digest(token)]);
      if (!lookup.rowCount)
        throw new UnauthorizedException('请重新登录');
      // Always acquire the account lock before checking the session again. Login uses this same lock.
      const found = await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [lookup.rows[0].account_id]);
      const account = found.rows[0];
      const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1
        AND expires_at > clock_timestamp() AND last_seen_at > clock_timestamp() - interval '30 minutes'`, [digest(token)]);
      const valid = await client.query(`SELECT active AND (NOT must_change OR temporary_expires_at > clock_timestamp()) AS valid FROM accounts WHERE id=$1`, [account.id]);
      if (!live.rowCount || !valid.rows[0].valid)
        throw new UnauthorizedException('请重新登录');
      if (!await verifyPassword(current, account.password_hash) || next === current) {
        await client.query("INSERT INTO audit_events(event,account_id) VALUES('password_rejected',$1)", [account.id]);
        return false;
      }
      const hash = await hashPassword(next);
      await client.query('UPDATE accounts SET password_hash=$1,must_change=false,temporary_expires_at=NULL WHERE id=$2', [hash, account.id]);
      await client.query('DELETE FROM sessions WHERE account_id=$1', [account.id]);
      await client.query("INSERT INTO audit_events(event,account_id) VALUES('password_changed',$1)", [account.id]);
      return true;
    });
    if (!result)
      throw new BadRequestException('当前密码错误，或新密码与当前密码相同');
  }

  async logout(token: string): Promise<void> {
    await transaction(this.pool, async client => {
      const deleted = await client.query('DELETE FROM sessions WHERE token_hash=$1 RETURNING account_id', [digest(token)]);
      if (deleted.rowCount)
        await client.query("INSERT INTO audit_events(event,account_id) VALUES('logout',$1)", [deleted.rows[0].account_id]);
    });
  }
}
