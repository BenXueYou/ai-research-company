import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { transaction } from '../database.js';
import { digest } from '../identity/identity.js';
export class DeferredUMailAdapter {
    async inspectResource(input) {
        return {
            ...input,
            resourceStatus: 'not_live_verified',
            detail: '资源已保存；供应商企业隔离能力待 T32 正式联调',
            checkedAt: new Date()
        };
    }
    async inspectChannel(input) {
        return {
            ...input,
            domainStatus: 'not_live_verified',
            accountStatus: 'not_live_verified',
            detail: '域名、发信账号与回复实收待 T32 正式联调',
            dnsRecords: [],
            checkedAt: new Date()
        };
    }
}
function text(value, maximum, message) {
    if (typeof value !== 'string' || !value || value !== value.trim() || value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value))
        throw new BadRequestException(message);
    return value;
}
function uuid(value, message) {
    const result = text(value, 36, message);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result))
        throw new BadRequestException(message);
    return result;
}
function email(value, message) {
    const result = text(value, 254, message);
    if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(result))
        throw new BadRequestException(message);
    return result;
}
function domain(value) {
    const result = text(value, 253, '请填写有效的发信域名');
    if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(result))
        throw new BadRequestException('请填写有效的发信域名');
    return result;
}
function exact(input, allowed, message) {
    if (!input || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
        throw new BadRequestException(message);
}
function hash(value) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
function validInspection(detail, checkedAt) {
    return typeof detail === 'string' && detail.length > 0 && detail.length <= 300 && checkedAt instanceof Date && Number.isFinite(checkedAt.getTime());
}
function validDns(value) {
    return Array.isArray(value) && value.length <= 20 && value.every(record => record && typeof record.type === 'string' && record.type.length <= 20 &&
        typeof record.name === 'string' && record.name.length <= 253 &&
        typeof record.value === 'string' && record.value.length <= 1000);
}
function serialize(row) {
    if (!row)
        return null;
    return {
        id: row.id,
        domain: row.umail_domain,
        senderAddress: row.umail_sender_address,
        replyAddress: row.reply_to,
        defaultChannel: row.default_flag,
        verificationState: row.verification_state,
        verificationDetail: row.verification_detail,
        domainStatus: row.umail_domain_status,
        accountStatus: row.umail_account_status,
        dnsRecords: row.umail_dns_records,
        checkedAt: row.verified_at,
        updatedAt: row.updated_at
    };
}
function overall(resource, domainState, account) {
    if (resource === 'unavailable' || domainState === 'failed' || account === 'unavailable')
        return 'unavailable';
    if (resource === 'available' && domainState === 'verified' && account === 'available')
        return 'available';
    return 'not_live_verified';
}
export class UMailService {
    pool;
    adapter;
    constructor(pool, adapter) {
        this.pool = pool;
        this.adapter = adapter;
    }
    async listResources(identity) {
        if (identity.role !== 'platform')
            throw new ForbiddenException('仅平台可配置 U-Mail 企业资源');
        const result = await this.pool.query(`SELECT o.id AS "organizationId",o.name,
      r.resource_status AS "resourceStatus",r.verification_detail AS "verificationDetail",
      r.checked_at AS "checkedAt",c.verification_state AS "channelStatus"
      FROM organizations o LEFT JOIN umail_resources r ON r.organization_id=o.id
      LEFT JOIN team_sending_channels c ON c.organization_id=o.id AND c.kind='UMAIL'
      WHERE o.kind='terminal' AND o.active ORDER BY o.name,o.id`);
        return { organizations: result.rows, phaseOneBilling: 'platform' };
    }
    async configureResource(identity, token, input) {
        if (identity.role !== 'platform')
            throw new ForbiddenException('仅平台可配置 U-Mail 企业资源');
        exact(input, ['organizationId', 'resourceId', 'requestId'], '资源配置字段无效');
        const organizationId = uuid(input.organizationId, '目标企业标识无效');
        const resourceId = text(input.resourceId, 200, '请填写 U-Mail 隔离资源标识');
        const requestId = uuid(input.requestId, '请求标识无效');
        const inputHash = hash({ organizationId, resourceId });
        const replay = await this.resourceReplay(identity.id, requestId, inputHash);
        if (replay)
            return replay;
        const target = await this.pool.query("SELECT 1 FROM organizations WHERE id=$1 AND kind='terminal' AND active", [organizationId]);
        if (!target.rowCount)
            throw new BadRequestException('仅可为有效终端企业配置资源');
        let inspected;
        try {
            inspected = await this.adapter.inspectResource({ organizationId, resourceId });
        }
        catch {
            throw new ServiceUnavailableException('U-Mail 受控适配器未能完成资源核验，未保存设置');
        }
        if (inspected.organizationId !== organizationId || inspected.resourceId !== resourceId)
            throw new ConflictException('供应商资源归属与所选企业不一致');
        if (!['available', 'unavailable', 'not_live_verified'].includes(inspected.resourceStatus) || !validInspection(inspected.detail, inspected.checkedAt))
            throw new ServiceUnavailableException('U-Mail 返回了无法识别的资源状态');
        return transaction(this.pool, async (client) => {
            await this.authorize(client, identity, token, 'platform');
            const prior = await client.query('SELECT input_fingerprint FROM umail_resource_requests WHERE actor_id=$1 AND request_id=$2', [identity.id, requestId]);
            if (prior.rowCount) {
                if (prior.rows[0].input_fingerprint !== inputHash)
                    throw new ConflictException('请求标识已用于不同的 U-Mail 资源设置');
                return this.resourceResult(client, organizationId);
            }
            const locked = await client.query("SELECT 1 FROM organizations WHERE id=$1 AND kind='terminal' AND active FOR UPDATE", [organizationId]);
            if (!locked.rowCount)
                throw new BadRequestException('仅可为有效终端企业配置资源');
            try {
                await client.query(`INSERT INTO umail_resources(
          organization_id,external_resource_id,resource_status,verification_detail,checked_at,configured_by
        ) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(organization_id) DO UPDATE SET
          external_resource_id=EXCLUDED.external_resource_id,resource_status=EXCLUDED.resource_status,
          verification_detail=EXCLUDED.verification_detail,checked_at=EXCLUDED.checked_at,
          configured_by=EXCLUDED.configured_by,updated_at=clock_timestamp()`, [
                    organizationId, resourceId, inspected.resourceStatus, inspected.detail, inspected.checkedAt, identity.id
                ]);
            }
            catch (error) {
                if (error.code === '23505')
                    throw new ConflictException('该 U-Mail 资源已分配给其他企业');
                throw error;
            }
            await client.query(`INSERT INTO umail_resource_requests(actor_id,request_id,input_fingerprint,organization_id)
        VALUES($1,$2,$3,$4)`, [identity.id, requestId, inputHash, organizationId]);
            await client.query(`INSERT INTO umail_audit_events(event,actor_id,organization_id,resource_status)
        VALUES('resource_configured',$1,$2,$3)`, [identity.id, organizationId, inspected.resourceStatus]);
            return this.resourceResult(client, organizationId);
        });
    }
    async getChannel(identity) {
        await this.viewer(identity);
        return this.channelResult(this.pool, identity.organization_id);
    }
    async saveChannel(identity, token, input) {
        if (identity.role !== 'admin')
            throw new ForbiddenException('仅企业管理员可维护域名渠道');
        exact(input, ['domain', 'senderAddress', 'replyAddress', 'defaultChannel', 'requestId'], '域名渠道字段无效');
        const submittedDomain = domain(input.domain);
        const senderAddress = email(input.senderAddress, '请填写有效发信地址');
        const replyAddress = email(input.replyAddress, '请填写真实可收信的回复地址');
        const requestId = uuid(input.requestId, '请求标识无效');
        if (typeof input.defaultChannel !== 'boolean')
            throw new BadRequestException('默认渠道选择无效');
        if (senderAddress.slice(senderAddress.lastIndexOf('@') + 1).toLocaleLowerCase('en-US') !== submittedDomain.toLocaleLowerCase('en-US'))
            throw new BadRequestException('发信地址必须属于所配置的域名');
        const inputHash = hash({ domain: submittedDomain, senderAddress, replyAddress, defaultChannel: input.defaultChannel });
        const replay = await this.channelReplay(identity, requestId, inputHash);
        if (replay)
            return replay;
        const resource = await this.pool.query(`SELECT r.external_resource_id,r.resource_status FROM umail_resources r
      JOIN organizations o ON o.id=r.organization_id WHERE r.organization_id=$1 AND o.kind='terminal' AND o.active`, [identity.organization_id]);
        if (!resource.rowCount)
            throw new ConflictException('平台尚未为本企业配置 U-Mail 隔离资源');
        const resourceId = resource.rows[0].external_resource_id;
        let inspected;
        try {
            inspected = await this.adapter.inspectChannel({ organizationId: identity.organization_id, resourceId, domain: submittedDomain, senderAddress });
        }
        catch {
            throw new ServiceUnavailableException('U-Mail 受控适配器未能完成域名渠道核验，未保存设置');
        }
        if (inspected.organizationId !== identity.organization_id || inspected.resourceId !== resourceId || inspected.domain !== submittedDomain || inspected.senderAddress !== senderAddress)
            throw new ConflictException('供应商核验结果与本企业提交的渠道不一致');
        if (!['verified', 'pending', 'failed', 'not_live_verified'].includes(inspected.domainStatus) ||
            !['available', 'unavailable', 'not_live_verified'].includes(inspected.accountStatus) ||
            !validInspection(inspected.detail, inspected.checkedAt) || !validDns(inspected.dnsRecords))
            throw new ServiceUnavailableException('U-Mail 返回了无法识别的渠道状态');
        const status = overall(resource.rows[0].resource_status, inspected.domainStatus, inspected.accountStatus);
        await transaction(this.pool, async (client) => {
            await this.authorize(client, identity, token, 'admin');
            const prior = await client.query('SELECT input_fingerprint FROM umail_channel_requests WHERE actor_id=$1 AND request_id=$2', [identity.id, requestId]);
            if (prior.rowCount) {
                if (prior.rows[0].input_fingerprint !== inputHash)
                    throw new ConflictException('请求标识已用于不同的域名渠道设置');
                return;
            }
            const locked = await client.query(`SELECT r.external_resource_id FROM umail_resources r JOIN organizations o ON o.id=r.organization_id
        WHERE r.organization_id=$1 AND o.kind='terminal' AND o.active FOR UPDATE OF r`, [identity.organization_id]);
            if (!locked.rowCount || locked.rows[0].external_resource_id !== resourceId)
                throw new ConflictException('企业资源已变化，请重新核验后提交');
            if (input.defaultChannel)
                await client.query('UPDATE team_sending_channels SET default_flag=false WHERE organization_id=$1 AND default_flag', [identity.organization_id]);
            const saved = await client.query(`INSERT INTO team_sending_channels(
        id,organization_id,kind,reply_to,verification_state,verification_detail,default_flag,verified_at,updated_by,
        umail_domain,umail_sender_address,umail_domain_status,umail_account_status,umail_dns_records
      ) VALUES($1,$2,'UMAIL',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      ON CONFLICT(organization_id,kind) DO UPDATE SET reply_to=EXCLUDED.reply_to,
        verification_state=EXCLUDED.verification_state,verification_detail=EXCLUDED.verification_detail,
        default_flag=EXCLUDED.default_flag,verified_at=EXCLUDED.verified_at,updated_by=EXCLUDED.updated_by,
        umail_domain=EXCLUDED.umail_domain,umail_sender_address=EXCLUDED.umail_sender_address,
        umail_domain_status=EXCLUDED.umail_domain_status,umail_account_status=EXCLUDED.umail_account_status,
        umail_dns_records=EXCLUDED.umail_dns_records,updated_at=clock_timestamp() RETURNING id`, [
                randomUUID(), identity.organization_id, replyAddress, status, inspected.detail, input.defaultChannel,
                inspected.checkedAt, identity.id, submittedDomain, senderAddress, inspected.domainStatus,
                inspected.accountStatus, JSON.stringify(inspected.dnsRecords)
            ]);
            await client.query(`INSERT INTO umail_channel_requests(actor_id,request_id,input_fingerprint,channel_id)
        VALUES($1,$2,$3,$4)`, [identity.id, requestId, inputHash, saved.rows[0].id]);
            await client.query(`INSERT INTO umail_audit_events(event,actor_id,organization_id,channel_id,domain_status,account_status)
        VALUES('channel_saved',$1,$2,$3,$4,$5)`, [identity.id, identity.organization_id, saved.rows[0].id, inspected.domainStatus, inspected.accountStatus]);
        });
        return this.channelResult(this.pool, identity.organization_id);
    }
    async resourceReplay(actorId, requestId, inputHash) {
        const prior = await this.pool.query('SELECT input_fingerprint,organization_id FROM umail_resource_requests WHERE actor_id=$1 AND request_id=$2', [actorId, requestId]);
        if (!prior.rowCount)
            return null;
        if (prior.rows[0].input_fingerprint !== inputHash)
            throw new ConflictException('请求标识已用于不同的 U-Mail 资源设置');
        return this.resourceResult(this.pool, prior.rows[0].organization_id);
    }
    async channelReplay(identity, requestId, inputHash) {
        const prior = await this.pool.query('SELECT input_fingerprint FROM umail_channel_requests WHERE actor_id=$1 AND request_id=$2', [identity.id, requestId]);
        if (!prior.rowCount)
            return null;
        if (prior.rows[0].input_fingerprint !== inputHash)
            throw new ConflictException('请求标识已用于不同的域名渠道设置');
        return this.channelResult(this.pool, identity.organization_id);
    }
    async resourceResult(queryable, organizationId) {
        const result = await queryable.query(`SELECT organization_id AS "organizationId",resource_status AS "resourceStatus",
      verification_detail AS "verificationDetail",checked_at AS "checkedAt",billing_responsibility AS "billingResponsibility"
      FROM umail_resources WHERE organization_id=$1`, [organizationId]);
        return result.rows[0];
    }
    async channelResult(queryable, organizationId) {
        const resource = await queryable.query(`SELECT resource_status AS "resourceStatus",verification_detail AS "verificationDetail",
      checked_at AS "checkedAt",billing_responsibility AS "billingResponsibility" FROM umail_resources WHERE organization_id=$1`, [organizationId]);
        const channel = await queryable.query(`SELECT id,umail_domain,umail_sender_address,reply_to,default_flag,
      verification_state,verification_detail,umail_domain_status,umail_account_status,umail_dns_records,verified_at,updated_at
      FROM team_sending_channels WHERE organization_id=$1 AND kind='UMAIL'`, [organizationId]);
        return { resource: resource.rows[0] ?? null, channel: serialize(channel.rows[0]), phaseOneBilling: 'platform' };
    }
    async viewer(identity) {
        if (!['admin', 'sales'].includes(identity.role))
            throw new ForbiddenException('仅本企业成员可查看域名渠道');
        const organization = await this.pool.query("SELECT 1 FROM organizations WHERE id=$1 AND kind='terminal' AND active", [identity.organization_id]);
        if (!organization.rowCount)
            throw new ForbiddenException('仅终端企业成员可查看域名渠道');
    }
    async authorize(client, identity, token, role) {
        const actor = await client.query(`SELECT a.role,a.active,a.must_change,o.kind,o.active AS organization_active
      FROM accounts a JOIN organizations o ON o.id=a.organization_id WHERE a.id=$1 FOR UPDATE OF a`, [identity.id]);
        const live = await client.query(`SELECT 1 FROM sessions WHERE token_hash=$1 AND account_id=$2
      AND expires_at>clock_timestamp() AND last_seen_at>clock_timestamp()-interval '30 minutes'`, [digest(token), identity.id]);
        if (!live.rowCount || !actor.rows[0]?.active || !actor.rows[0]?.organization_active)
            throw new UnauthorizedException('请重新登录');
        if (actor.rows[0].must_change)
            throw new ForbiddenException('必须先修改密码');
        if (actor.rows[0].role !== role)
            throw new ForbiddenException(role === 'platform' ? '仅平台可配置 U-Mail 企业资源' : '仅企业管理员可维护域名渠道');
        if (role === 'admin' && actor.rows[0].kind !== 'terminal')
            throw new ForbiddenException('仅终端企业管理员可维护域名渠道');
    }
}
//# sourceMappingURL=umail.js.map