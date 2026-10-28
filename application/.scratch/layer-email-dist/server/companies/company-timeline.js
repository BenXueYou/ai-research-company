import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { transaction } from '../database.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const types = ['reply', 'note', 'whatsapp'];
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('记录参数无效');
    return value;
}
function identifier(value) {
    if (typeof value !== 'string' || !uuid.test(value))
        throw new BadRequestException('标识无效');
    return value;
}
function fields(value) {
    if (!types.includes(String(value.type)))
        throw new BadRequestException('记录类型无效');
    if (typeof value.eventTime !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value.eventTime) || !Number.isFinite(Date.parse(value.eventTime)))
        throw new BadRequestException('记录时间无效');
    if (typeof value.content !== 'string' || !value.content.trim() || value.content.length > 5000)
        throw new BadRequestException('摘要必填且不能超过5000字');
    if (value.type === 'note') {
        if (value.contactOrPhone !== null)
            throw new BadRequestException('备注无需联系人或号码');
    }
    else if (typeof value.contactOrPhone !== 'string' || !value.contactOrPhone.trim() || value.contactOrPhone.length > 200) {
        throw new BadRequestException('联系人或号码必填且不能超过200字');
    }
    return {
        type: value.type,
        eventTime: value.eventTime,
        content: value.content,
        contactOrPhone: value.contactOrPhone
    };
}
export class CompanyTimelineService {
    pool;
    key;
    constructor(pool, key) {
        this.pool = pool;
        this.key = key;
    }
    async authorize(identity, profileId) {
        if (!['admin', 'sales'].includes(identity.role))
            throw new ForbiddenException('仅终端企业成员可访问档案');
        const profile = (await this.pool.query(`SELECT p.id FROM company_profiles p JOIN organizations o ON o.id=p.organization_id
      WHERE p.id=$1 AND p.organization_id=$2 AND p.deleted_at IS NULL AND o.kind='terminal' AND o.active`, [profileId, identity.organization_id])).rows[0];
        if (!profile)
            throw new NotFoundException('档案不存在');
    }
    protect(recordId, organizationId, contact) {
        if (contact === null)
            return { encrypted: null, display: null };
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', this.key, iv);
        cipher.setAAD(Buffer.from(`timeline:${organizationId}:${recordId}`));
        const encrypted = Buffer.concat([cipher.update(contact, 'utf8'), cipher.final()]);
        const isNumber = contact.replace(/\D/g, '').length >= 6;
        const digits = contact.replace(/\D/g, '');
        return {
            encrypted: [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.'),
            display: isNumber ? `****${digits.slice(-4)}` : contact
        };
    }
    async list(identity, body) {
        const input = object(body);
        if (Object.keys(input).some(key => !['profileId', 'type'].includes(key)))
            throw new BadRequestException('筛选参数无效');
        const profileId = identifier(input.profileId);
        if (input.type !== undefined && ![...types, 'email'].includes(String(input.type)))
            throw new BadRequestException('筛选类型无效');
        await this.authorize(identity, profileId);
        const rows = (await this.pool.query(`SELECT id,type,event_time AS "eventTime",contact_display AS "contactOrPhone",content,
      created_by AS "createdBy",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM timeline_manual_records WHERE organization_id=$1 AND company_id=$2 AND deleted_at IS NULL
      AND ($3::text IS NULL OR type=$3) ORDER BY event_time DESC,id DESC LIMIT 500`, [identity.organization_id, profileId, input.type ?? null])).rows;
        const emails = input.type && input.type !== 'email' ? [] : (await this.pool.query(`
      SELECT r.id,'email' AS type,coalesce(r.submitted_at,b.created_at) AS "eventTime",
        r.email AS "contactOrPhone",r.subject || ' · ' || CASE r.status
          WHEN 'delivered' THEN '有证据送达'
          WHEN 'accepted' THEN '已提交发信服务'
          WHEN 'uncertain' THEN '结果待确认'
          WHEN 'not_submitted' THEN '发送失败'
          WHEN 'paused' THEN '跨日暂停'
          WHEN 'submitting' THEN '提交中待核对'
          ELSE '排队中' END AS content,
        b.actor_id AS "createdBy",b.created_at AS "createdAt",r.resolved_at AS "updatedAt"
      FROM email_recipients r JOIN email_batches b ON b.id=r.batch_id
      WHERE r.organization_id=$1 AND r.profile_id=$2 ORDER BY b.created_at DESC LIMIT 500`, [identity.organization_id, profileId])).rows;
        return { records: [...rows, ...emails].sort((a, b) => new Date(b.eventTime).getTime() - new Date(a.eventTime).getTime()).slice(0, 500) };
    }
    async create(identity, body) {
        const input = object(body);
        if (Object.keys(input).sort().join(',') !== 'contactOrPhone,content,eventTime,profileId,type')
            throw new BadRequestException('记录字段无效');
        const profileId = identifier(input.profileId);
        const entry = fields(input);
        await this.authorize(identity, profileId);
        const id = randomUUID();
        const contact = this.protect(id, identity.organization_id, entry.contactOrPhone);
        await transaction(this.pool, async (db) => {
            await db.query(`INSERT INTO timeline_manual_records(id,organization_id,company_id,type,event_time,contact_encrypted,contact_display,content,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, identity.organization_id, profileId, entry.type, entry.eventTime,
                contact.encrypted, contact.display, entry.content, identity.id]);
            await db.query("INSERT INTO timeline_manual_audit(record_id,actor_id,action) VALUES($1,$2,'create')", [id, identity.id]);
        });
        return { id };
    }
    async edit(identity, body) {
        const input = object(body);
        if (Object.keys(input).sort().join(',') !== 'contactOrPhone,content,eventTime,profileId,recordId,type')
            throw new BadRequestException('记录字段无效');
        const profileId = identifier(input.profileId);
        const recordId = identifier(input.recordId);
        const entry = fields(input);
        await this.authorize(identity, profileId);
        return transaction(this.pool, async (db) => {
            const row = (await db.query(`SELECT created_by,deleted_at FROM timeline_manual_records
        WHERE id=$1 AND company_id=$2 AND organization_id=$3 FOR UPDATE`, [recordId, profileId, identity.organization_id])).rows[0];
            if (!row || row.deleted_at)
                throw new NotFoundException('记录不存在');
            if (row.created_by !== identity.id)
                throw new ForbiddenException('仅创建人可编辑');
            const contact = this.protect(recordId, identity.organization_id, entry.contactOrPhone);
            await db.query(`UPDATE timeline_manual_records SET type=$2,event_time=$3,contact_encrypted=$4,contact_display=$5,
        content=$6,updated_at=clock_timestamp() WHERE id=$1`, [recordId, entry.type, entry.eventTime, contact.encrypted, contact.display, entry.content]);
            await db.query("INSERT INTO timeline_manual_audit(record_id,actor_id,action) VALUES($1,$2,'edit')", [recordId, identity.id]);
            return { id: recordId };
        });
    }
    async remove(identity, body) {
        const input = object(body);
        if (Object.keys(input).sort().join(',') !== 'profileId,recordId')
            throw new BadRequestException('删除参数无效');
        const profileId = identifier(input.profileId);
        const recordId = identifier(input.recordId);
        await this.authorize(identity, profileId);
        if (identity.role !== 'admin')
            throw new ForbiddenException('仅企业管理员可删除人工记录');
        return transaction(this.pool, async (db) => {
            const row = (await db.query(`SELECT deleted_at FROM timeline_manual_records
        WHERE id=$1 AND company_id=$2 AND organization_id=$3 FOR UPDATE`, [recordId, profileId, identity.organization_id])).rows[0];
            if (!row)
                throw new NotFoundException('记录不存在');
            if (!row.deleted_at) {
                await db.query('UPDATE timeline_manual_records SET deleted_by=$2,deleted_at=clock_timestamp() WHERE id=$1', [recordId, identity.id]);
                await db.query("INSERT INTO timeline_manual_audit(record_id,actor_id,action) VALUES($1,$2,'delete')", [recordId, identity.id]);
            }
            return { id: recordId, deleted: true };
        });
    }
}
//# sourceMappingURL=company-timeline.js.map