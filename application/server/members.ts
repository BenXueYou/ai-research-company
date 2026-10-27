import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from './database.js';
import { digest, type Identity } from './identity.js';
import { hashPassword, normalizeEmail, temporaryPassword } from './policy.js';

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export class MemberService {
  constructor(private readonly pool: pg.Pool) {}

  private async authorize(client: pg.PoolClient, identity: Identity, token: string) {
    const actor = (await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [identity.id])).rows[0];
    const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
    if (!actor?.active || !live.rowCount) throw new UnauthorizedException('请重新登录');
    const org = (await client.query('SELECT * FROM organizations WHERE id=$1 FOR SHARE', [actor.organization_id])).rows[0];
    if (!org?.active) throw new UnauthorizedException('请重新登录');
    if (actor.must_change || actor.role !== 'admin' || org.kind !== 'terminal')
      throw new ForbiddenException('仅本企业管理员可管理成员');
    return actor;
  }

  async list(identity: Identity, token: string) {
    return transaction(this.pool, async client => {
      const actor = await this.authorize(client, identity, token);
      const members = await client.query(`SELECT a.id,a.name,a.email,a.role,a.active,
        EXISTS(SELECT 1 FROM organization_openings x WHERE x.account_id=a.id) AS "firstAdministrator"
        FROM accounts a WHERE a.organization_id=$1 ORDER BY a.created_at,a.id`, [actor.organization_id]);
      return { allowedRoles: ['sales', 'admin'], members: members.rows.map(member => ({ ...member, canDisable: member.active && member.id !== actor.id && !member.firstAdministrator })) };
    });
  }

  async create(identity: Identity, token: string, input: Record<string, unknown>) {
    try {
      if (Array.isArray(input) || Object.keys(input).some(key => !['name', 'email', 'role', 'requestId'].includes(key)))
        throw new BadRequestException('成员字段无效；组织及密码由服务端确定');
      if (typeof input.name !== 'string' || !input.name.trim() || !['sales', 'admin'].includes(String(input.role)) || !uuid(input.requestId))
        throw new BadRequestException('姓名、角色及请求标识无效');
      let email: string;
      try { email = normalizeEmail(input.email); } catch { throw new BadRequestException('请填写有效登录邮箱'); }
      return await transaction(this.pool, async client => {
        const actor = await this.authorize(client, identity, token);
        if ((await client.query('SELECT 1 FROM member_creations WHERE actor_id=$1 AND request_id=$2', [actor.id, input.requestId])).rowCount)
          throw new ConflictException('本次创建已完成，请查看成员列表；不会重复创建或回显密码');
        const id = randomUUID();
        const password = temporaryPassword();
        const created = await client.query(`INSERT INTO accounts(id,organization_id,name,email,role,password_hash,must_change,temporary_expires_at)
          VALUES($1,$2,$3,$4,$5,$6,true,clock_timestamp()+interval '72 hours') RETURNING temporary_expires_at`,
        [id, actor.organization_id, input.name, email, input.role, await hashPassword(password)]);
        await client.query('INSERT INTO member_creations(actor_id,request_id,account_id) VALUES($1,$2,$3)', [actor.id, input.requestId, id]);
        await client.query(`INSERT INTO member_audit(actor_id,target_organization_id,target_account_id,action,result)
          VALUES($1,$2,$3,'create','success')`, [actor.id, actor.organization_id, id]);
        return { accountId: id, organizationId: actor.organization_id, email, temporaryPassword: password, expiresAt: created.rows[0].temporary_expires_at };
      });
    } catch (error) {
      await this.pool.query("INSERT INTO member_audit(actor_id,action,result) VALUES($1,'create','rejected')", [identity.id]);
      if ((error as { code?: string }).code === '23505') throw new ConflictException('邮箱已占用，请使用其他登录邮箱');
      throw error;
    }
  }

  async disable(identity: Identity, token: string, input: Record<string, unknown>) {
    try {
      if (Array.isArray(input) || Object.keys(input).some(key => key !== 'accountId') || !uuid(input.accountId))
        throw new BadRequestException('停用目标无效');
      return await transaction(this.pool, async client => {
        // Stable ordering prevents two administrators disabling each other from deadlocking.
        await client.query('SELECT id FROM accounts WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[identity.id, input.accountId]]);
        const actor = await this.authorize(client, identity, token);
        const target = (await client.query(`SELECT a.id FROM accounts a WHERE a.id=$1 AND a.organization_id=$2
          AND a.role IN ('admin','sales') AND a.id<>$3
          AND NOT EXISTS(SELECT 1 FROM organization_openings x WHERE x.account_id=a.id)`, [input.accountId, actor.organization_id, actor.id])).rows[0];
        if (!target) throw new ForbiddenException('无权停用该成员');
        await client.query('UPDATE accounts SET active=false WHERE id=$1', [target.id]);
        await client.query('DELETE FROM sessions WHERE account_id=$1', [target.id]);
        await client.query(`INSERT INTO member_audit(actor_id,target_organization_id,target_account_id,action,result)
          VALUES($1,$2,$3,'disable','success')`, [actor.id, actor.organization_id, target.id]);
        return { ok: true };
      });
    } catch (error) {
      await this.pool.query("INSERT INTO member_audit(actor_id,action,result) VALUES($1,'disable','rejected')", [identity.id]);
      throw error;
    }
  }
}
