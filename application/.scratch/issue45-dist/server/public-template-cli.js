import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename, dirname, resolve } from 'node:path';
import { database } from './database.js';
import { IdentityService } from './identity/identity.js';
import { EmailPreviewService } from './email/email-preview.js';
async function scan(path) {
    const scanner = process.env.TEMPLATE_ATTACHMENT_SCANNER;
    if (!scanner)
        throw new Error('必须配置 TEMPLATE_ATTACHMENT_SCANNER；附件未经安全扫描不能预配');
    return new Promise(resolveResult => {
        const child = spawn(scanner, [path], { stdio: 'ignore', windowsHide: true, shell: false });
        child.once('error', () => resolveResult(false));
        child.once('exit', code => resolveResult(code === 0));
    });
}
const pool = database();
try {
    const token = process.env.PLATFORM_MAINTENANCE_SESSION;
    if (!token)
        throw new Error('必须提供已登录且已改密的平台管理员会话');
    const identity = await new IdentityService(pool).authenticate(token);
    const service = new EmailPreviewService(pool);
    const command = process.argv[2];
    if (command === 'provision') {
        const manifestPath = process.argv[3];
        if (!manifestPath)
            throw new Error('须提供 JSON 清单路径');
        const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        if ((manifest.attachments?.length ?? 0) + (manifest.attachmentIds?.length ?? 0) > 10)
            throw new Error('每模板最多10个附件');
        const files = [];
        for (const item of manifest.attachments ?? []) {
            const path = resolve(dirname(resolve(manifestPath)), item.path);
            const bytes = await readFile(path);
            if (bytes.length < 1 || bytes.length > 2 * 1024 * 1024)
                throw new Error('单个附件须在 1 字节至 2MB 之间');
            if (!await scan(path))
                throw new Error('附件安全扫描未通过');
            if (!bytes.equals(await readFile(path)))
                throw new Error('附件在安全扫描期间发生变化');
            files.push({ fileName: basename(path), mimeType: item.mimeType, bytes });
        }
        const result = await service.provision(identity, { ...manifest, attachments: files }, async () => true);
        console.log(JSON.stringify(result));
    }
    else if (command === 'clean-expired') {
        const id = process.argv[3];
        if (!id)
            throw new Error('须提供到期附件 UUID');
        console.log(JSON.stringify(await service.cleanExpiredAttachment(identity, id)));
    }
    else {
        throw new Error('使用 provision <manifest.json> 或 clean-expired <attachment-uuid>');
    }
}
catch (error) {
    console.error(error instanceof Error ? error.message : '公共模板维护失败');
    process.exitCode = 1;
}
finally {
    await pool.end();
}
//# sourceMappingURL=public-template-cli.js.map