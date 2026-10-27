import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createDecipheriv, randomUUID } from 'node:crypto';
import { transaction } from './database.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export class DeferredDomesticSmtpSender {
    async send() {
        return { state: 'not_submitted', detail: '正式 SMTP 发送适配器尚未配置' };
    }
}
export class DeferredUMailSender {
    async send(message) {
        return {
            state: 'not_submitted', detail: '正式 U-Mail 任务适配器尚未配置',
            organizationId: message.organizationId, resourceId: message.resourceId, recipientId: message.recipientId
        };
    }
}
export class DeferredDeliveryEvidenceProvider {
    async check() {
        throw new ServiceUnavailableException('渠道证据接口尚未配置，不能确认核对完成');
    }
}
function inputObject(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) ||
        Object.keys(value).sort().join(',') !== keys.sort().join(','))
        throw new BadRequestException('发送参数字段无效');
    return value;
}
function identifier(value) {
    if (typeof value !== 'string' || !uuid.test(value))
        throw new BadRequestException('标识无效');
    return value;
}
function daySql() { return "(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date"; }
export class EmailSendService {
    pool;
    key;
    sender;
    umailSender;
    evidenceProvider;
    constructor(pool, key, sender = new DeferredDomesticSmtpSender(), umailSender = new DeferredUMailSender(), evidenceProvider = new DeferredDeliveryEvidenceProvider()) {
        this.pool = pool;
        this.key = key;
        this.sender = sender;
        this.umailSender = umailSender;
        this.evidenceProvider = evidenceProvider;
    }
    async pauseExpired(organizationId) {
        return transaction(this.pool, async (db) => {
            const today = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
            const stale = (await db.query(`SELECT r.id,r.organization_id,coalesce(r.retry_usage_day,b.usage_day) AS usage_day
        FROM email_recipients r JOIN email_batches b ON b.id=r.batch_id
        WHERE r.status='queued' AND coalesce(r.retry_usage_day,b.usage_day)<$1::date
          AND ($2::uuid IS NULL OR r.organization_id=$2)
        ORDER BY r.id FOR UPDATE OF r`, [today, organizationId ?? null])).rows;
            for (const row of stale) {
                await db.query(`UPDATE email_recipients SET status='paused',resolved_at=clock_timestamp(),
          detail='跨日未执行，须重新确认今日额度' WHERE id=$1`, [row.id]);
                await db.query(`UPDATE email_daily_usage SET reserved=reserved-1
          WHERE organization_id=$1 AND usage_day=$2`, [row.organization_id, row.usage_day]);
                await db.query(`INSERT INTO email_usage_events(recipient_id,event,usage_day)
          VALUES($1,'released',$2) ON CONFLICT DO NOTHING`, [row.id, row.usage_day]);
            }
            return stale.length;
        });
    }
    async terminal(identity) {
        if (!['admin', 'sales'].includes(identity.role))
            throw new ForbiddenException('仅终端企业成员可发送');
        const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
        if (org?.kind !== 'terminal' || !org.active)
            throw new ForbiddenException('企业不可用');
    }
    async quota(identity) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        const row = (await this.pool.query(`SELECT coalesce(l.daily_limit,2000) AS "dailyLimit",
      coalesce(u.reserved,0) AS reserved,coalesce(u.used,0) AS used,${daySql()} AS day
      FROM organizations o LEFT JOIN organization_email_limits l ON l.organization_id=o.id
      LEFT JOIN email_daily_usage u ON u.organization_id=o.id AND u.usage_day=${daySql()}
      WHERE o.id=$1`, [identity.organization_id])).rows[0];
        return { ...row, remaining: Number(row.dailyLimit) - Number(row.reserved) - Number(row.used) };
    }
    async configureLimit(identity, body) {
        if (identity.role !== 'platform')
            throw new ForbiddenException('仅平台可配置企业日额度');
        const input = inputObject(body, ['organizationId', 'dailyLimit']);
        const organizationId = identifier(input.organizationId);
        if (!Number.isInteger(input.dailyLimit) || Number(input.dailyLimit) < 1 || Number(input.dailyLimit) > 1000000)
            throw new BadRequestException('日额度无效');
        return transaction(this.pool, async (db) => {
            const org = (await db.query("SELECT kind FROM organizations WHERE id=$1 FOR UPDATE", [organizationId])).rows[0];
            if (org?.kind !== 'terminal')
                throw new NotFoundException('终端企业不存在');
            await db.query(`INSERT INTO organization_email_limits(organization_id,daily_limit,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(organization_id) DO UPDATE SET daily_limit=EXCLUDED.daily_limit,updated_by=EXCLUDED.updated_by,
        updated_at=clock_timestamp()`, [organizationId, input.dailyLimit, identity.id]);
            await db.query('INSERT INTO email_limit_audit(organization_id,daily_limit,actor_id) VALUES($1,$2,$3)', [organizationId, input.dailyLimit, identity.id]);
            return { organizationId, dailyLimit: input.dailyLimit };
        });
    }
    async confirm(identity, body) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        const input = inputObject(body, ['previewId', 'channelId', 'confirmUnsubscribeNotice', 'confirmQuota']);
        const previewId = identifier(input.previewId);
        const channelId = identifier(input.channelId);
        if (input.confirmUnsubscribeNotice !== true || input.confirmQuota !== true)
            throw new BadRequestException('须确认退订提示与本企业日额度');
        return transaction(this.pool, async (db) => {
            const preview = (await db.query(`SELECT p.*,d.updated_at FROM email_previews p JOIN email_drafts d ON d.id=p.draft_id
        WHERE p.id=$1 AND p.organization_id=$2 AND p.actor_id=$3 FOR UPDATE OF p`, [previewId, identity.organization_id, identity.id])).rows[0];
            if (!preview)
                throw new NotFoundException('本人的预览不存在');
            const prior = (await db.query('SELECT id FROM email_batches WHERE preview_id=$1', [previewId])).rows[0];
            if (prior)
                return { batchId: prior.id, queued: false };
            if (!preview.confirmed_at || new Date(preview.updated_at).getTime() > new Date(preview.created_at).getTime())
                throw new ConflictException('预览尚未确认或草稿已修改');
            const channel = (await db.query(`SELECT id,kind,reply_to,umail_sender_address,verification_state FROM team_sending_channels
        WHERE id=$1 AND organization_id=$2 AND kind IN ('SMTP','UMAIL')`, [channelId, identity.organization_id])).rows[0];
            if (!channel)
                throw new NotFoundException('本企业发送渠道不存在');
            if (channel.verification_state !== 'available')
                throw new ConflictException('本批发送渠道尚未验证可用');
            const recipients = preview.preview_snapshot;
            if (!Array.isArray(recipients) || recipients.length < 1 ||
                new Set(recipients.map(item => item.emailKey)).size !== recipients.length ||
                recipients.some(item => item.emailKey !== item.email.toLowerCase()))
                throw new ConflictException('预览收件人快照无效');
            const selected = preview.recipient_snapshot;
            const contacts = (await db.query(`SELECT id,unsubscribed FROM company_contacts
        WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND profile_id=$3`, [selected.map(item => item.contactId), identity.organization_id, preview.profile_id])).rows;
            if (contacts.length !== selected.length || contacts.some(contact => contact.unsubscribed &&
                !recipients.some(item => item.unsubscribedContactIds.includes(contact.id))))
                throw new ConflictException('联系人退订状态已变化，请重新预览确认');
            const attachments = (await db.query(`SELECT count(*)::int AS count FROM public_template_attachments
        WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL AND expires_at>clock_timestamp() AND content IS NOT NULL`, [preview.attachment_ids])).rows[0];
            if (attachments.count !== preview.attachment_ids.length)
                throw new ConflictException('预设附件已到期');
            await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [identity.organization_id]);
            const resource = channel.kind === 'UMAIL' ? (await db.query(`SELECT external_resource_id FROM umail_resources
        WHERE organization_id=$1 AND resource_status='available' FOR UPDATE`, [identity.organization_id])).rows[0] : null;
            if (channel.kind === 'UMAIL' && !resource)
                throw new ConflictException('本企业 U-Mail 资源尚未验证可用');
            const day = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
            await db.query(`INSERT INTO email_daily_usage(organization_id,usage_day) VALUES($1,$2)
        ON CONFLICT DO NOTHING`, [identity.organization_id, day]);
            const usage = (await db.query(`SELECT reserved,used FROM email_daily_usage
        WHERE organization_id=$1 AND usage_day=$2 FOR UPDATE`, [identity.organization_id, day])).rows[0];
            const limit = (await db.query('SELECT daily_limit FROM organization_email_limits WHERE organization_id=$1', [identity.organization_id])).rows[0]?.daily_limit ?? 2000;
            if (Number(usage.reserved) + Number(usage.used) + recipients.length > Number(limit))
                throw new ConflictException('企业今日邮件额度不足');
            const batchId = randomUUID();
            await db.query(`INSERT INTO email_batches(id,preview_id,organization_id,actor_id,profile_id,channel_id,channel_kind,
        reply_to,usage_day,attachment_ids,umail_resource_id,umail_sender_address)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [batchId, previewId, identity.organization_id, identity.id, preview.profile_id, channelId,
                channel.kind, channel.reply_to, day, preview.attachment_ids, resource?.external_resource_id ?? null,
                channel.kind === 'UMAIL' ? channel.umail_sender_address : null]);
            for (const item of recipients) {
                const recipientId = randomUUID();
                await db.query(`INSERT INTO email_recipients(id,batch_id,organization_id,profile_id,email,email_key,contact_id,
          mailsou_id,subject,content,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')`, [recipientId, batchId, identity.organization_id, preview.profile_id, item.email, item.emailKey,
                    item.contactId, item.mailsouId, item.subject, item.content]);
                await db.query("INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,'reserved',$2)", [recipientId, day]);
            }
            await db.query('UPDATE email_daily_usage SET reserved=reserved+$3 WHERE organization_id=$1 AND usage_day=$2', [identity.organization_id, day, recipients.length]);
            return { batchId, queued: true, count: recipients.length, usageDay: day };
        });
    }
    credential(organizationId, encrypted) {
        const [iv, tag, bytes] = encrypted.split('.').map(part => Buffer.from(part, 'base64url'));
        const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
        decipher.setAAD(Buffer.from(`${organizationId}:SMTP`));
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8');
    }
    async execute(identity, body) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        const input = inputObject(body, ['batchId']);
        const batchId = identifier(input.batchId);
        return this.executeRows(identity, batchId);
    }
    async executeRecipient(identity, body) {
        await this.terminal(identity);
        const input = inputObject(body, ['recipientId']);
        const recipientId = identifier(input.recipientId);
        const row = (await this.pool.query(`SELECT batch_id FROM email_recipients
      WHERE id=$1 AND organization_id=$2 AND retry_usage_day IS NOT NULL`, [recipientId, identity.organization_id])).rows[0];
        if (!row)
            throw new NotFoundException('重新确认的收件人不存在');
        return this.executeRows(identity, row.batch_id, recipientId);
    }
    async executeRows(identity, batchId, recipientId) {
        await this.pauseExpired(identity.organization_id);
        const batch = (await this.pool.query('SELECT id FROM email_batches WHERE id=$1 AND organization_id=$2 AND actor_id=$3', [batchId, identity.organization_id, identity.id])).rows[0];
        if (!batch)
            throw new NotFoundException('本人的发送批次不存在');
        const queued = (await this.pool.query(`SELECT id FROM email_recipients WHERE batch_id=$1 AND status='queued'
      AND ($2::uuid IS NULL OR id=$2) ORDER BY id`, [batchId, recipientId ?? null])).rows;
        for (const entry of queued) {
            const claimed = await transaction(this.pool, async (db) => {
                const row = (await db.query(`SELECT r.*,coalesce(r.retry_usage_day,b.usage_day) AS usage_day,b.attachment_ids,b.reply_to,b.channel_id,
          b.channel_kind,b.umail_resource_id,b.umail_sender_address AS batch_sender_address FROM email_recipients r
          JOIN email_batches b ON b.id=r.batch_id WHERE r.id=$1 AND r.organization_id=$2 FOR UPDATE OF r`, [entry.id, identity.organization_id])).rows[0];
                if (!row || row.status !== 'queued')
                    return null;
                const today = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
                if (String(today).slice(0, 10) !== String(row.usage_day).slice(0, 10)) {
                    await db.query("UPDATE email_recipients SET status='paused',resolved_at=clock_timestamp(),detail='跨日未执行，等待后续重新确认' WHERE id=$1", [row.id]);
                    await db.query('UPDATE email_daily_usage SET reserved=reserved-1 WHERE organization_id=$1 AND usage_day=$2', [identity.organization_id, row.usage_day]);
                    await db.query("INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,'released',$2)", [row.id, row.usage_day]);
                    return null;
                }
                const channel = (await db.query(`SELECT smtp_host,smtp_port,smtp_security,smtp_username,credential_encrypted,reply_to,
          umail_sender_address,verification_state FROM team_sending_channels
          WHERE id=$1 AND organization_id=$2 AND kind=$3`, [row.channel_id, identity.organization_id, row.channel_kind])).rows[0];
                if (!channel || channel.verification_state !== 'available' || channel.reply_to !== row.reply_to ||
                    (row.channel_kind === 'UMAIL' && channel.umail_sender_address !== row.batch_sender_address))
                    throw new ConflictException('渠道设置已变化，未执行收件人保留待处理');
                if (row.channel_kind === 'UMAIL') {
                    const resource = (await db.query(`SELECT external_resource_id FROM umail_resources
            WHERE organization_id=$1 AND resource_status='available'`, [identity.organization_id])).rows[0];
                    if (!resource || resource.external_resource_id !== row.umail_resource_id)
                        throw new ConflictException('U-Mail 企业资源已变化，未执行收件人保留待处理');
                }
                const attachments = (await db.query(`SELECT id,file_name AS "fileName",mime_type AS "mimeType",content AS bytes
          FROM public_template_attachments WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL
          AND expires_at>clock_timestamp() AND content IS NOT NULL`, [row.attachment_ids])).rows;
                if (attachments.length !== row.attachment_ids.length)
                    throw new ConflictException('预设附件已不可用，未执行收件人保留待处理');
                const attachmentsById = new Map(attachments.map(attachment => [attachment.id, attachment]));
                const orderedAttachments = row.attachment_ids.map(id => attachmentsById.get(id));
                if (orderedAttachments.some(item => !item))
                    throw new ConflictException('预设附件映射无效');
                await db.query("UPDATE email_recipients SET status='submitting',submitted_at=clock_timestamp() WHERE id=$1", [row.id]);
                return {
                    id: row.id,
                    usageDay: row.usage_day,
                    channelKind: row.channel_kind,
                    settings: row.channel_kind === 'SMTP' ? {
                        host: channel.smtp_host, port: channel.smtp_port, security: channel.smtp_security,
                        username: channel.smtp_username, credential: this.credential(identity.organization_id, channel.credential_encrypted),
                        replyTo: row.reply_to
                    } : null,
                    message: { recipientId: row.id, to: row.email, subject: row.subject, content: row.content, attachments: orderedAttachments },
                    umailMessage: row.channel_kind === 'UMAIL' ? {
                        organizationId: identity.organization_id, resourceId: row.umail_resource_id, recipientId: row.id,
                        senderAddress: channel.umail_sender_address, relpy_to: row.reply_to,
                        to: row.email, subject: row.subject, content: row.content, attachments: orderedAttachments
                    } : null
                };
            });
            if (!claimed)
                continue;
            let result;
            try {
                if (claimed.channelKind === 'UMAIL' && claimed.umailMessage) {
                    const response = await this.umailSender.send(claimed.umailMessage);
                    result = response.organizationId === claimed.umailMessage.organizationId &&
                        response.resourceId === claimed.umailMessage.resourceId &&
                        response.recipientId === claimed.umailMessage.recipientId ? response :
                        { state: 'uncertain', detail: 'U-Mail 返回归属不一致，保留原日额度等待核对' };
                }
                else if (claimed.settings) {
                    result = await this.sender.send(claimed.settings, claimed.message);
                }
                else {
                    result = { state: 'uncertain', detail: '发送渠道无效，保留原日额度等待核对' };
                }
                if (!['accepted', 'not_submitted', 'uncertain'].includes(result.state) || typeof result.detail !== 'string')
                    result = { state: 'uncertain', detail: '适配器返回无效结果' };
            }
            catch {
                result = { state: 'uncertain', detail: '提交结果不确定，保留原日额度等待证据核对' };
            }
            await transaction(this.pool, async (db) => {
                const row = (await db.query('SELECT status FROM email_recipients WHERE id=$1 FOR UPDATE', [claimed.id])).rows[0];
                if (row?.status !== 'submitting')
                    return;
                await db.query('UPDATE email_recipients SET status=$2,resolved_at=clock_timestamp(),detail=$3 WHERE id=$1', [claimed.id, result.state, result.detail.slice(0, 500)]);
                if (result.state !== 'uncertain') {
                    const used = result.state === 'accepted';
                    await db.query(`UPDATE email_daily_usage SET reserved=reserved-1,used=used+$3
            WHERE organization_id=$1 AND usage_day=$2`, [identity.organization_id, claimed.usageDay, used ? 1 : 0]);
                    await db.query(`INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,$2,$3)`, [claimed.id, used ? 'used' : 'released', claimed.usageDay]);
                }
            });
        }
        return this.batch(identity, batchId);
    }
    async reconcile(identity, body) {
        await this.terminal(identity);
        const input = inputObject(body, ['recipientId']);
        const recipientId = identifier(input.recipientId);
        const row = (await this.pool.query(`SELECT r.*,b.channel_kind,b.umail_resource_id
      FROM email_recipients r JOIN email_batches b ON b.id=r.batch_id
      WHERE r.id=$1 AND r.organization_id=$2`, [recipientId, identity.organization_id])).rows[0];
        if (!row)
            throw new NotFoundException('收件人记录不存在');
        if (!['submitting', 'uncertain', 'accepted', 'delivered', 'not_submitted'].includes(row.status))
            throw new ConflictException('当前状态无需证据核对');
        const request = { organizationId: identity.organization_id,
            recipientId, channelKind: row.channel_kind, resourceId: row.umail_resource_id,
            to: row.email, submittedAt: row.submitted_at };
        let evidence;
        try {
            evidence = await this.evidenceProvider.check(request);
        }
        catch {
            throw new ServiceUnavailableException('渠道证据核对失败或尚未配置');
        }
        if (evidence.organizationId !== request.organizationId || evidence.recipientId !== recipientId ||
            evidence.resourceId !== request.resourceId ||
            !['unknown', 'accepted', 'not_submitted', 'delivered'].includes(evidence.finding) ||
            typeof evidence.detail !== 'string' ||
            (evidence.evidenceId !== null && (typeof evidence.evidenceId !== 'string' || !evidence.evidenceId.trim())))
            throw new ConflictException('渠道证据归属或格式无效');
        if (evidence.finding !== 'unknown' && !evidence.evidenceId)
            throw new ConflictException('可靠结论须包含渠道证据标识');
        return transaction(this.pool, async (db) => {
            const current = (await db.query(`SELECT r.status,r.checked_at,coalesce(r.retry_usage_day,b.usage_day) AS usage_day FROM email_recipients r
        JOIN email_batches b ON b.id=r.batch_id WHERE r.id=$1 AND r.organization_id=$2 FOR UPDATE OF r`, [recipientId, identity.organization_id])).rows[0];
            if (!current)
                throw new NotFoundException('收件人记录不存在');
            const prior = evidence.evidenceId ? (await db.query(`SELECT finding FROM email_evidence_checks
        WHERE recipient_id=$1 AND evidence_id=$2`, [recipientId, evidence.evidenceId])).rows[0] : null;
            if (prior && prior.finding !== evidence.finding)
                throw new ConflictException('同一渠道证据结论冲突');
            if (!prior)
                await db.query(`INSERT INTO email_evidence_checks(recipient_id,actor_id,evidence_id,finding,detail)
        VALUES($1,$2,$3,$4,$5)`, [recipientId, identity.id, evidence.evidenceId,
                    evidence.finding, evidence.detail.slice(0, 500)]);
            if (['delivered', 'not_submitted'].includes(current.status) ||
                (current.status === 'accepted' && evidence.finding !== 'delivered'))
                return { recipientId, status: current.status, checked: true };
            const next = evidence.finding === 'unknown' ? 'uncertain' : evidence.finding;
            if (current.status === 'accepted' && next !== 'delivered')
                return { recipientId, status: current.status, checked: true };
            if (current.status !== next || !current.checked_at)
                await db.query(`UPDATE email_recipients
        SET status=$2,checked_at=clock_timestamp(),resolved_at=clock_timestamp(),detail=$3 WHERE id=$1`, [recipientId, next, evidence.detail.slice(0, 500)]);
            if (['submitting', 'uncertain'].includes(current.status) && next !== 'uncertain') {
                const used = next !== 'not_submitted';
                await db.query(`UPDATE email_daily_usage SET reserved=reserved-1,used=used+$3
          WHERE organization_id=$1 AND usage_day=$2`, [identity.organization_id, current.usage_day, used ? 1 : 0]);
                await db.query(`INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,$2,$3)
          ON CONFLICT DO NOTHING`, [recipientId, used ? 'used' : 'released', current.usage_day]);
            }
            return { recipientId, status: next, checked: true };
        });
    }
    async retry(identity, body) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        const input = inputObject(body, ['recipientId', 'confirmPossibleDuplicate']);
        const recipientId = identifier(input.recipientId);
        if (input.confirmPossibleDuplicate !== true)
            throw new BadRequestException('须明确确认可能重复发送');
        const created = await transaction(this.pool, async (db) => {
            const original = (await db.query(`SELECT r.*,b.actor_id,b.usage_day,b.channel_id,b.channel_kind,b.reply_to,
        b.umail_resource_id,b.umail_sender_address FROM email_recipients r
        JOIN email_batches b ON b.id=r.batch_id WHERE r.id=$1 AND r.organization_id=$2 FOR UPDATE OF r`, [recipientId, identity.organization_id])).rows[0];
            if (!original)
                throw new NotFoundException('收件人记录不存在');
            if (original.actor_id !== identity.id)
                throw new ForbiddenException('仅原发送人可决定重发');
            const prior = (await db.query('SELECT id FROM email_recipients WHERE parent_recipient_id=$1', [recipientId])).rows[0];
            if (prior)
                return { id: prior.id, batchId: original.batch_id, created: false };
            if (original.status !== 'uncertain' || !original.checked_at)
                throw new ConflictException('须先核对渠道证据且结果仍不明确');
            const channel = (await db.query(`SELECT verification_state,reply_to,umail_sender_address FROM team_sending_channels
        WHERE id=$1 AND organization_id=$2 AND kind=$3`, [original.channel_id, identity.organization_id, original.channel_kind])).rows[0];
            if (!channel || channel.verification_state !== 'available' || channel.reply_to !== original.reply_to ||
                (original.channel_kind === 'UMAIL' && channel.umail_sender_address !== original.umail_sender_address))
                throw new ConflictException('原渠道设置已变化，请重新确认');
            if (original.channel_kind === 'UMAIL') {
                const resource = (await db.query(`SELECT external_resource_id FROM umail_resources
          WHERE organization_id=$1 AND resource_status='available'`, [identity.organization_id])).rows[0];
                if (resource?.external_resource_id !== original.umail_resource_id)
                    throw new ConflictException('原 U-Mail 企业资源已变化');
            }
            await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [identity.organization_id]);
            const day = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
            await db.query(`INSERT INTO email_daily_usage(organization_id,usage_day) VALUES($1,$2)
        ON CONFLICT DO NOTHING`, [identity.organization_id, day]);
            const usage = (await db.query(`SELECT reserved,used FROM email_daily_usage
        WHERE organization_id=$1 AND usage_day=$2 FOR UPDATE`, [identity.organization_id, day])).rows[0];
            const limit = (await db.query('SELECT daily_limit FROM organization_email_limits WHERE organization_id=$1', [identity.organization_id])).rows[0]?.daily_limit ?? 2000;
            if (Number(usage.reserved) + Number(usage.used) + 1 > Number(limit))
                throw new ConflictException('企业今日邮件额度不足');
            const id = randomUUID();
            await db.query(`INSERT INTO email_recipients(id,batch_id,organization_id,profile_id,email,email_key,contact_id,
        mailsou_id,subject,content,status,parent_recipient_id,retry_usage_day)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued',$11,$12)`, [id, original.batch_id, identity.organization_id, original.profile_id, original.email, original.email_key,
                original.contact_id, original.mailsou_id, original.subject, original.content, recipientId, day]);
            await db.query("INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,'reserved',$2)", [id, day]);
            await db.query('UPDATE email_daily_usage SET reserved=reserved+1 WHERE organization_id=$1 AND usage_day=$2', [identity.organization_id, day]);
            return { id, batchId: original.batch_id, created: true };
        });
        await this.executeRows(identity, created.batchId, created.id);
        return { ...created, result: await this.batch(identity, created.batchId) };
    }
    async reconfirm(identity, body) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        const input = inputObject(body, ['recipientId', 'confirmUnsubscribeNotice', 'confirmQuota']);
        const recipientId = identifier(input.recipientId);
        if (input.confirmUnsubscribeNotice !== true || input.confirmQuota !== true)
            throw new BadRequestException('须重新确认退订提示与今日企业额度');
        return transaction(this.pool, async (db) => {
            const row = (await db.query(`SELECT r.*,b.actor_id,b.preview_id,b.usage_day,b.channel_id,b.channel_kind,
        b.reply_to,b.attachment_ids,b.umail_resource_id,b.umail_sender_address
        FROM email_recipients r JOIN email_batches b ON b.id=r.batch_id
        WHERE r.id=$1 AND r.organization_id=$2 FOR UPDATE OF r`, [recipientId, identity.organization_id])).rows[0];
            if (!row)
                throw new NotFoundException('收件人记录不存在');
            if (row.actor_id !== identity.id)
                throw new ForbiddenException('仅原发送人可重新确认');
            if (row.status !== 'paused')
                throw new ConflictException('仅跨日暂停的收件人可重新确认');
            const oldDay = row.retry_usage_day ?? row.usage_day;
            const today = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
            if (String(today).slice(0, 10) <= String(oldDay).slice(0, 10))
                throw new ConflictException('须在后续日期重新确认');
            const channel = (await db.query(`SELECT verification_state,reply_to,umail_sender_address
        FROM team_sending_channels WHERE id=$1 AND organization_id=$2 AND kind=$3`, [row.channel_id, identity.organization_id, row.channel_kind])).rows[0];
            if (!channel || channel.verification_state !== 'available' || channel.reply_to !== row.reply_to ||
                (row.channel_kind === 'UMAIL' && channel.umail_sender_address !== row.umail_sender_address))
                throw new ConflictException('原渠道设置已变化，请重新建立发送预览');
            if (row.channel_kind === 'UMAIL') {
                const resource = (await db.query(`SELECT external_resource_id FROM umail_resources
          WHERE organization_id=$1 AND resource_status='available'`, [identity.organization_id])).rows[0];
                if (resource?.external_resource_id !== row.umail_resource_id)
                    throw new ConflictException('原 U-Mail 企业资源已变化');
            }
            const attachments = (await db.query(`SELECT count(*)::int AS count FROM public_template_attachments
        WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL AND expires_at>clock_timestamp() AND content IS NOT NULL`, [row.attachment_ids])).rows[0];
            if (attachments.count !== row.attachment_ids.length)
                throw new ConflictException('预设附件已不可用');
            const preview = (await db.query('SELECT preview_snapshot FROM email_previews WHERE id=$1', [row.preview_id])).rows[0];
            const snapshot = preview?.preview_snapshot?.find(item => item.emailKey === row.email_key && item.email === row.email && item.contactId === row.contact_id &&
                item.mailsouId === row.mailsou_id);
            if (!snapshot || !Array.isArray(snapshot.sourceContactIds) ||
                !snapshot.sourceContactIds.includes(row.contact_id))
                throw new ConflictException('原收件人快照已不可核对，请重新预览确认');
            const contacts = (await db.query(`SELECT id,unsubscribed FROM company_contacts
        WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND profile_id=$3`, [snapshot.sourceContactIds, identity.organization_id, row.profile_id])).rows;
            if (contacts.length !== snapshot.sourceContactIds.length || contacts.some(contact => contact.unsubscribed && !snapshot.unsubscribedContactIds.includes(contact.id)))
                throw new ConflictException('联系人退订状态已变化，请重新预览确认');
            await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [identity.organization_id]);
            await db.query(`INSERT INTO email_daily_usage(organization_id,usage_day) VALUES($1,$2)
        ON CONFLICT DO NOTHING`, [identity.organization_id, today]);
            const usage = (await db.query(`SELECT reserved,used FROM email_daily_usage
        WHERE organization_id=$1 AND usage_day=$2 FOR UPDATE`, [identity.organization_id, today])).rows[0];
            const limit = (await db.query('SELECT daily_limit FROM organization_email_limits WHERE organization_id=$1', [identity.organization_id])).rows[0]?.daily_limit ?? 2000;
            if (Number(usage.reserved) + Number(usage.used) + 1 > Number(limit))
                throw new ConflictException('企业今日邮件额度不足');
            await db.query(`UPDATE email_recipients SET status='queued',retry_usage_day=$2,
        resolved_at=NULL,detail='已重新确认，等待手动执行' WHERE id=$1`, [recipientId, today]);
            await db.query(`UPDATE email_daily_usage SET reserved=reserved+1
        WHERE organization_id=$1 AND usage_day=$2`, [identity.organization_id, today]);
            await db.query(`INSERT INTO email_usage_events(recipient_id,event,usage_day)
        VALUES($1,'reserved',$2)`, [recipientId, today]);
            return { recipientId, batchId: row.batch_id, queued: true, usageDay: today };
        });
    }
    async batch(identity, batchId) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        identifier(batchId);
        const batch = (await this.pool.query(`SELECT id,preview_id AS "previewId",profile_id AS "profileId",channel_kind AS channel,
      reply_to AS "replyTo",usage_day AS "usageDay",created_at AS "createdAt" FROM email_batches
      WHERE id=$1 AND organization_id=$2`, [batchId, identity.organization_id])).rows[0];
        if (!batch)
            throw new NotFoundException('发送批次不存在');
        const recipients = (await this.pool.query(`SELECT r.id,r.email,r.mailsou_id AS "mailsouId",r.subject,r.content,r.status,r.detail,
      r.parent_recipient_id AS "parentRecipientId",r.checked_at AS "checkedAt",
      r.retry_usage_day AS "reconfirmedUsageDay",
      coalesce(r.retry_usage_day,b.usage_day) AS "usageDay",
      r.submitted_at AS "submittedAt",r.resolved_at AS "resolvedAt" FROM email_recipients r
      JOIN email_batches b ON b.id=r.batch_id WHERE r.batch_id=$1 ORDER BY r.id`, [batchId])).rows;
        return { batch, recipients };
    }
    async list(identity) {
        await this.terminal(identity);
        await this.pauseExpired(identity.organization_id);
        const rows = (await this.pool.query(`SELECT b.id,b.profile_id AS "profileId",b.channel_kind AS channel,
      b.reply_to AS "replyTo",b.usage_day AS "usageDay",b.created_at AS "createdAt",
      count(r.id)::int AS count,
      count(r.id) FILTER(WHERE r.status='accepted')::int AS accepted,
      count(r.id) FILTER(WHERE r.status='delivered')::int AS delivered,
      count(r.id) FILTER(WHERE r.status IN ('uncertain','submitting'))::int AS uncertain,
      count(r.id) FILTER(WHERE r.status='paused')::int AS paused
      FROM email_batches b JOIN email_recipients r ON r.batch_id=b.id WHERE b.organization_id=$1
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`, [identity.organization_id])).rows;
        return { batches: rows };
    }
}
//# sourceMappingURL=email-send.js.map