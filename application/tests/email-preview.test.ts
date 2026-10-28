import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { EmailPreviewService } from '../server/email/email-preview.js';
import { hashPassword } from '../server/identity/policy.js';
import { testDatabase } from './helpers.js';
import type { Identity } from '../server/identity/identity.js';

test('T21 ownership, address source, dedup conflict, unsubscribe and immutable preview', async () => {
  const { pool } = await testDatabase();
  const origin = 'http://127.0.0.1:3111';
  const previewService = new EmailPreviewService(pool);
  const platformOrg = randomUUID();
  const platformId = randomUUID();
  const org = randomUUID();
  const actor = randomUUID();
  const otherOrg = randomUUID();
  const otherActor = randomUUID();
  const platform: Identity = { id: platformId, organization_id: platformOrg, role: 'platform',
    email: null, username: 'super_admin', csrf_hash: '', must_change: false };
  const templateName = `Intro ${randomUUID()}`;
  await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'Platform','platform')", [platformOrg]);
  await pool.query("INSERT INTO accounts(id,organization_id,username,password_hash,role,must_change) VALUES($1,$2,'super_admin',$3,'platform',false)",
    [platformId, platformOrg, await hashPassword('platform-test-password')]);
  await pool.query('INSERT INTO bootstrap_marker(account_id) VALUES($1)', [platformId]);
  for (const [organization, id, label] of [[org, actor, 'alpha'], [otherOrg, otherActor, 'beta']] as const) {
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'terminal',$3,$4,$5,'***')`, [organization, label, platformOrg, `enc-${label}`, `phone-${label}`]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,'admin',false)`, [id, organization, `${label}@example.com`, await hashPassword(`${label}-test-password-2026`)]);
  }
  const one = Buffer.from('scanned-attachment');
  assert.equal((await previewService.provision(platform, { name: templateName, subject: 'Hello {{contactName}}',
    content: '{{companyName}} to {{contactName}}', attachments: [{ fileName: 'offer.any', mimeType: 'application/octet-stream', bytes: one }] },
  async () => false).catch(() => 'rejected')), 'rejected');
  const first = await previewService.provision(platform, { name: templateName, subject: 'Hello {{contactName}}',
    content: '{{companyName}} to {{contactName}}', attachments: [{ fileName: 'offer.any', mimeType: 'application/octet-stream', bytes: one }] },
  async () => true);
  assert.equal(first.version, 1);
  await assert.rejects(previewService.provision({ ...platform, id: actor, organization_id: org, role: 'admin' },
    { name: 'Unauthorized', subject: 'x', content: 'y' }, async () => true));
  await assert.rejects(previewService.provision(platform, { name: 'Oversize', subject: 'x', content: 'y',
    attachments: [{ fileName: 'big', mimeType: 'application/octet-stream', bytes: Buffer.alloc(2 * 1024 * 1024 + 1) }] }, async () => true));
  await assert.rejects(previewService.provision(platform, { name: 'Too many', subject: 'x', content: 'y',
    attachmentIds: Array.from({ length: 11 }, () => randomUUID()) }, async () => true));
  const second = await previewService.provision(platform, { templateId: first.templateId, name: templateName,
    subject: 'Updated {{contactName}}', content: 'New {{companyName}}', attachmentIds: first.attachmentIds }, async () => true);
  assert.equal(second.version, 2);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM public_template_audit')).rows[0].n, 2);
  const searchId = randomUUID();
  const candidateId = randomUUID();
  const detailId = randomUUID();
  const profileId = randomUUID();
  const queryId = randomUUID();
  await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
    VALUES($1,$2,$3,'Search','TUR',1,20,1,'verified')`, [searchId, org, actor]);
  await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
    VALUES($1,$2,$3,'list-id-111','Target Ltd','TUR','verified')`, [candidateId, searchId, org]);
  await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,
    coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Target Ltd','TUR',1,1,$5,'settled')`,
  [detailId, org, actor, candidateId, randomUUID()]);
  await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
    VALUES($1,$2,'detail-data-id-222','Target Ltd','TUR','{}',$3)`, [profileId, org, detailId]);
  await pool.query(`INSERT INTO company_contact_queries(id,organization_id,actor_id,profile_id,company_name,position_tags,
    page_no,page_size,coefficient,maximum_points,price_version,state)
    VALUES($1,$2,$3,$4,'Target Ltd','{}',1,20,1,1,$5,'settled')`, [queryId, org, actor, profileId, randomUUID()]);
  const contacts = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const rows = [
    ['mail-source-333', 'Target Ltd', 'matched', 'Sales@Example.com', 'private-1@example.org', false],
    ['mail-source-444', 'Target Ltd', 'matched', 'sales@example.com', 'private-2@example.org', true],
    ['mail-source-555', 'Other Ltd', 'pending', 'other@example.com', null, false],
    ['mail-source-666', 'Target Ltd', 'matched', null, 'only-personal@example.org', false]
  ] as const;
  for (let index = 0; index < rows.length; index++) {
    const [mailsouId, returned, status, companyEmail, personalEmail, unsubscribed] = rows[index];
    await pool.query(`INSERT INTO company_contacts(id,organization_id,profile_id,query_id,mailsou_id,query_company_name,
      returned_company_name,ownership_status,email,personal_email,unsubscribed,source_payload)
      VALUES($1,$2,$3,$4,$5,'Target Ltd',$6,$7,$8,$9,$10,$11)`,
    [contacts[index], org, profileId, queryId, mailsouId, returned, status, companyEmail, personalEmail, unsubscribed,
      JSON.stringify({ mailsouId, id: `different-id-${index}`, fileId: `different-file-${index}` })]);
  }
  const app = await createApplication(pool, origin);
  await app.listen(3111, '127.0.0.1');
  async function session(label: 'alpha' | 'beta') {
    const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json'
    }, body: JSON.stringify({ email: `${label}@example.com`, password: `${label}-test-password-2026` }) });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return { cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  type Session = Awaited<ReturnType<typeof session>>;
  async function post(auth: Session, route: string, body: object) {
    return fetch(`${origin}/api/${route}`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: auth.cookie, 'X-CSRF-Token': auth.csrf
    }, body: JSON.stringify(body) });
  }
  try {
    const alpha = await session('alpha');
    const beta = await session('beta');
    assert.equal((await post(beta, 'company-contacts/confirm-ownership', { contactId: contacts[2], reason: 'checked' })).status, 404);
    assert.equal((await post(alpha, 'company-contacts/confirm-ownership', { contactId: contacts[2], reason: '' })).status, 400);
    assert.equal((await post(alpha, 'company-contacts/confirm-ownership', { contactId: contacts[2], reason: '客户确认属于本档案' })).status, 200);
    assert.equal((await pool.query('SELECT source_returned_company_name FROM contact_ownership_confirmations')).rows[0].source_returned_company_name, 'Other Ltd');
    const listed = await (await fetch(`${origin}/api/public-templates`, { headers: { Cookie: alpha.cookie } })).json() as { templates: Array<{ id: string; version: number; subject: string }> };
    assert.deepEqual(listed.templates.map(item => [item.id, item.version, item.subject]), [[first.templateId, 2, 'Updated {{contactName}}']]);
    const selections = [
      { contactId: contacts[0], emailKind: 'company', variables: { contactName: 'Alice' } },
      { contactId: contacts[1], emailKind: 'company', variables: { contactName: 'Bob' } },
      { contactId: contacts[2], emailKind: 'company', variables: { contactName: 'Chen' } },
      { contactId: contacts[3], emailKind: 'personal', variables: { contactName: 'Dana' } }
    ];
    const saveBody = { profileId, templateId: first.templateId, templateVersion: 1,
      subject: 'Greetings {{contactName}}', content: '{{companyName}} / {{contactName}}', selections };
    assert.equal((await post(beta, 'email-drafts', saveBody)).status, 404);
    const saved = await (await post(alpha, 'email-drafts', saveBody)).json() as { draftId: string };
    assert.ok(saved.draftId);
    assert.equal((await post(alpha, 'email-drafts/preview', saved)).status, 409);
    selections[1] = { ...selections[1], confirmUnsubscribed: true } as typeof selections[number];
    assert.equal((await post(alpha, 'email-drafts', { ...saveBody, draftId: saved.draftId, selections })).status, 200);
    assert.equal((await post(alpha, 'email-drafts/preview', saved)).status, 409);
    const chosen = selections.map(item => ({ ...item,
      ...(item.contactId === contacts[0] || item.contactId === contacts[1] ? { variableSourceContactId: contacts[1] } : {}) }));
    assert.equal((await post(alpha, 'email-drafts', { ...saveBody, draftId: saved.draftId, selections: chosen })).status, 200);
    const result = await post(alpha, 'email-drafts/preview', saved);
    assert.equal(result.status, 200);
    const preview = await result.json() as { previewId: string; attachmentIds: string[]; recipients: Array<{
      email: string; mailsouId: string; sourceContactIds: string[]; variableSourceContactId: string; subject: string; content: string;
    }> };
    assert.equal(preview.recipients.length, 3);
    const duplicate = preview.recipients.find(item => item.sourceContactIds.length === 2)!;
    assert.deepEqual([duplicate.email, duplicate.mailsouId, duplicate.variableSourceContactId, duplicate.subject],
      ['sales@example.com', 'mail-source-444', contacts[1], 'Greetings Bob']);
    assert.deepEqual(preview.attachmentIds, first.attachmentIds);
    assert.equal(preview.recipients.find(item => item.mailsouId === 'mail-source-666')?.email, 'only-personal@example.org');
    assert.equal((await pool.query('SELECT subject,content FROM public_template_versions WHERE template_id=$1 AND version=1',
      [first.templateId])).rows[0].subject, 'Hello {{contactName}}');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_previews')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contact_point_ledger')).rows[0].n, 0);
    assert.equal((await post(beta, 'email-previews/confirm', { previewId: preview.previewId })).status, 404);
    assert.equal((await post(alpha, 'email-previews/confirm', { previewId: preview.previewId })).status, 200);
    const unconfirmed = await (await post(alpha, 'email-drafts/preview', saved)).json() as { previewId: string };
    assert.ok(unconfirmed.previewId);
    assert.equal((await post(alpha, 'email-drafts', { ...saveBody, draftId: saved.draftId, selections: chosen })).status, 200);
    assert.equal((await post(alpha, 'email-previews/confirm', { previewId: unconfirmed.previewId })).status, 409);
    const missing = { ...saveBody, draftId: saved.draftId, content: '{{missingVariable}}', selections: chosen };
    assert.equal((await post(alpha, 'email-drafts', missing)).status, 200);
    assert.equal((await post(alpha, 'email-drafts/preview', saved)).status, 409);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM email_previews WHERE confirmed_at IS NOT NULL')).rows[0].n, 1);
    assert.equal((await post(alpha, 'email-previews/confirm', { previewId: preview.previewId })).status, 200);
    const blank = { ...saveBody, draftId: saved.draftId, selections: chosen.map(item => ({
      ...item, variables: { contactName: '' }
    })) };
    assert.equal((await post(alpha, 'email-drafts', blank)).status, 200);
    assert.equal((await post(alpha, 'email-drafts/preview', saved)).status, 409);
  } finally {
    await app.close();
    await pool.end();
  }
});
