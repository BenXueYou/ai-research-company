import { createCipheriv, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type pg from 'pg';
import { transaction } from './database.js';
import { digest, type Identity } from './identity.js';
import { hashPassword, normalizeEmail, temporaryPassword } from './policy.js';

export function contactKey(): Buffer {
  const value = process.env.ORG_CONTACT_KEY;
  if (!value || !/^[a-f0-9]{64}$/i.test(value))
    throw new Error('必须配置独立的32字节 ORG_CONTACT_KEY（64位十六进制），并安全备份');
  return Buffer.from(value, 'hex');
}
export async function bindContactKey(pool: pg.Pool, key: Buffer): Promise<void> {
  const fingerprint = createHmac('sha256', key).update('organization-contact-key-v1').digest('hex');
  await pool.query("INSERT INTO application_keys(purpose,fingerprint) VALUES('organization-contact',$1) ON CONFLICT DO NOTHING", [fingerprint]);
  const stored = await pool.query("SELECT fingerprint FROM application_keys WHERE purpose='organization-contact'");
  if (stored.rows[0].fingerprint !== fingerprint)
    throw new Error('ORG_CONTACT_KEY 与数据库不匹配；恢复原密钥，不得直接换钥绕过电话唯一性');
}
function permittedKinds(actor: { role: string; kind: string; distributor_level: number }): string[] {
  if (actor.role === 'platform' && actor.kind === 'platform') return ['terminal', 'distributor'];
  if (actor.role === 'distributor' && actor.kind === 'distributor')
    return actor.distributor_level === 1 ? ['terminal', 'distributor'] : ['terminal'];
  return [];
}
export class OrganizationService {
  constructor(private readonly pool: pg.Pool, private readonly key: Buffer) {}

  async list(identity: Identity) {
    const actor = (await this.pool.query(`SELECT a.role,o.kind,o.distributor_level,o.name FROM accounts a
      JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1 AND a.active AND o.active`, [identity.id])).rows[0];
    if (!actor || !permittedKinds(actor).length) throw new ForbiddenException('无直属开户权限');
    const children = await this.pool.query(`SELECT o.id,o.name,o.kind,o.distributor_level AS "distributorLevel",
      o.parent_id AS "parentId",o.active,o.phone_masked AS "phoneMasked",a.email,a.id AS "accountId"
      FROM organizations o JOIN organization_openings x ON x.organization_id=o.id
      JOIN accounts a ON a.id=x.account_id WHERE o.parent_id=$1 ORDER BY a.created_at,o.id`, [identity.organization_id]);
    return { parentName: actor.name, allowedKinds: permittedKinds(actor), children: children.rows };
  }

  async open(identity: Identity, token: string, input: Record<string, unknown>) {
    try {
      return await this.create(identity, token, input);
    } catch (error) {
      await this.pool.query("INSERT INTO opening_audit(actor_id,result) VALUES($1,'rejected')", [identity.id]);
      if ((error as { code?: string }).code === '23505') {
        const constraint = (error as { constraint?: string }).constraint;
        if (constraint === 'accounts_email_key') throw new ConflictException('邮箱已占用，请使用其他登录邮箱');
        if (constraint === 'organizations_phone_key_key') throw new ConflictException('电话号码已被其他组织使用');
        throw new ConflictException('本次开户已完成，请查看直属下级；不会再次创建或回显密码');
      }
      throw error;
    }
  }

  private async create(identity: Identity, token: string, input: Record<string, unknown>) {
    const allowed = ['name', 'kind', 'countryCode', 'phone', 'email', 'requestId'];
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
      throw new BadRequestException('开户字段无效；上级、角色及密码由服务端确定');
    const { name, kind, countryCode, phone, requestId } = input;
    if (typeof name !== 'string' || !name.trim() || !['terminal', 'distributor'].includes(String(kind)))
      throw new BadRequestException('请填写组织名称并选择组织类型');
    if (typeof countryCode !== 'string' || !/^\+[1-9][0-9]{0,2}$/.test(countryCode))
      throw new BadRequestException('请填写有效国家区号，例如 +86');
    if (typeof phone !== 'string' || !phone || /\s/u.test(phone))
      throw new BadRequestException('电话号码必填且不能包含空格');
    if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))
      throw new BadRequestException('开户请求标识无效');
    let email: string;
    try { email = normalizeEmail(input.email); } catch { throw new BadRequestException('请填写有效管理员邮箱'); }
    return transaction(this.pool, async client => {
      // Serialize with password changes and recheck the live session after acquiring the account lock.
      const actor = (await client.query('SELECT * FROM accounts WHERE id=$1 FOR UPDATE', [identity.id])).rows[0];
      const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
        AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
      if (!live.rowCount || !actor.active) throw new UnauthorizedException('请重新登录');
      if (actor.must_change) throw new ForbiddenException('必须先修改密码');
      const parent = (await client.query('SELECT * FROM organizations WHERE id=$1 FOR SHARE', [actor.organization_id])).rows[0];
      if (!parent.active || !permittedKinds({ ...parent, role: actor.role }).includes(String(kind)))
        throw new ForbiddenException('无权创建此类型或层级的直属组织');
      const previous = await client.query('SELECT 1 FROM organization_openings WHERE actor_id=$1 AND request_id=$2', [actor.id, requestId]);
      if (previous.rowCount) throw new ConflictException('本次开户已完成，请查看直属下级；不会再次创建或回显密码');
      const organizationId = randomUUID();
      const accountId = randomUUID();
      const password = temporaryPassword();
      const hash = await hashPassword(password);
      // Preserve both submitted components exactly: no stripping, trunk-prefix or alias conversion.
      const contact = JSON.stringify([countryCode, phone]);
      const phoneKey = createHmac('sha256', this.key).update('phone-index\0' + contact).digest('hex');
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', this.key, iv);
      cipher.setAAD(Buffer.from(organizationId));
      const ciphertext = Buffer.concat([cipher.update(contact, 'utf8'), cipher.final()]);
      const encrypted = [iv, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
      const masked = `${countryCode} ****${[...phone].length > 4 ? [...phone].slice(-4).join('') : ''}`;
      const level = kind === 'distributor' ? parent.distributor_level + 1 : 0;
      await client.query(`INSERT INTO organizations(id,name,kind,parent_id,distributor_level,active,phone_encrypted,phone_key,phone_masked)
        VALUES($1,$2,$3,$4,$5,true,$6,$7,$8)`, [organizationId, name, kind, parent.id, level, encrypted, phoneKey, masked]);
      const account = await client.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,active,must_change,temporary_expires_at)
        VALUES($1,$2,$3,$4,$5,true,true,clock_timestamp()+interval '72 hours') RETURNING temporary_expires_at`,
      [accountId, organizationId, email, hash, kind === 'terminal' ? 'admin' : 'distributor']);
      await client.query('INSERT INTO organization_openings(actor_id,request_id,organization_id,account_id) VALUES($1,$2,$3,$4)',
        [actor.id, requestId, organizationId, accountId]);
      await client.query("INSERT INTO opening_audit(actor_id,target_organization_id,target_account_id,result) VALUES($1,$2,$3,'created')",
        [actor.id, organizationId, accountId]);
      return { organizationId, accountId, email, temporaryPassword: password, expiresAt: account.rows[0].temporary_expires_at };
    });
  }
}
