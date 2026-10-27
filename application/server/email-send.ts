import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createDecipheriv, randomUUID } from 'node:crypto';
import type pg from 'pg';
import { transaction } from './database.js';
import type { Identity } from './identity.js';
import type { DomesticSmtpSettings } from './smtp-channel.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RecipientSnapshot = {
  email: string; emailKey: string; contactId: string; mailsouId: string;
  subject: string; content: string; unsubscribedContactIds: string[];
};
export type SmtpSendResult = { state: 'accepted' | 'not_submitted' | 'uncertain'; detail: string };
export interface SmtpMessage {
  recipientId: string;
  to: string;
  subject: string;
  content: string;
  attachments: Array<{ fileName: string; mimeType: string; bytes: Buffer }>;
}
export interface DomesticSmtpSender {
  send(settings: DomesticSmtpSettings, message: SmtpMessage): Promise<SmtpSendResult>;
}
export class DeferredDomesticSmtpSender implements DomesticSmtpSender {
  async send(): Promise<SmtpSendResult> {
    return { state: 'not_submitted', detail: '正式 SMTP 发送适配器尚未配置' };
  }
}
function inputObject(value: unknown, keys: string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    Object.keys(value).sort().join(',') !== keys.sort().join(',')) throw new BadRequestException('发送参数字段无效');
  return value as Record<string, unknown>;
}
function identifier(value: unknown) {
  if (typeof value !== 'string' || !uuid.test(value)) throw new BadRequestException('标识无效');
  return value;
}
function daySql() { return "(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date"; }
export class EmailSendService {
  constructor(private readonly pool: pg.Pool, private readonly key: Buffer,
    private readonly sender: DomesticSmtpSender = new DeferredDomesticSmtpSender()) {}
  private async terminal(identity: Identity) {
    if (!['admin', 'sales'].includes(identity.role)) throw new ForbiddenException('仅终端企业成员可发送');
    const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
    if (org?.kind !== 'terminal' || !org.active) throw new ForbiddenException('企业不可用');
  }
  async quota(identity: Identity) {
    await this.terminal(identity);
    const row = (await this.pool.query(`SELECT coalesce(l.daily_limit,2000) AS "dailyLimit",
      coalesce(u.reserved,0) AS reserved,coalesce(u.used,0) AS used,${daySql()} AS day
      FROM organizations o LEFT JOIN organization_email_limits l ON l.organization_id=o.id
      LEFT JOIN email_daily_usage u ON u.organization_id=o.id AND u.usage_day=${daySql()}
      WHERE o.id=$1`, [identity.organization_id])).rows[0];
    return { ...row, remaining: Number(row.dailyLimit) - Number(row.reserved) - Number(row.used) };
  }
  async configureLimit(identity: Identity, body: unknown) {
    if (identity.role !== 'platform') throw new ForbiddenException('仅平台可配置企业日额度');
    const input = inputObject(body, ['organizationId', 'dailyLimit']);
    const organizationId = identifier(input.organizationId);
    if (!Number.isInteger(input.dailyLimit) || Number(input.dailyLimit) < 1 || Number(input.dailyLimit) > 1000000)
      throw new BadRequestException('日额度无效');
    return transaction(this.pool, async db => {
      const org = (await db.query("SELECT kind FROM organizations WHERE id=$1 FOR UPDATE", [organizationId])).rows[0];
      if (org?.kind !== 'terminal') throw new NotFoundException('终端企业不存在');
      await db.query(`INSERT INTO organization_email_limits(organization_id,daily_limit,updated_by) VALUES($1,$2,$3)
        ON CONFLICT(organization_id) DO UPDATE SET daily_limit=EXCLUDED.daily_limit,updated_by=EXCLUDED.updated_by,
        updated_at=clock_timestamp()`, [organizationId, input.dailyLimit, identity.id]);
      await db.query('INSERT INTO email_limit_audit(organization_id,daily_limit,actor_id) VALUES($1,$2,$3)',
        [organizationId, input.dailyLimit, identity.id]);
      return { organizationId, dailyLimit: input.dailyLimit };
    });
  }
  async confirm(identity: Identity, body: unknown) {
    await this.terminal(identity);
    const input = inputObject(body, ['previewId', 'channelId', 'confirmUnsubscribeNotice', 'confirmQuota']);
    const previewId = identifier(input.previewId);
    const channelId = identifier(input.channelId);
    if (input.confirmUnsubscribeNotice !== true || input.confirmQuota !== true)
      throw new BadRequestException('须确认退订提示与本企业日额度');
    return transaction(this.pool, async db => {
      const preview = (await db.query(`SELECT p.*,d.updated_at FROM email_previews p JOIN email_drafts d ON d.id=p.draft_id
        WHERE p.id=$1 AND p.organization_id=$2 AND p.actor_id=$3 FOR UPDATE OF p`,
      [previewId, identity.organization_id, identity.id])).rows[0];
      if (!preview) throw new NotFoundException('本人的预览不存在');
      const prior = (await db.query('SELECT id FROM email_batches WHERE preview_id=$1', [previewId])).rows[0];
      if (prior) return { batchId: prior.id, queued: false };
      if (!preview.confirmed_at || new Date(preview.updated_at).getTime() > new Date(preview.created_at).getTime())
        throw new ConflictException('预览尚未确认或草稿已修改');
      const channel = (await db.query(`SELECT id,reply_to,verification_state FROM team_sending_channels
        WHERE id=$1 AND organization_id=$2 AND kind='SMTP'`, [channelId, identity.organization_id])).rows[0];
      if (!channel) throw new NotFoundException('本企业国内 SMTP 渠道不存在');
      if (channel.verification_state !== 'available') throw new ConflictException('国内 SMTP 渠道尚未验证可用');
      const recipients = preview.preview_snapshot as RecipientSnapshot[];
      if (!Array.isArray(recipients) || recipients.length < 1 ||
        new Set(recipients.map(item => item.emailKey)).size !== recipients.length ||
        recipients.some(item => item.emailKey !== item.email.toLowerCase()))
        throw new ConflictException('预览收件人快照无效');
      const selected = preview.recipient_snapshot as Array<{ contactId: string }>;
      const contacts = (await db.query(`SELECT id,unsubscribed FROM company_contacts
        WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND profile_id=$3`,
      [selected.map(item => item.contactId), identity.organization_id, preview.profile_id])).rows;
      if (contacts.length !== selected.length || contacts.some(contact => contact.unsubscribed &&
        !recipients.some(item => item.unsubscribedContactIds.includes(contact.id))))
        throw new ConflictException('联系人退订状态已变化，请重新预览确认');
      const attachments = (await db.query(`SELECT count(*)::int AS count FROM public_template_attachments
        WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL AND expires_at>clock_timestamp() AND content IS NOT NULL`,
      [preview.attachment_ids])).rows[0];
      if (attachments.count !== preview.attachment_ids.length) throw new ConflictException('预设附件已到期');
      await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [identity.organization_id]);
      const day = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
      await db.query(`INSERT INTO email_daily_usage(organization_id,usage_day) VALUES($1,$2)
        ON CONFLICT DO NOTHING`, [identity.organization_id, day]);
      const usage = (await db.query(`SELECT reserved,used FROM email_daily_usage
        WHERE organization_id=$1 AND usage_day=$2 FOR UPDATE`, [identity.organization_id, day])).rows[0];
      const limit = (await db.query('SELECT daily_limit FROM organization_email_limits WHERE organization_id=$1',
        [identity.organization_id])).rows[0]?.daily_limit ?? 2000;
      if (Number(usage.reserved) + Number(usage.used) + recipients.length > Number(limit))
        throw new ConflictException('企业今日邮件额度不足');
      const batchId = randomUUID();
      await db.query(`INSERT INTO email_batches(id,preview_id,organization_id,actor_id,profile_id,channel_id,channel_kind,
        reply_to,usage_day,attachment_ids) VALUES($1,$2,$3,$4,$5,$6,'SMTP',$7,$8,$9)`,
      [batchId, previewId, identity.organization_id, identity.id, preview.profile_id, channelId,
        channel.reply_to, day, preview.attachment_ids]);
      for (const item of recipients) {
        const recipientId = randomUUID();
        await db.query(`INSERT INTO email_recipients(id,batch_id,organization_id,profile_id,email,email_key,contact_id,
          mailsou_id,subject,content,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued')`,
        [recipientId, batchId, identity.organization_id, preview.profile_id, item.email, item.emailKey,
          item.contactId, item.mailsouId, item.subject, item.content]);
        await db.query("INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,'reserved',$2)", [recipientId, day]);
      }
      await db.query('UPDATE email_daily_usage SET reserved=reserved+$3 WHERE organization_id=$1 AND usage_day=$2',
        [identity.organization_id, day, recipients.length]);
      return { batchId, queued: true, count: recipients.length, usageDay: day };
    });
  }
  private credential(organizationId: string, encrypted: string) {
    const [iv, tag, bytes] = encrypted.split('.').map(part => Buffer.from(part, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAAD(Buffer.from(`${organizationId}:SMTP`));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8');
  }
  async execute(identity: Identity, body: unknown) {
    await this.terminal(identity);
    const input = inputObject(body, ['batchId']);
    const batchId = identifier(input.batchId);
    const batch = (await this.pool.query('SELECT id FROM email_batches WHERE id=$1 AND organization_id=$2 AND actor_id=$3',
      [batchId, identity.organization_id, identity.id])).rows[0];
    if (!batch) throw new NotFoundException('本人的发送批次不存在');
    const queued = (await this.pool.query("SELECT id FROM email_recipients WHERE batch_id=$1 AND status='queued' ORDER BY id", [batchId])).rows;
    for (const entry of queued) {
      const claimed = await transaction(this.pool, async db => {
        const row = (await db.query(`SELECT r.*,b.usage_day,b.attachment_ids,b.reply_to,b.channel_id FROM email_recipients r
          JOIN email_batches b ON b.id=r.batch_id WHERE r.id=$1 AND r.organization_id=$2 FOR UPDATE OF r`,
        [entry.id, identity.organization_id])).rows[0];
        if (!row || row.status !== 'queued') return null;
        const today = (await db.query(`SELECT ${daySql()} AS day`)).rows[0].day;
        if (String(today).slice(0, 10) !== String(row.usage_day).slice(0, 10)) {
          await db.query("UPDATE email_recipients SET status='paused',resolved_at=clock_timestamp(),detail='跨日未执行，等待后续重新确认' WHERE id=$1", [row.id]);
          await db.query('UPDATE email_daily_usage SET reserved=reserved-1 WHERE organization_id=$1 AND usage_day=$2',
            [identity.organization_id, row.usage_day]);
          await db.query("INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,'released',$2)", [row.id, row.usage_day]);
          return null;
        }
        const channel = (await db.query(`SELECT smtp_host,smtp_port,smtp_security,smtp_username,credential_encrypted,reply_to,
          verification_state FROM team_sending_channels WHERE id=$1 AND organization_id=$2 AND kind='SMTP'`,
        [row.channel_id, identity.organization_id])).rows[0];
        if (!channel || channel.verification_state !== 'available' || channel.reply_to !== row.reply_to)
          throw new ConflictException('渠道设置已变化，未执行收件人保留待处理');
        const attachments = (await db.query(`SELECT file_name AS "fileName",mime_type AS "mimeType",content AS bytes
          FROM public_template_attachments WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL
          AND expires_at>clock_timestamp() AND content IS NOT NULL`, [row.attachment_ids])).rows;
        if (attachments.length !== row.attachment_ids.length) throw new ConflictException('预设附件已不可用，未执行收件人保留待处理');
        await db.query("UPDATE email_recipients SET status='submitting',submitted_at=clock_timestamp() WHERE id=$1", [row.id]);
        return {
          id: row.id,
          usageDay: row.usage_day,
          settings: {
            host: channel.smtp_host, port: channel.smtp_port, security: channel.smtp_security,
            username: channel.smtp_username, credential: this.credential(identity.organization_id, channel.credential_encrypted),
            replyTo: row.reply_to
          } as DomesticSmtpSettings,
          message: { recipientId: row.id, to: row.email, subject: row.subject, content: row.content, attachments } as SmtpMessage
        };
      });
      if (!claimed) continue;
      let result: SmtpSendResult;
      try {
        result = await this.sender.send(claimed.settings, claimed.message);
        if (!['accepted', 'not_submitted', 'uncertain'].includes(result.state) || typeof result.detail !== 'string')
          result = { state: 'uncertain', detail: '适配器返回无效结果' };
      } catch {
        result = { state: 'uncertain', detail: '提交结果不确定，保留原日额度等待证据核对' };
      }
      await transaction(this.pool, async db => {
        const row = (await db.query('SELECT status FROM email_recipients WHERE id=$1 FOR UPDATE', [claimed.id])).rows[0];
        if (row?.status !== 'submitting') return;
        await db.query('UPDATE email_recipients SET status=$2,resolved_at=clock_timestamp(),detail=$3 WHERE id=$1',
          [claimed.id, result.state, result.detail.slice(0, 500)]);
        if (result.state !== 'uncertain') {
          const used = result.state === 'accepted';
          await db.query(`UPDATE email_daily_usage SET reserved=reserved-1,used=used+$3
            WHERE organization_id=$1 AND usage_day=$2`, [identity.organization_id, claimed.usageDay, used ? 1 : 0]);
          await db.query(`INSERT INTO email_usage_events(recipient_id,event,usage_day) VALUES($1,$2,$3)`,
            [claimed.id, used ? 'used' : 'released', claimed.usageDay]);
        }
      });
    }
    return this.batch(identity, batchId);
  }
  async batch(identity: Identity, batchId: string) {
    await this.terminal(identity);
    identifier(batchId);
    const batch = (await this.pool.query(`SELECT id,preview_id AS "previewId",profile_id AS "profileId",channel_kind AS channel,
      reply_to AS "replyTo",usage_day AS "usageDay",created_at AS "createdAt" FROM email_batches
      WHERE id=$1 AND organization_id=$2`, [batchId, identity.organization_id])).rows[0];
    if (!batch) throw new NotFoundException('发送批次不存在');
    const recipients = (await this.pool.query(`SELECT id,email,mailsou_id AS "mailsouId",subject,content,status,detail,
      submitted_at AS "submittedAt",resolved_at AS "resolvedAt" FROM email_recipients WHERE batch_id=$1 ORDER BY id`, [batchId])).rows;
    return { batch, recipients };
  }
  async list(identity: Identity) {
    await this.terminal(identity);
    const rows = (await this.pool.query(`SELECT b.id,b.profile_id AS "profileId",b.channel_kind AS channel,
      b.reply_to AS "replyTo",b.usage_day AS "usageDay",b.created_at AS "createdAt",
      count(r.id)::int AS count,
      count(r.id) FILTER(WHERE r.status='accepted')::int AS accepted,
      count(r.id) FILTER(WHERE r.status IN ('uncertain','submitting'))::int AS uncertain,
      count(r.id) FILTER(WHERE r.status='paused')::int AS paused
      FROM email_batches b JOIN email_recipients r ON r.batch_id=b.id WHERE b.organization_id=$1
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100`, [identity.organization_id])).rows;
    return { batches: rows };
  }
}
