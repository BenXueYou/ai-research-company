import { createCipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { transaction } from '../database.js';
export class DeferredDomesticSmtpAdapter {
    async verify() {
        return {
            state: 'not_live_verified',
            detail: '设置已保存；真实连接、DNS与回复实收待正式联调'
        };
    }
}
function validEmail(value) {
    return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(value);
}
function validText(value, maximum) {
    return typeof value === 'string' && value.length > 0 && value.length <= maximum && !/[\u0000-\u001f\u007f]/u.test(value);
}
function uuid(value) {
    return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value);
}
function serialize(row) {
    if (!row)
        return { channel: null };
    return {
        channel: {
            id: row.id,
            kind: 'SMTP',
            host: row.smtp_host,
            port: row.smtp_port,
            security: row.smtp_security,
            username: row.smtp_username,
            replyTo: row.reply_to,
            verificationState: row.verification_state,
            verificationDetail: row.verification_detail,
            defaultChannel: row.default_flag,
            verifiedAt: row.verified_at,
            updatedAt: row.updated_at,
            credentialConfigured: true
        }
    };
}
export function smtpCredentialKey() {
    const source = process.env.SMTP_CREDENTIAL_KEY ?? '';
    if (!/^[a-f0-9]{64}$/iu.test(source))
        throw new Error('必须设置独立的32字节 SMTP_CREDENTIAL_KEY（64位十六进制）');
    return Buffer.from(source, 'hex');
}
export async function bindSmtpCredentialKey(pool, key) {
    const fingerprint = createHash('sha256').update(key).digest('hex');
    const result = await pool.query(`INSERT INTO application_keys(purpose,fingerprint) VALUES('smtp-credential',$1)
    ON CONFLICT(purpose) DO UPDATE SET fingerprint=application_keys.fingerprint RETURNING fingerprint`, [fingerprint]);
    if (result.rows[0].fingerprint !== fingerprint)
        throw new Error('SMTP_CREDENTIAL_KEY 与数据库不匹配');
}
function encryptCredential(key, organizationId, credential) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(`${organizationId}:SMTP`));
    const encrypted = Buffer.concat([cipher.update(credential, 'utf8'), cipher.final()]);
    return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}
export class SmtpChannelService {
    pool;
    key;
    adapter;
    constructor(pool, key, adapter) {
        this.pool = pool;
        this.key = key;
        this.adapter = adapter;
    }
    async authorize(actor, maintain) {
        const result = await this.pool.query('SELECT kind FROM organizations WHERE id=$1 AND active', [actor.organization_id]);
        const allowedRole = maintain ? actor.role === 'admin' : ['admin', 'sales'].includes(actor.role);
        if (result.rows[0]?.kind !== 'terminal' || !allowedRole)
            throw new ForbiddenException(maintain ? '仅本企业管理员可维护团队发信设置' : '无权查看团队发信设置');
    }
    async get(actor) {
        await this.authorize(actor, false);
        const result = await this.pool.query(`SELECT id,smtp_host,smtp_port,smtp_security,smtp_username,reply_to,
      verification_state,verification_detail,default_flag,verified_at,updated_at
      FROM team_sending_channels WHERE organization_id=$1 AND kind='SMTP'`, [actor.organization_id]);
        return serialize(result.rows[0]);
    }
    async configure(actor, input) {
        await this.authorize(actor, true);
        const allowed = ['host', 'port', 'security', 'username', 'credential', 'replyTo', 'defaultChannel', 'requestId'];
        if (Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key)))
            throw new BadRequestException('团队发信设置字段无效');
        const port = typeof input.port === 'string' && /^\d+$/u.test(input.port) ? Number(input.port) : input.port;
        if (!validText(input.host, 253) || /\s/u.test(input.host) || !Number.isInteger(port) || Number(port) < 1 || Number(port) > 65535)
            throw new BadRequestException('SMTP服务地址或端口无效');
        if (!['tls', 'starttls'].includes(String(input.security)) || !validText(input.username, 320))
            throw new BadRequestException('SMTP加密方式或账号无效');
        if (!validText(input.credential, 2048) || !validEmail(input.replyTo))
            throw new BadRequestException('SMTP授权凭据或回复邮箱无效');
        if (typeof input.defaultChannel !== 'boolean' || !uuid(input.requestId))
            throw new BadRequestException('默认渠道或请求标识无效');
        const settings = {
            host: input.host,
            port: Number(port),
            security: input.security,
            username: input.username,
            credential: input.credential,
            replyTo: input.replyTo
        };
        const fingerprint = createHmac('sha256', this.key).update(JSON.stringify({
            ...settings,
            defaultChannel: input.defaultChannel
        })).digest('hex');
        const previous = await this.pool.query(`SELECT input_fingerprint,channel_id FROM smtp_configuration_requests
      WHERE actor_id=$1 AND request_id=$2`, [actor.id, input.requestId]);
        if (previous.rowCount) {
            if (previous.rows[0].input_fingerprint !== fingerprint)
                throw new ConflictException('请求标识已用于不同的团队发信设置');
            const existing = await this.pool.query(`SELECT id,smtp_host,smtp_port,smtp_security,smtp_username,reply_to,
        verification_state,verification_detail,default_flag,verified_at,updated_at
        FROM team_sending_channels WHERE id=$1 AND organization_id=$2`, [previous.rows[0].channel_id, actor.organization_id]);
            return serialize(existing.rows[0]);
        }
        let verification;
        try {
            verification = await this.adapter.verify(settings);
        }
        catch {
            verification = { state: 'unavailable', detail: '受控适配器未能完成可用性验证' };
        }
        if (!['available', 'unavailable', 'not_live_verified'].includes(verification.state) ||
            !validText(verification.detail, 300))
            throw new Error('SMTP适配器返回了无效验证结果');
        return transaction(this.pool, async (client) => {
            const prior = await client.query(`SELECT input_fingerprint,channel_id FROM smtp_configuration_requests
        WHERE actor_id=$1 AND request_id=$2`, [actor.id, input.requestId]);
            if (prior.rowCount) {
                if (prior.rows[0].input_fingerprint !== fingerprint)
                    throw new ConflictException('请求标识已用于不同的团队发信设置');
                const existing = await client.query(`SELECT id,smtp_host,smtp_port,smtp_security,smtp_username,reply_to,
          verification_state,verification_detail,default_flag,verified_at,updated_at
          FROM team_sending_channels WHERE id=$1 AND organization_id=$2`, [prior.rows[0].channel_id, actor.organization_id]);
                return serialize(existing.rows[0]);
            }
            const id = randomUUID();
            const encrypted = encryptCredential(this.key, actor.organization_id, settings.credential);
            if (input.defaultChannel)
                await client.query('UPDATE team_sending_channels SET default_flag=false WHERE organization_id=$1 AND default_flag', [actor.organization_id]);
            const saved = await client.query(`INSERT INTO team_sending_channels(
          id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,credential_encrypted,
          reply_to,verification_state,verification_detail,default_flag,verified_at,updated_by)
        VALUES($1,$2,'SMTP',$3,$4,$5,$6,$7,$8,$9,$10,$11,clock_timestamp(),$12)
        ON CONFLICT(organization_id,kind) DO UPDATE SET
          smtp_host=EXCLUDED.smtp_host,smtp_port=EXCLUDED.smtp_port,smtp_security=EXCLUDED.smtp_security,
          smtp_username=EXCLUDED.smtp_username,credential_encrypted=EXCLUDED.credential_encrypted,
          reply_to=EXCLUDED.reply_to,verification_state=EXCLUDED.verification_state,
          verification_detail=EXCLUDED.verification_detail,default_flag=EXCLUDED.default_flag,
          verified_at=EXCLUDED.verified_at,updated_by=EXCLUDED.updated_by,updated_at=clock_timestamp()
        RETURNING id,smtp_host,smtp_port,smtp_security,smtp_username,reply_to,verification_state,
          verification_detail,default_flag,verified_at,updated_at`, [
                id,
                actor.organization_id,
                settings.host,
                settings.port,
                settings.security,
                settings.username,
                encrypted,
                settings.replyTo,
                verification.state,
                verification.detail,
                input.defaultChannel,
                actor.id
            ]);
            const channel = saved.rows[0];
            await client.query(`INSERT INTO smtp_configuration_requests(actor_id,request_id,input_fingerprint,channel_id)
        VALUES($1,$2,$3,$4)`, [actor.id, input.requestId, fingerprint, channel.id]);
            await client.query(`INSERT INTO sending_channel_audit(actor_id,organization_id,channel_id,action,verification_state)
        VALUES($1,$2,$3,'smtp_configured',$4)`, [actor.id, actor.organization_id, channel.id, verification.state]);
            return serialize(channel);
        });
    }
}
//# sourceMappingURL=smtp-channel.js.map