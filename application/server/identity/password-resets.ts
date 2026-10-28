import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from '../database.js';
import { digest, type Identity } from './identity.js';
import { hashPassword, temporaryPassword } from './policy.js';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export class PasswordResetService {
  constructor(private readonly pool: pg.Pool) {}

  async reset(identity: Identity, token: string, input: Record<string, unknown>) {
    try {
      if (!input || Array.isArray(input) || Object.keys(input).some(key => !['accountId', 'requestId'].includes(key)) || !uuid(input.accountId) || !uuid(input.requestId))
        throw new BadRequestException('重置目标或请求标识无效');
      return await transaction(this.pool, async client => {
        await client.query('SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[identity.id, input.accountId]]);
        const actor = (await client.query('SELECT * FROM accounts WHERE id=$1', [identity.id])).rows[0];
        const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
          AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
        if (!actor?.active || !live.rowCount) throw new UnauthorizedException('请重新登录');
        if (actor.must_change) throw new ForbiddenException('必须先修改密码');
        const actorOrg = (await client.query('SELECT * FROM organizations WHERE id=$1 FOR SHARE', [actor.organization_id])).rows[0];
        if (!actorOrg?.active) throw new UnauthorizedException('请重新登录');
        if ((await client.query('SELECT 1 FROM password_reset_requests WHERE actor_id=$1 AND request_id=$2', [actor.id, input.requestId])).rowCount)
          throw new ConflictException('本次重置已完成；不会重复生成或回显密码');
        const target = (await client.query(`SELECT a.id,a.email,a.role,a.organization_id,o.kind,o.parent_id,o.active AS organization_active,
          EXISTS(SELECT 1 FROM organization_openings x WHERE x.account_id=a.id AND x.organization_id=o.id) AS opening_account
          FROM accounts a JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1`, [input.accountId])).rows[0];
        const member = actor.role === 'admin' && actorOrg.kind === 'terminal' && target?.organization_id === actor.organization_id && target.id !== actor.id && ['admin', 'sales'].includes(target.role);
        const child = ['platform', 'distributor'].includes(actor.role) && actor.role === actorOrg.kind && target?.parent_id === actor.organization_id && target.opening_account &&
          ((target.kind === 'terminal' && target.role === 'admin') || (target.kind === 'distributor' && target.role === 'distributor'));
        if (!target || !target.organization_active || !(member || child)) throw new ForbiddenException('无权重置该账号');
        const password = temporaryPassword();
        const hash = await hashPassword(password);
        const updated = await client.query(`UPDATE accounts SET password_hash=$1,must_change=true,
          temporary_expires_at=clock_timestamp()+interval '72 hours' WHERE id=$2 RETURNING temporary_expires_at`, [hash, target.id]);
        await client.query('DELETE FROM sessions WHERE account_id=$1', [target.id]);
        await client.query('INSERT INTO password_reset_requests(actor_id,request_id,target_account_id) VALUES($1,$2,$3)', [actor.id, input.requestId, target.id]);
        await client.query(`INSERT INTO password_reset_audit(actor_id,target_account_id,result)
          VALUES($1,$2,'success')`, [actor.id, target.id]);
        return { accountId: target.id, email: target.email, temporaryPassword: password, expiresAt: updated.rows[0].temporary_expires_at };
      });
    } catch (error) {
      const targetId = input && !Array.isArray(input) && uuid(input.accountId) ? input.accountId : null;
      await this.pool.query(`INSERT INTO password_reset_audit(actor_id,target_account_id,result)
        VALUES($1,(SELECT id FROM accounts WHERE id=$2::uuid),'rejected')`, [identity.id, targetId]);
      throw error;
    }
  }
}
