import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { transaction } from './database.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const placeholder = /{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g;
function object(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('参数无效');
    return value;
}
function exact(value, required, optional = []) {
    if (required.some(key => !(key in value)) || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
        throw new BadRequestException('参数字段无效');
}
function validText(value, max) {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}
function render(source, variables) {
    return source.replace(placeholder, (_match, name) => variables[name]?.trim() ? variables[name] : `{{${name}}}`);
}
function unresolved(value) {
    return [...value.matchAll(placeholder)].map(match => match[1]);
}
export class EmailPreviewService {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async terminal(identity) {
        if (!['admin', 'sales'].includes(identity.role))
            throw new ForbiddenException('仅终端企业成员可写邮件');
        const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
        if (org?.kind !== 'terminal' || !org.active)
            throw new ForbiddenException('终端企业不可用');
    }
    async platform(identity) {
        if (identity.role !== 'platform' || identity.must_change)
            throw new ForbiddenException('仅平台管理员可维护公共模板');
        const org = (await this.pool.query('SELECT kind,active FROM organizations WHERE id=$1', [identity.organization_id])).rows[0];
        if (org?.kind !== 'platform' || !org.active)
            throw new ForbiddenException('平台身份不可用');
    }
    async confirmOwnership(identity, body) {
        await this.terminal(identity);
        const input = object(body);
        exact(input, ['contactId', 'reason']);
        if (typeof input.contactId !== 'string' || !uuid.test(input.contactId) || !validText(input.reason, 500))
            throw new BadRequestException('须逐条选择联系人并填写确认说明');
        const reason = input.reason;
        return transaction(this.pool, async (db) => {
            const contact = (await db.query(`SELECT id,returned_company_name,ownership_status FROM company_contacts
        WHERE id=$1 AND organization_id=$2 FOR UPDATE`, [input.contactId, identity.organization_id])).rows[0];
            if (!contact)
                throw new NotFoundException('联系人不存在');
            if (contact.ownership_status !== 'pending')
                throw new ConflictException('仅归属待核实联系人需要确认');
            const found = await db.query('SELECT contact_id,reason,source_returned_company_name FROM contact_ownership_confirmations WHERE contact_id=$1', [contact.id]);
            if (found.rowCount && found.rows[0].source_returned_company_name === contact.returned_company_name)
                return { contactId: contact.id, reason: found.rows[0].reason };
            await db.query(`INSERT INTO contact_ownership_confirmations(contact_id,organization_id,source_returned_company_name,confirmed_by,reason)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(contact_id) DO UPDATE SET
        source_returned_company_name=EXCLUDED.source_returned_company_name,confirmed_by=EXCLUDED.confirmed_by,
        reason=EXCLUDED.reason,confirmed_at=clock_timestamp()`, [contact.id, identity.organization_id, contact.returned_company_name, identity.id, reason.trim()]);
            return { contactId: contact.id, reason: reason.trim() };
        });
    }
    async markUnsubscribed(identity, body) {
        await this.terminal(identity);
        const input = object(body);
        exact(input, ['contactId', 'unsubscribed']);
        if (typeof input.contactId !== 'string' || !uuid.test(input.contactId) || typeof input.unsubscribed !== 'boolean')
            throw new BadRequestException('退订标记参数无效');
        const updated = await this.pool.query(`UPDATE company_contacts SET unsubscribed=$3
      WHERE id=$1 AND organization_id=$2 RETURNING id,unsubscribed`, [input.contactId, identity.organization_id, input.unsubscribed]);
        if (!updated.rowCount)
            throw new NotFoundException('联系人不存在');
        return updated.rows[0];
    }
    async templates(identity) {
        await this.terminal(identity);
        const rows = await this.pool.query(`SELECT t.id,t.name,v.version,v.subject,v.content,v.attachment_ids AS "attachmentIds",
      (SELECT coalesce(json_agg(json_build_object('id',a.id,'fileName',a.file_name,'mimeType',a.mime_type,'byteSize',a.byte_size)
        ORDER BY a.file_name),'[]'::json) FROM public_template_attachments a WHERE a.id=ANY(v.attachment_ids)) AS attachments
      FROM public_templates t JOIN public_template_versions v ON v.template_id=t.id AND v.version=t.current_version
      ORDER BY t.name`);
        return { templates: rows.rows };
    }
    async provision(identity, input, scan) {
        await this.platform(identity);
        if (!validText(input.name, 120) || !validText(input.subject, 500) || !validText(input.content, 50000) ||
            input.templateId !== undefined && !uuid.test(input.templateId) ||
            !Array.isArray(input.attachmentIds ?? []) || !Array.isArray(input.attachments ?? []))
            throw new BadRequestException('模板内容无效');
        const references = input.attachmentIds ?? [];
        const incoming = input.attachments ?? [];
        if (references.length + incoming.length > 10 || new Set(references).size !== references.length || references.some(id => !uuid.test(id)))
            throw new BadRequestException('每模板最多10个不同附件');
        if (incoming.some(file => !validText(file.fileName, 255) || !validText(file.mimeType, 255) ||
            !Buffer.isBuffer(file.bytes) || file.bytes.length < 1 || file.bytes.length > 2 * 1024 * 1024))
            throw new BadRequestException('单个附件须不超过2MB且包含名称和MIME类型');
        for (const file of incoming) {
            if (!await scan(file.bytes, file.fileName))
                throw new ConflictException('附件安全扫描未通过');
        }
        return transaction(this.pool, async (db) => {
            const existing = references.length ? (await db.query(`SELECT id,byte_size FROM public_template_attachments
        WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL AND expires_at>clock_timestamp() AND content IS NOT NULL`, [references])).rows : [];
            if (existing.length !== references.length)
                throw new BadRequestException('预设附件引用无效或已到期');
            const total = existing.reduce((sum, row) => sum + Number(row.byte_size), 0) + incoming.reduce((sum, file) => sum + file.bytes.length, 0);
            if (total > 20 * 1024 * 1024)
                throw new BadRequestException('模板附件总量不得超过20MB');
            let templateId = input.templateId;
            let version = 1;
            if (templateId) {
                const template = (await db.query('SELECT name,current_version FROM public_templates WHERE id=$1 FOR UPDATE', [templateId])).rows[0];
                if (!template)
                    throw new NotFoundException('公共模板不存在');
                if (template.name !== input.name)
                    throw new ConflictException('版本更新不得改变模板名称');
                version = template.current_version + 1;
                await db.query('UPDATE public_templates SET current_version=$2 WHERE id=$1', [templateId, version]);
            }
            else {
                templateId = randomUUID();
                await db.query('INSERT INTO public_templates(id,name,current_version) VALUES($1,$2,1)', [templateId, input.name]);
            }
            const ids = [...references];
            for (const file of incoming) {
                const id = randomUUID();
                const sha = createHash('sha256').update(file.bytes).digest('hex');
                await db.query(`INSERT INTO public_template_attachments(id,sha256,file_name,mime_type,byte_size,content,scanned_at,created_by)
          VALUES($1,$2,$3,$4,$5,$6,clock_timestamp(),$7)`, [id, sha, file.fileName, file.mimeType, file.bytes.length, file.bytes, identity.id]);
                ids.push(id);
            }
            await db.query(`INSERT INTO public_template_versions(template_id,version,subject,content,attachment_ids,created_by)
        VALUES($1,$2,$3,$4,$5,$6)`, [templateId, version, input.subject, input.content, ids, identity.id]);
            await db.query(`INSERT INTO public_template_audit(actor_id,event,template_id,version)
        VALUES($1,'version_created',$2,$3)`, [identity.id, templateId, version]);
            return { templateId, version, attachmentIds: ids };
        });
    }
    async cleanExpiredAttachment(identity, attachmentId) {
        await this.platform(identity);
        if (!uuid.test(attachmentId))
            throw new BadRequestException('附件标识无效');
        return transaction(this.pool, async (db) => {
            const attachment = (await db.query('SELECT id,expires_at,cleaned_at FROM public_template_attachments WHERE id=$1 FOR UPDATE', [attachmentId])).rows[0];
            if (!attachment)
                throw new NotFoundException('附件不存在');
            if (attachment.cleaned_at)
                return { attachmentId, cleaned: true };
            if (new Date(attachment.expires_at).getTime() > Date.now())
                throw new ConflictException('附件尚未到期');
            await db.query('UPDATE public_template_attachments SET content=NULL,cleaned_at=clock_timestamp() WHERE id=$1', [attachmentId]);
            await db.query(`INSERT INTO public_template_audit(actor_id,event,attachment_id) VALUES($1,'attachment_cleaned',$2)`, [identity.id, attachmentId]);
            return { attachmentId, cleaned: true };
        });
    }
    async saveDraft(identity, body) {
        await this.terminal(identity);
        const input = object(body);
        exact(input, ['profileId', 'templateId', 'templateVersion', 'subject', 'content', 'selections'], ['draftId']);
        if (typeof input.profileId !== 'string' || !uuid.test(input.profileId) ||
            typeof input.templateId !== 'string' || !uuid.test(input.templateId) ||
            !Number.isInteger(input.templateVersion) || Number(input.templateVersion) < 1 ||
            !validText(input.subject, 500) || !validText(input.content, 50000) ||
            input.draftId !== undefined && (typeof input.draftId !== 'string' || !uuid.test(input.draftId)) ||
            !Array.isArray(input.selections) || input.selections.length < 1 || input.selections.length > 200)
            throw new BadRequestException('邮件草稿参数无效');
        const selections = input.selections;
        for (const selection of selections) {
            const item = object(selection);
            exact(item, ['contactId', 'emailKind', 'variables'], ['variableSourceContactId', 'confirmUnsubscribed']);
            if (typeof selection.contactId !== 'string' || !uuid.test(selection.contactId) ||
                !['company', 'personal'].includes(selection.emailKind) ||
                selection.variableSourceContactId !== undefined && !uuid.test(selection.variableSourceContactId) ||
                selection.confirmUnsubscribed !== undefined && typeof selection.confirmUnsubscribed !== 'boolean' ||
                !selection.variables || typeof selection.variables !== 'object' || Array.isArray(selection.variables) ||
                Object.keys(selection.variables).length > 30 ||
                Object.entries(selection.variables).some(([key, value]) => !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) || typeof value !== 'string' || value.length > 500))
                throw new BadRequestException('收件人选择或变量无效');
        }
        if (new Set(selections.map(item => item.contactId)).size !== selections.length)
            throw new BadRequestException('同一联系人不能重复选择');
        return transaction(this.pool, async (db) => {
            const profile = (await db.query('SELECT id FROM company_profiles WHERE id=$1 AND organization_id=$2', [input.profileId, identity.organization_id])).rows[0];
            if (!profile)
                throw new NotFoundException('档案不存在');
            const template = (await db.query('SELECT 1 FROM public_template_versions WHERE template_id=$1 AND version=$2', [input.templateId, input.templateVersion])).rows[0];
            if (!template)
                throw new NotFoundException('公共模板版本不存在');
            const draftId = typeof input.draftId === 'string' ? input.draftId : randomUUID();
            if (input.draftId) {
                const updated = await db.query(`UPDATE email_drafts SET subject=$4,content=$5,selections=$6,updated_at=clock_timestamp()
          WHERE id=$1 AND organization_id=$2 AND actor_id=$3 AND profile_id=$7 AND template_id=$8 AND template_version=$9 RETURNING id`, [draftId, identity.organization_id, identity.id, input.subject, input.content, JSON.stringify(selections), input.profileId, input.templateId, input.templateVersion]);
                if (!updated.rowCount)
                    throw new NotFoundException('本人的草稿不存在或模板已改变');
            }
            else {
                await db.query(`INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,selections)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [draftId, identity.organization_id, identity.id, input.profileId, input.templateId, input.templateVersion,
                    input.subject, input.content, JSON.stringify(selections)]);
            }
            return { draftId };
        });
    }
    async preview(identity, body) {
        await this.terminal(identity);
        const input = object(body);
        exact(input, ['draftId']);
        if (typeof input.draftId !== 'string' || !uuid.test(input.draftId))
            throw new BadRequestException('草稿标识无效');
        return transaction(this.pool, async (db) => {
            const draft = (await db.query('SELECT * FROM email_drafts WHERE id=$1 AND organization_id=$2 AND actor_id=$3 FOR UPDATE', [input.draftId, identity.organization_id, identity.id])).rows[0];
            if (!draft)
                throw new NotFoundException('本人的草稿不存在');
            const profile = (await db.query('SELECT name FROM company_profiles WHERE id=$1 AND organization_id=$2', [draft.profile_id, identity.organization_id])).rows[0];
            if (!profile)
                throw new NotFoundException('档案不存在');
            const version = (await db.query('SELECT attachment_ids FROM public_template_versions WHERE template_id=$1 AND version=$2', [draft.template_id, draft.template_version])).rows[0];
            if (!version)
                throw new NotFoundException('模板版本不存在');
            const attachments = (await db.query(`SELECT id,file_name AS "fileName",mime_type AS "mimeType",byte_size AS "byteSize"
        FROM public_template_attachments WHERE id=ANY($1::uuid[]) AND cleaned_at IS NULL AND expires_at>clock_timestamp()
        AND content IS NOT NULL`, [version.attachment_ids])).rows;
            if (attachments.length !== version.attachment_ids.length)
                throw new ConflictException('模板预设附件已到期或不可用');
            const selections = draft.selections;
            const ids = selections.map(item => item.contactId);
            const contacts = (await db.query(`SELECT c.id,c.mailsou_id,c.email,c.personal_email,c.unsubscribed,c.ownership_status,
        x.contact_id AS confirmed,x.source_returned_company_name AS confirmed_company,c.returned_company_name
        FROM company_contacts c LEFT JOIN contact_ownership_confirmations x ON x.contact_id=c.id
        WHERE c.id=ANY($1::uuid[]) AND c.organization_id=$2 AND c.profile_id=$3`, [ids, identity.organization_id, draft.profile_id])).rows;
            if (contacts.length !== selections.length)
                throw new NotFoundException('选定联系人不属于当前档案');
            const byId = new Map(contacts.map(contact => [contact.id, contact]));
            const groups = new Map();
            for (const selection of selections) {
                const contact = byId.get(selection.contactId);
                if (contact.ownership_status === 'pending' && (!contact.confirmed || contact.confirmed_company !== contact.returned_company_name))
                    throw new ConflictException('归属不一致联系人须逐条说明确认');
                const email = selection.emailKind === 'company' ? contact.email : contact.personal_email;
                if (typeof email !== 'string' || !emailPattern.test(email))
                    throw new ConflictException('所选邮箱为空或无效；个人邮箱不会自动兜底');
                if (contact.unsubscribed && selection.confirmUnsubscribed !== true)
                    throw new ConflictException('退订联系人须再次确认提示');
                const key = email.toLowerCase();
                groups.set(key, [...groups.get(key) ?? [], { selection, contact, email }]);
            }
            const recipients = [];
            for (const group of groups.values()) {
                const variants = new Set(group.map(item => JSON.stringify(item.selection.variables)));
                const chosenId = group[0].selection.variableSourceContactId;
                if (group.some(item => item.selection.variableSourceContactId !== chosenId))
                    throw new ConflictException('同邮箱变量来源选择不一致');
                if (variants.size > 1 && !chosenId)
                    throw new ConflictException('同邮箱模板变量冲突，须手选来源联系人');
                const chosen = chosenId ? group.find(item => item.contact.id === chosenId) : group[0];
                if (!chosen)
                    throw new ConflictException('变量来源必须是此邮箱对应的已选联系人');
                const vars = { companyName: profile.name, ...chosen.selection.variables };
                const subject = render(draft.subject, vars);
                const content = render(draft.content, vars);
                const missing = [...new Set([...unresolved(subject), ...unresolved(content)])];
                if (missing.length)
                    throw new ConflictException(`模板变量未补全：${missing.join('、')}`);
                recipients.push({
                    email: chosen.email,
                    emailKey: chosen.email.toLowerCase(),
                    contactId: chosen.contact.id,
                    mailsouId: chosen.contact.mailsou_id,
                    variableSourceContactId: chosen.contact.id,
                    sourceContactIds: group.map(item => item.contact.id),
                    unsubscribedContactIds: group.filter(item => item.contact.unsubscribed).map(item => item.contact.id),
                    subject,
                    content
                });
            }
            const previewId = randomUUID();
            await db.query(`INSERT INTO email_previews(id,organization_id,actor_id,profile_id,template_id,template_version,
        subject,content,attachment_ids,recipient_snapshot,preview_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [previewId, identity.organization_id, identity.id, draft.profile_id, draft.template_id, draft.template_version,
                draft.subject, draft.content, version.attachment_ids, JSON.stringify(selections), JSON.stringify(recipients)]);
            return { previewId, templateId: draft.template_id, templateVersion: draft.template_version,
                profileId: draft.profile_id, attachmentIds: version.attachment_ids, attachments, recipients };
        });
    }
}
//# sourceMappingURL=email-preview.js.map