import { BadRequestException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { transaction } from '../database.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BYTES = 20 * 1024 * 1024;
const MIME = {
    jpg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'],
    pdf: ['application/pdf'], doc: ['application/msword'],
    docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    xls: ['application/vnd.ms-excel'],
    xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ppt: ['application/vnd.ms-powerpoint'],
    pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'],
    zip: ['application/zip', 'application/x-zip-compressed'],
    rar: ['application/vnd.rar', 'application/x-rar-compressed']
};
function inputObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new BadRequestException('附件参数无效');
    return value;
}
function identifier(value) {
    if (typeof value !== 'string' || !UUID.test(value))
        throw new BadRequestException('标识无效');
    return value;
}
function exactKeys(input, required, optional = []) {
    if (required.some(key => !(key in input)) || Object.keys(input).some(key => !required.includes(key) && !optional.includes(key)))
        throw new BadRequestException('附件参数无效');
}
function signature(extension, bytes) {
    if (extension === 'jpg')
        return bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (extension === 'png')
        return bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
    if (extension === 'webp')
        return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (extension === 'pdf')
        return bytes.toString('ascii', 0, 5) === '%PDF-';
    if (['doc', 'xls', 'ppt'].includes(extension))
        return bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
    if (['docx', 'xlsx', 'pptx', 'zip'].includes(extension)) {
        if (!bytes.subarray(0, 4).equals(Buffer.from('504b0304', 'hex')))
            return false;
        if (extension === 'zip')
            return true;
        const marker = extension === 'docx' ? 'word/' : extension === 'xlsx' ? 'xl/' : 'ppt/';
        return bytes.includes(Buffer.from('[Content_Types].xml')) && bytes.includes(Buffer.from(marker));
    }
    if (extension === 'rar')
        return bytes.subarray(0, 7).equals(Buffer.from('526172211a0700', 'hex')) ||
            bytes.subarray(0, 8).equals(Buffer.from('526172211a070100', 'hex'));
    return false;
}
function decode(input) {
    const name = input.fileName;
    const mimeType = input.mimeType;
    const content = input.contentBase64;
    if (typeof name !== 'string' || !name || name.length > 255 || basename(name) !== name || /[\\/\x00-\x1f]/.test(name))
        throw new BadRequestException('文件名无效');
    const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
    if (typeof mimeType !== 'string' || !MIME[extension]?.includes(mimeType))
        throw new BadRequestException('文件格式或 MIME 不受支持');
    if (typeof content !== 'string' || content.length > Math.ceil(MAX_BYTES / 3) * 4 ||
        content.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(content))
        throw new BadRequestException('附件内容无效或超过20MB');
    const bytes = Buffer.from(content, 'base64');
    if (!bytes.length || bytes.length > MAX_BYTES || bytes.toString('base64') !== content || !signature(extension, bytes))
        throw new BadRequestException('附件大小或文件内容与格式不符');
    return { name, mimeType, bytes };
}
async function scan(path) {
    const scanner = process.env.COMPANY_ATTACHMENT_SCANNER;
    if (!scanner)
        throw new ServiceUnavailableException('未配置附件安全扫描');
    let scannerArgs = [];
    try {
        const configured = JSON.parse(process.env.COMPANY_ATTACHMENT_SCANNER_ARGS ?? '[]');
        if (!Array.isArray(configured) || configured.some(item => typeof item !== 'string'))
            throw new Error('invalid');
        scannerArgs = configured;
    }
    catch {
        throw new ServiceUnavailableException('附件扫描参数配置无效');
    }
    const passed = await new Promise(done => {
        const child = spawn(scanner, [...scannerArgs, path], { shell: false, windowsHide: true, stdio: 'ignore' });
        const timeout = setTimeout(() => child.kill(), 30_000);
        child.once('error', () => { clearTimeout(timeout); done(false); });
        child.once('exit', code => { clearTimeout(timeout); done(code === 0); });
    });
    if (!passed)
        throw new BadRequestException('附件安全扫描未通过');
}
export class CompanyAttachmentService {
    pool;
    storageRoot;
    constructor(pool, storageRoot = process.env.COMPANY_ATTACHMENT_STORAGE_DIR) {
        this.pool = pool;
        this.storageRoot = storageRoot;
    }
    root() {
        if (!this.storageRoot || !isAbsolute(this.storageRoot))
            throw new ServiceUnavailableException('未配置绝对路径附件私有存储');
        const root = resolve(this.storageRoot);
        const publicRoot = resolve('dist/web');
        if (root === publicRoot || root.startsWith(`${publicRoot}${sep}`))
            throw new ServiceUnavailableException('附件存储不得位于公开目录');
        return root;
    }
    async authorize(identity, profileId) {
        if (!['admin', 'sales'].includes(identity.role))
            throw new ForbiddenException('仅终端企业成员可访问附件');
        const result = await this.pool.query(`SELECT p.id FROM company_profiles p JOIN organizations o ON o.id=p.organization_id
      WHERE p.id=$1 AND p.organization_id=$2 AND p.deleted_at IS NULL AND o.kind='terminal' AND o.active`, [profileId, identity.organization_id]);
        if (!result.rowCount)
            throw new NotFoundException('档案不存在');
    }
    async list(identity, body) {
        const input = inputObject(body);
        exactKeys(input, ['profileId']);
        const profileId = identifier(input.profileId);
        await this.authorize(identity, profileId);
        const rows = await this.pool.query(`SELECT id,communication_id AS "communicationId",original_name AS "fileName",
      mime_type AS "mimeType",size_bytes AS "sizeBytes",uploaded_by AS "uploadedBy",created_at AS "createdAt",
      expires_at AS "expiresAt",expires_at <= clock_timestamp() AS expired,deleted_at IS NOT NULL AS deleted
      FROM company_attachments WHERE organization_id=$1 AND company_id=$2 AND cleaned_at IS NULL
      AND (deleted_at IS NULL OR ($3::boolean AND expires_at <= clock_timestamp()))
      ORDER BY created_at DESC,id DESC`, [identity.organization_id, profileId, identity.role === 'admin']);
        return { attachments: rows.rows };
    }
    async upload(identity, body) {
        const input = inputObject(body);
        exactKeys(input, ['profileId', 'fileName', 'mimeType', 'contentBase64'], ['communicationId']);
        const profileId = identifier(input.profileId);
        const communicationId = input.communicationId === undefined ? null : identifier(input.communicationId);
        const file = decode(input);
        await this.authorize(identity, profileId);
        const root = this.root();
        await mkdir(root, { recursive: true, mode: 0o700 });
        const id = randomUUID();
        const key = randomUUID();
        const temporary = join(root, `${key}.pending`);
        const final = join(root, key);
        await writeFile(temporary, file.bytes, { flag: 'wx', mode: 0o600 });
        let moved = false;
        try {
            await scan(temporary);
            if (!file.bytes.equals(await readFile(temporary)))
                throw new BadRequestException('扫描期间附件内容发生变化');
            await transaction(this.pool, async (db) => {
                await db.query('SELECT id FROM organizations WHERE id=$1 FOR UPDATE', [identity.organization_id]);
                if (communicationId) {
                    const record = await db.query(`SELECT id FROM timeline_manual_records WHERE id=$1 AND organization_id=$2
            AND company_id=$3 AND deleted_at IS NULL FOR SHARE`, [communicationId, identity.organization_id, profileId]);
                    if (!record.rowCount)
                        throw new NotFoundException('人工记录不存在或不属于本档案');
                }
                const count = await db.query(`SELECT count(*)::int AS total FROM company_attachments
          WHERE organization_id=$1 AND deleted_at IS NULL AND cleaned_at IS NULL`, [identity.organization_id]);
                if (count.rows[0].total >= 50)
                    throw new BadRequestException('每企业最多50个附件');
                await rename(temporary, final);
                moved = true;
                await db.query(`INSERT INTO company_attachments(id,organization_id,company_id,communication_id,original_name,
          storage_key,mime_type,size_bytes,sha256,scanned_at,uploaded_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,clock_timestamp(),$10)`, [id, identity.organization_id, profileId,
                    communicationId, file.name, key, file.mimeType, file.bytes.length, createHash('sha256').update(file.bytes).digest('hex'), identity.id]);
                await db.query("INSERT INTO company_attachment_audit(attachment_id,actor_id,action) VALUES($1,$2,'upload')", [id, identity.id]);
            });
            return { id };
        }
        catch (error) {
            await unlink(moved ? final : temporary).catch(() => undefined);
            throw error;
        }
    }
    async download(identity, body) {
        const input = inputObject(body);
        exactKeys(input, ['profileId', 'attachmentId']);
        const profileId = identifier(input.profileId);
        const id = identifier(input.attachmentId);
        await this.authorize(identity, profileId);
        const row = (await this.pool.query(`SELECT storage_key,original_name,mime_type,size_bytes,sha256
      FROM company_attachments WHERE id=$1 AND organization_id=$2 AND company_id=$3 AND deleted_at IS NULL AND cleaned_at IS NULL`, [id, identity.organization_id, profileId])).rows[0];
        if (!row)
            throw new NotFoundException('附件不存在');
        let bytes;
        try {
            bytes = await readFile(join(this.root(), row.storage_key));
        }
        catch {
            throw new ServiceUnavailableException('附件内容不可用');
        }
        if (bytes.length !== row.size_bytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256)
            throw new ServiceUnavailableException('附件完整性校验失败');
        await this.pool.query("INSERT INTO company_attachment_audit(attachment_id,actor_id,action) VALUES($1,$2,'download')", [id, identity.id]);
        return { fileName: row.original_name, mimeType: row.mime_type, contentBase64: bytes.toString('base64') };
    }
    async remove(identity, body) {
        const input = inputObject(body);
        exactKeys(input, ['profileId', 'attachmentId']);
        const profileId = identifier(input.profileId);
        const id = identifier(input.attachmentId);
        await this.authorize(identity, profileId);
        if (identity.role !== 'admin')
            throw new ForbiddenException('仅企业管理员可删除附件');
        return transaction(this.pool, async (db) => {
            const row = (await db.query(`SELECT deleted_at FROM company_attachments WHERE id=$1 AND organization_id=$2 AND company_id=$3 FOR UPDATE`, [id, identity.organization_id, profileId])).rows[0];
            if (!row)
                throw new NotFoundException('附件不存在');
            if (!row.deleted_at) {
                await db.query('UPDATE company_attachments SET deleted_by=$2,deleted_at=clock_timestamp() WHERE id=$1', [id, identity.id]);
                await db.query("INSERT INTO company_attachment_audit(attachment_id,actor_id,action) VALUES($1,$2,'delete')", [id, identity.id]);
            }
            return { id, deleted: true };
        });
    }
    async cleanExpired(identity, body) {
        const input = inputObject(body);
        exactKeys(input, ['profileId', 'attachmentId']);
        const profileId = identifier(input.profileId);
        const id = identifier(input.attachmentId);
        await this.authorize(identity, profileId);
        if (identity.role !== 'admin')
            throw new ForbiddenException('仅企业管理员可清理到期附件');
        let pending = '';
        let stored = '';
        let moved = false;
        let result;
        try {
            result = await transaction(this.pool, async (db) => {
                const row = (await db.query(`SELECT storage_key,expires_at,cleaned_at FROM company_attachments
        WHERE id=$1 AND organization_id=$2 AND company_id=$3 FOR UPDATE`, [id, identity.organization_id, profileId])).rows[0];
                if (!row)
                    throw new NotFoundException('附件不存在');
                if (new Date(row.expires_at).getTime() > Date.now())
                    throw new BadRequestException('附件尚未到期');
                pending = join(this.root(), `${row.storage_key}.cleaning`);
                if (row.cleaned_at)
                    return { id, cleaned: true };
                stored = join(this.root(), row.storage_key);
                try {
                    await rename(stored, pending);
                }
                catch {
                    throw new ServiceUnavailableException('附件内容不可用，不能完成清理');
                }
                moved = true;
                await db.query(`UPDATE company_attachments SET cleaned_by=$2,cleaned_at=clock_timestamp(),
        deleted_by=coalesce(deleted_by,$2),deleted_at=coalesce(deleted_at,clock_timestamp()) WHERE id=$1`, [id, identity.id]);
                await db.query("INSERT INTO company_attachment_audit(attachment_id,actor_id,action) VALUES($1,$2,'clean_expired')", [id, identity.id]);
                return { id, cleaned: true };
            });
        }
        catch (error) {
            if (moved)
                await rename(pending, stored).catch(() => undefined);
            throw error;
        }
        await unlink(pending).catch(error => {
            if (error.code !== 'ENOENT')
                throw new ServiceUnavailableException('到期附件清理待重试');
        });
        return result;
    }
}
//# sourceMappingURL=company-attachments.js.map