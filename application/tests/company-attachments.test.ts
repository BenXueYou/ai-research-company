import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/policy.js';
import { testDatabase } from './helpers.js';

test('T18 private attachments, tenant and record scope, limits, audit and compensation', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'company-attachments-t18-'));
  const scanner = join(temporary, 'scanner.mjs');
  await writeFile(scanner, "import { readFileSync } from 'node:fs'; const bytes=readFileSync(process.argv.at(-1)); process.exit(bytes.includes(Buffer.from('unsafe')) ? 1 : 0);\n");
  process.env.COMPANY_ATTACHMENT_STORAGE_DIR = join(temporary, 'private');
  process.env.COMPANY_ATTACHMENT_SCANNER = process.execPath;
  process.env.COMPANY_ATTACHMENT_SCANNER_ARGS = JSON.stringify([scanner]);
  const { pool } = await testDatabase();
  const origin = 'http://127.0.0.1:3188';
  const app = await createApplication(pool, origin);
  await app.listen(3188, '127.0.0.1');
  async function account(label: string, organizationId: string, role: 'admin' | 'sales') {
    const id = randomUUID();
    const email = `t18-${label}@example.com`;
    const password = `t18-${label}-password-2026`;
    await pool.query('INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,false)',
      [id, organizationId, email, await hashPassword(password), role]);
    const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json'
    }, body: JSON.stringify({ email, password }) });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return { id, cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  type Session = Awaited<ReturnType<typeof account>>;
  async function post(session: Session, path: string, body: Record<string, unknown>) {
    return fetch(`${origin}/api/${path}`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf
    }, body: JSON.stringify(body) });
  }
  async function organization(label: string) {
    const parent = randomUUID();
    const id = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'platform')", [parent, `${label} parent`]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'terminal',$3,'encrypted',$4,'***')`, [id, label, parent, label]);
    return id;
  }
  async function profile(organizationId: string, actorId: string, detailId: string) {
    const searchId = randomUUID();
    const candidateId = randomUUID();
    const queryId = randomUUID();
    const id = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'Search Name','TUR',1,20,1,'verified')`, [searchId, organizationId, actorId]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'list-id-different','Company Name','TUR','verified')`, [candidateId, searchId, organizationId]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'Company Name','TUR',1,1,$5,'settled')`, [queryId, organizationId, actorId, candidateId, randomUUID()]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,$3,'Company Name','TUR','{}',$4)`, [id, organizationId, detailId, queryId]);
    return id;
  }
  const pdf = Buffer.from('%PDF-1.4\nT18 archived content\n');
  try {
    const orgA = await organization('t18-a');
    const orgB = await organization('t18-b');
    const admin = await account('admin', orgA, 'admin');
    const sales = await account('sales', orgA, 'sales');
    const other = await account('other', orgB, 'admin');
    const profileId = await profile(orgA, admin.id, 'detail-id-different');
    const otherProfileId = await profile(orgB, other.id, 'detail-id-other');
    const record = await post(sales, 'company-timeline/create', {
      profileId, type: 'whatsapp', eventTime: '2026-10-26T10:00:00.000Z',
      contactOrPhone: '+86 138-1234-5678', content: '人工沟通'
    });
    assert.equal(record.status, 200);
    const recordId = (await record.json() as { id: string }).id;
    const upload = (targetProfile: string, communicationId?: string, bytes = pdf, fileName = 'chat.pdf', mimeType = 'application/pdf') => ({
      profileId: targetProfile, ...(communicationId ? { communicationId } : {}), fileName, mimeType,
      contentBase64: bytes.toString('base64')
    });
    assert.equal((await post(sales, 'company-attachments/upload', upload(profileId, otherProfileId))).status, 404);
    assert.equal((await post(sales, 'company-attachments/upload', upload(otherProfileId))).status, 404);
    assert.equal((await post(sales, 'company-attachments/upload', upload(profileId, undefined, pdf, 'chat.jpg', 'image/jpeg'))).status, 400);
    assert.equal((await post(sales, 'company-attachments/upload', upload(profileId, undefined, pdf, 'chat.exe', 'application/octet-stream'))).status, 400);
    assert.equal((await post(sales, 'company-attachments/upload', upload(profileId, undefined, Buffer.concat([pdf, Buffer.from('unsafe')])))).status, 400);
    const saved = await post(sales, 'company-attachments/upload', upload(profileId, recordId));
    assert.equal(saved.status, 200);
    const attachmentId = (await saved.json() as { id: string }).id;
    const general = await post(admin, 'company-attachments/upload', upload(profileId));
    assert.equal(general.status, 200);
    const generalId = (await general.json() as { id: string }).id;
    const listed = await (await post(sales, 'company-attachments/list', { profileId })).json() as { attachments: Array<{ id: string; communicationId: string | null }> };
    assert.equal(listed.attachments.find(item => item.id === attachmentId)?.communicationId, recordId);
    assert.equal(listed.attachments.find(item => item.id === generalId)?.communicationId, null);
    assert.equal((await post(other, 'company-attachments/list', { profileId })).status, 404);
    assert.equal((await post(other, 'company-attachments/download', { profileId, attachmentId })).status, 404);
    assert.equal((await post(sales, 'company-attachments/download', { profileId: otherProfileId, attachmentId })).status, 404);
    assert.equal((await post(sales, 'company-attachments/download', { profileId, attachmentId: generalId })).status, 200);
    const downloaded = await (await post(sales, 'company-attachments/download', { profileId, attachmentId })).json() as { contentBase64: string };
    assert.deepEqual(Buffer.from(downloaded.contentBase64, 'base64'), pdf);
    assert.equal((await post(sales, 'company-attachments/delete', { profileId, attachmentId })).status, 403);
    assert.equal((await post(admin, 'company-attachments/delete', { profileId, attachmentId })).status, 200);
    assert.equal((await post(admin, 'company-attachments/delete', { profileId, attachmentId })).status, 200);
    assert.equal((await post(sales, 'company-attachments/download', { profileId, attachmentId })).status, 404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_attachment_audit WHERE attachment_id=$1 AND action=$2',
      [attachmentId, 'delete'])).rows[0].n, 1);
    assert.equal((await pool.query('SELECT company_id,communication_id,organization_id FROM company_attachments WHERE id=$1', [attachmentId])).rows[0].company_id, profileId);
    assert.equal((await readdir(join(temporary, 'private'))).length, 2);
    const oversized = await post(sales, 'company-attachments/upload', upload(profileId, undefined,
      Buffer.alloc(20 * 1024 * 1024 + 1), 'large.pdf'));
    assert.equal(oversized.status, 400, await oversized.text());
    for (let index = 0; index < 49; index++) {
      await pool.query(`INSERT INTO company_attachments(id,organization_id,company_id,original_name,storage_key,mime_type,
        size_bytes,sha256,scanned_at,uploaded_by) VALUES($1,$2,$3,'fixture.pdf',$4,'application/pdf',1,'fixture',clock_timestamp(),$5)`,
      [randomUUID(), orgA, profileId, randomUUID(), admin.id]);
    }
    assert.equal((await post(sales, 'company-attachments/upload', upload(profileId))).status, 400);
    assert.equal((await readdir(join(temporary, 'private'))).length, 2);
    assert.equal((await post(admin, 'company-attachments/clean-expired', { profileId, attachmentId: generalId })).status, 400);
    await pool.query("UPDATE company_attachments SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [generalId]);
    assert.equal((await post(sales, 'company-attachments/clean-expired', { profileId, attachmentId: generalId })).status, 403);
    assert.equal((await post(admin, 'company-attachments/clean-expired', { profileId, attachmentId: generalId })).status, 200);
    assert.equal((await post(admin, 'company-attachments/clean-expired', { profileId, attachmentId: generalId })).status, 200);
    assert.equal((await post(sales, 'company-attachments/download', { profileId, attachmentId: generalId })).status, 404);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_attachment_audit WHERE attachment_id=$1 AND action=$2',
      [generalId, 'clean_expired'])).rows[0].n, 1);
    assert.equal((await readdir(join(temporary, 'private'))).length, 1);
  } finally {
    await app.close();
    await pool.end();
    await rm(temporary, { recursive: true, force: true });
  }
});
