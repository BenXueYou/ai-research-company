import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException
} from '@nestjs/common';
import type pg from 'pg';
import { transaction } from './database.js';
import { digest, type Identity } from './identity.js';

type ResourceStatus = 'active' | 'suspended' | 'unavailable';
type DomainStatus = 'pending' | 'verified' | 'failed';

export interface ResourceInspection {
  organizationId: string;
  resourceId: string;
  resourceStatus: ResourceStatus;
  checkedAt: Date;
}

export interface ChannelInspection {
  organizationId: string;
  resourceId: string;
  domain: string;
  senderAddress: string;
  domainStatus: DomainStatus;
  accountStatus: ResourceStatus;
  dnsRecords: Array<{ type: string; name: string; value: string }>;
  checkedAt: Date;
}

export interface UMailAdapter {
  inspectResource(input: { organizationId: string; resourceId: string }): Promise<ResourceInspection>;
  inspectChannel(input: {
    organizationId: string;
    resourceId: string;
    domain: string;
    senderAddress: string;
  }): Promise<ChannelInspection>;
}

export class UnavailableUMailAdapter implements UMailAdapter {
  async inspectResource(): Promise<ResourceInspection> {
    throw new ServiceUnavailableException('U-Mail 受控适配器未配置，未执行供应商资源核验');
  }

  async inspectChannel(): Promise<ChannelInspection> {
    throw new ServiceUnavailableException('U-Mail 受控适配器未配置，未执行域名或账号核验');
  }
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 254)
    throw new BadRequestException(message);
  return value;
}

function uuid(value: unknown, message: string): string {
  const result = requiredText(value, message);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(result))
    throw new BadRequestException(message);
  return result;
}

function email(value: unknown, message: string): string {
  const result = requiredText(value, message);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(result))
    throw new BadRequestException(message);
  return result;
}

function domain(value: unknown): string {
  const result = requiredText(value, '请填写有效的发信域名');
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(result))
    throw new BadRequestException('请填写有效的发信域名');
  return result;
}

function assertExactKeys(input: Record<string, unknown>, allowed: string[], message: string): void {
  if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
    throw new BadRequestException(message);
}

export class UMailService {
  constructor(private readonly pool: pg.Pool, private readonly adapter: UMailAdapter) {}

  async listResources(identity: Identity) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台可配置 U-Mail 企业资源');
    const result = await this.pool.query(`SELECT o.id AS "organizationId",o.name,
      r.resource_status AS "resourceStatus",r.checked_at AS "checkedAt",
      r.billing_responsibility AS "billingResponsibility",
      c.domain_status AS "domainStatus",c.account_status AS "accountStatus"
      FROM organizations o LEFT JOIN umail_resources r ON r.organization_id=o.id
      LEFT JOIN umail_channels c ON c.organization_id=o.id
      WHERE o.kind='terminal' AND o.active ORDER BY o.name,o.id`);
    return { organizations: result.rows, phaseOneBilling: 'platform' };
  }

  async configureResource(identity: Identity, token: string, input: Record<string, unknown>) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台可配置 U-Mail 企业资源');
    assertExactKeys(input, ['organizationId', 'resourceId'], '资源配置字段无效');
    const organizationId = uuid(input.organizationId, '目标企业标识无效');
    const resourceId = requiredText(input.resourceId, '请填写 U-Mail 隔离资源标识');
    const target = await this.pool.query("SELECT 1 FROM organizations WHERE id=$1 AND kind='terminal' AND active", [organizationId]);
    if (!target.rowCount) throw new BadRequestException('仅可为有效终端企业配置资源');
    const inspected = await this.adapter.inspectResource({ organizationId, resourceId });
    if (inspected.organizationId !== organizationId || inspected.resourceId !== resourceId)
      throw new ConflictException('供应商资源归属与所选企业不一致');
    if (!['active', 'suspended', 'unavailable'].includes(inspected.resourceStatus) || !Number.isFinite(inspected.checkedAt.getTime()))
      throw new ServiceUnavailableException('U-Mail 返回了无法识别的资源状态');
    return transaction(this.pool, async client => {
      await this.authorizeMutation(client, identity, token, 'platform');
      const lockedTarget = await client.query("SELECT 1 FROM organizations WHERE id=$1 AND kind='terminal' AND active FOR UPDATE", [organizationId]);
      if (!lockedTarget.rowCount) throw new BadRequestException('仅可为有效终端企业配置资源');
      try {
        await client.query(`INSERT INTO umail_resources(
          organization_id,external_resource_id,resource_status,checked_at,configured_by
        ) VALUES($1,$2,$3,$4,$5) ON CONFLICT(organization_id) DO UPDATE SET
          external_resource_id=EXCLUDED.external_resource_id,resource_status=EXCLUDED.resource_status,
          checked_at=EXCLUDED.checked_at,configured_by=EXCLUDED.configured_by,updated_at=clock_timestamp()`,
        [organizationId, resourceId, inspected.resourceStatus, inspected.checkedAt, identity.id]);
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new ConflictException('该 U-Mail 资源已分配给其他企业');
        throw error;
      }
      await client.query(`INSERT INTO umail_audit_events(event,actor_id,organization_id,resource_status)
        VALUES('resource_configured',$1,$2,$3)`, [identity.id, organizationId, inspected.resourceStatus]);
      return {
        organizationId,
        resourceStatus: inspected.resourceStatus,
        checkedAt: inspected.checkedAt,
        billingResponsibility: 'platform_phase_one'
      };
    });
  }

  async getChannel(identity: Identity) {
    this.assertEnterpriseViewer(identity);
    const result = await this.pool.query(`SELECT r.resource_status AS "resourceStatus",
      r.checked_at AS "resourceCheckedAt",r.billing_responsibility AS "billingResponsibility",
      c.domain,c.sender_address AS "senderAddress",c.reply_address AS "replyAddress",
      c.is_default AS "isDefault",c.domain_status AS "domainStatus",
      c.account_status AS "accountStatus",c.dns_records AS "dnsRecords",c.checked_at AS "checkedAt"
      FROM umail_resources r LEFT JOIN umail_channels c ON c.organization_id=r.organization_id
      WHERE r.organization_id=$1`, [identity.organization_id]);
    if (!result.rowCount) return { resource: null, channel: null, phaseOneBilling: 'platform' };
    const row = result.rows[0];
    return {
      resource: {
        status: row.resourceStatus,
        checkedAt: row.resourceCheckedAt,
        billingResponsibility: row.billingResponsibility
      },
      channel: row.domain ? {
        domain: row.domain,
        senderAddress: row.senderAddress,
        replyAddress: row.replyAddress,
        isDefault: row.isDefault,
        domainStatus: row.domainStatus,
        accountStatus: row.accountStatus,
        dnsRecords: row.dnsRecords,
        checkedAt: row.checkedAt,
        available: row.resourceStatus === 'active' && row.domainStatus === 'verified' && row.accountStatus === 'active'
      } : null,
      phaseOneBilling: 'platform'
    };
  }

  async saveChannel(identity: Identity, token: string, input: Record<string, unknown>) {
    if (identity.role !== 'admin') throw new ForbiddenException('仅企业管理员可维护域名渠道');
    assertExactKeys(input, ['domain', 'senderAddress', 'replyAddress', 'isDefault'], '域名渠道字段无效');
    const submittedDomain = domain(input.domain);
    const senderAddress = email(input.senderAddress, '请填写有效发信地址');
    const replyAddress = email(input.replyAddress, '请填写真实可收信的回复地址');
    if (typeof input.isDefault !== 'boolean') throw new BadRequestException('默认渠道选择无效');
    const senderDomain = senderAddress.slice(senderAddress.lastIndexOf('@') + 1);
    if (senderDomain.toLocaleLowerCase('en-US') !== submittedDomain.toLocaleLowerCase('en-US'))
      throw new BadRequestException('发信地址必须属于所配置的域名');
    const resource = await this.pool.query(`SELECT r.external_resource_id FROM umail_resources r
      JOIN organizations o ON o.id=r.organization_id
      WHERE r.organization_id=$1 AND o.kind='terminal' AND o.active`, [identity.organization_id]);
    if (!resource.rowCount) throw new ConflictException('平台尚未为本企业配置 U-Mail 隔离资源');
    const resourceId = resource.rows[0].external_resource_id as string;
    const inspected = await this.adapter.inspectChannel({
      organizationId: identity.organization_id,
      resourceId,
      domain: submittedDomain,
      senderAddress
    });
    if (
      inspected.organizationId !== identity.organization_id ||
      inspected.resourceId !== resourceId ||
      inspected.domain !== submittedDomain ||
      inspected.senderAddress !== senderAddress
    ) throw new ConflictException('供应商核验结果与本企业提交的渠道不一致');
    if (
      !['pending', 'verified', 'failed'].includes(inspected.domainStatus) ||
      !['active', 'suspended', 'unavailable'].includes(inspected.accountStatus) ||
      !Number.isFinite(inspected.checkedAt.getTime()) ||
      !Array.isArray(inspected.dnsRecords)
    ) throw new ServiceUnavailableException('U-Mail 返回了无法识别的渠道状态');
    return transaction(this.pool, async client => {
      await this.authorizeMutation(client, identity, token, 'admin');
      const locked = await client.query(`SELECT r.external_resource_id FROM umail_resources r
        JOIN organizations o ON o.id=r.organization_id
        WHERE r.organization_id=$1 AND o.kind='terminal' AND o.active FOR UPDATE OF r`, [identity.organization_id]);
      if (!locked.rowCount || locked.rows[0].external_resource_id !== resourceId)
        throw new ConflictException('企业资源已变化，请重新核验后提交');
      await client.query(`INSERT INTO umail_channels(
        organization_id,domain,sender_address,reply_address,is_default,domain_status,
        account_status,dns_records,checked_at,updated_by
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(organization_id) DO UPDATE SET
        domain=EXCLUDED.domain,sender_address=EXCLUDED.sender_address,
        reply_address=EXCLUDED.reply_address,is_default=EXCLUDED.is_default,
        domain_status=EXCLUDED.domain_status,account_status=EXCLUDED.account_status,
        dns_records=EXCLUDED.dns_records,checked_at=EXCLUDED.checked_at,
        updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()`, [
        identity.organization_id,
        submittedDomain,
        senderAddress,
        replyAddress,
        input.isDefault,
        inspected.domainStatus,
        inspected.accountStatus,
        JSON.stringify(inspected.dnsRecords),
        inspected.checkedAt,
        identity.id
      ]);
      await client.query(`INSERT INTO umail_audit_events(
        event,actor_id,organization_id,domain_status,account_status
      ) VALUES('channel_saved',$1,$2,$3,$4)`, [
        identity.id,
        identity.organization_id,
        inspected.domainStatus,
        inspected.accountStatus
      ]);
      return this.getChannel(identity);
    });
  }

  private assertEnterpriseViewer(identity: Identity): void {
    if (!['admin', 'sales'].includes(identity.role))
      throw new ForbiddenException('仅本企业成员可查看域名渠道');
  }

  private async authorizeMutation(
    client: pg.PoolClient,
    identity: Identity,
    token: string,
    requiredRole: 'platform' | 'admin'
  ): Promise<void> {
    const actor = await client.query(`SELECT a.role,a.active,a.must_change,o.kind,o.active AS organization_active
      FROM accounts a JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1 FOR UPDATE OF a`, [identity.id]);
    const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
    if (!live.rowCount || !actor.rows[0]?.active || !actor.rows[0]?.organization_active)
      throw new UnauthorizedException('请重新登录');
    if (actor.rows[0].must_change) throw new ForbiddenException('必须先修改密码');
    if (actor.rows[0].role !== requiredRole)
      throw new ForbiddenException(requiredRole === 'platform' ? '仅平台可配置 U-Mail 企业资源' : '仅企业管理员可维护域名渠道');
    if (requiredRole === 'admin' && actor.rows[0].kind !== 'terminal')
      throw new ForbiddenException('仅终端企业管理员可维护域名渠道');
  }
}
