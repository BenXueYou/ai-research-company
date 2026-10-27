import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { createApplication } from '../../server/app.js';
import { hashPassword } from '../../server/policy.js';
import { testDatabase } from '../helpers.js';

test('T16 shared editing, filters, audit, delete and restore across HTTP and Chromium', async ({ page }) => {
  const { pool } = await testDatabase();
  const origin = 'http://127.0.0.1:3166';
  const app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, resolve('.scratch/t16-web'));
  await app.listen(3166, '127.0.0.1');
  async function organization(label: string) {
    const parent = randomUUID();
    const org = randomUUID();
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,$2,'platform')", [parent, `${label}-parent`]);
    await pool.query("INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,$2,'terminal',$3,'encrypted',$4,'***')", [org, label, parent, label]);
    return org;
  }
  async function account(org: string, label: string, role: 'admin' | 'sales' | 'platform') {
    const id = randomUUID();
    const email = `${label}@t16.example`;
    const password = 'T16-test-password-2026';
    await pool.query('INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,false)',
      [id, org, email, await hashPassword(password), role]);
    const response = await fetch(`${origin}/api/auth/login`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password })
    });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return { id, email, password, cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  async function post(user: Awaited<ReturnType<typeof account>>, path: string, body: Record<string, unknown>) {
    return fetch(`${origin}/api/${path}`, { method: 'POST', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: user.cookie, 'X-CSRF-Token': user.csrf
    }, body: JSON.stringify(body) });
  }
  async function profile(org: string, actor: string, sourceId: string, detailId: string) {
    const search = randomUUID();
    const candidate = randomUUID();
    const query = randomUUID();
    const id = randomUUID();
    await pool.query("INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status) VALUES($1,$2,$3,'Chosen Company','TUR',1,20,1,'verified')", [search, org, actor]);
    await pool.query("INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status) VALUES($1,$2,$3,$4,'Chosen Company','TUR','verified')", [candidate, search, org, sourceId]);
    await pool.query("INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state) VALUES($1,$2,$3,$4,'Chosen Company','TUR',1,1,$5,'settled')", [query, org, actor, candidate, randomUUID()]);
    await pool.query("INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id) VALUES($1,$2,$3,'Chosen Company','TUR','{}',$4)", [id, org, detailId, query]);
    return { id, query, candidate };
  }
  try {
    const orgA = await organization('t16-a');
    const orgB = await organization('t16-b');
    const admin = await account(orgA, 't16-admin', 'admin');
    const sales = await account(orgA, 't16-sales', 'sales');
    const other = await account(orgB, 't16-other', 'admin');
    const platformOrg = (await pool.query('SELECT parent_id FROM organizations WHERE id=$1', [orgA])).rows[0].parent_id as string;
    const platform = await account(platformOrg, 't16-platform', 'platform');
    const saved = await profile(orgA, admin.id, 'list-id-404', 'detail-data-id-909');
    const foreign = await profile(orgB, other.id, 'list-id-foreign', 'detail-data-foreign');
    const manual = randomUUID();
    const attachment = randomUUID();
    await pool.query("INSERT INTO timeline_manual_records(id,organization_id,company_id,type,event_time,content,created_by) VALUES($1,$2,$3,'note',clock_timestamp(),'历史备注',$4)", [manual, orgA, saved.id, sales.id]);
    await pool.query("INSERT INTO company_attachments(id,organization_id,company_id,communication_id,original_name,storage_key,mime_type,size_bytes,sha256,scanned_at,uploaded_by) VALUES($1,$2,$3,$4,'history.pdf',$5,'application/pdf',1,'fixture',clock_timestamp(),$6)", [attachment, orgA, saved.id, manual, randomUUID(), sales.id]);
    const template = randomUUID();
    const draft = randomUUID();
    const preview = randomUUID();
    const channel = randomUUID();
    const batch = randomUUID();
    await pool.query("INSERT INTO public_templates(id,name,current_version) VALUES($1,$2,1)", [template, `T16 historical template ${template}`]);
    await pool.query("INSERT INTO public_template_versions(template_id,version,subject,content,created_by) VALUES($1,1,'历史主题','历史正文',$2)", [template, admin.id]);
    await pool.query("INSERT INTO email_drafts(id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,selections) VALUES($1,$2,$3,$4,$5,1,'历史主题','历史正文','{}')", [draft, orgA, sales.id, saved.id, template]);
    await pool.query("INSERT INTO email_previews(id,draft_id,organization_id,actor_id,profile_id,template_id,template_version,subject,content,attachment_ids,recipient_snapshot,preview_snapshot) VALUES($1,$2,$3,$4,$5,$6,1,'历史主题','历史正文','{}','{}','{}')", [preview, draft, orgA, sales.id, saved.id, template]);
    await pool.query("INSERT INTO team_sending_channels(id,organization_id,kind,smtp_host,smtp_port,smtp_security,smtp_username,credential_encrypted,reply_to,verification_state,verification_detail,verified_at,updated_by) VALUES($1,$2,'SMTP','smtp.example',465,'ssl','team','fixture','reply@example.com','available','fixture',clock_timestamp(),$3)", [channel, orgA, admin.id]);
    await pool.query("INSERT INTO email_batches(id,preview_id,organization_id,actor_id,profile_id,channel_id,channel_kind,reply_to,usage_day,attachment_ids) VALUES($1,$2,$3,$4,$5,$6,'SMTP','reply@example.com','2026-10-27','{}')", [batch, preview, orgA, sales.id, saved.id, channel]);
    assert.equal((await post(sales, 'company-profiles/update', { profileId: foreign.id, customerStatus: 'following' })).status, 404);
    assert.equal((await post(other, 'company-profiles/delete', { profileId: saved.id })).status, 404);
    assert.equal((await post(sales, 'company-profiles/delete', { profileId: saved.id })).status, 403);
    assert.equal((await post(platform, 'company-profiles/update', { profileId: saved.id, customerStatus: 'following' })).status, 403);
    assert.equal((await post(platform, 'company-profiles/restore', { profileId: saved.id })).status, 403);
    assert.equal((await post(sales, 'company-profiles/update', { profileId: saved.id, customerStatus: 'emailed' })).status, 400);
    assert.equal((await post(sales, 'company-profiles/update', { profileId: saved.id, starRating: 6 })).status, 400);
    const changed = await post(sales, 'company-profiles/update', {
      profileId: saved.id, mainProducts: '工业阀门', purchasingNeeds: '钢材', cooperationIntent: '试单',
      nextFollowUpAt: '2026-11-02T16:30:00.000Z', customerStatus: 'following', starRating: 4, tags: ['重点', '出口']
    });
    assert.equal(changed.status, 200, await changed.text());
    const filtered = await (await post(admin, 'company-profiles/list', {
      customerStatus: 'following', followUpFrom: '2026-11-03', followUpTo: '2026-11-03'
    })).json() as Array<{ id: string }>;
    assert.deepEqual(filtered.map(item => item.id), [saved.id]);
    assert.equal((await (await post(admin, 'company-profiles/list', { customerStatus: 'replied' })).json() as unknown[]).length, 0);
    const unchanged = (await pool.query('SELECT detail_id,query_id FROM company_profiles WHERE id=$1', [saved.id])).rows[0];
    assert.equal(unchanged.detail_id, 'detail-data-id-909');
    assert.equal(unchanged.query_id, saved.query);
    await page.goto(origin);
    await page.getByLabel('登录账号', { exact: true }).fill(admin.email);
    await page.getByLabel('密码', { exact: true }).fill(admin.password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await expect(page.getByText('本企业档案库')).toBeVisible();
    await page.getByText('Chosen Company · TUR').click();
    await expect(page.getByRole('textbox', { name: '主营产品' })).toHaveValue('工业阀门');
    await page.getByRole('textbox', { name: '主营产品' }).fill('工业阀门与泵');
    await page.getByRole('button', { name: '保存补充' }).click();
    await expect(page.getByText('档案补充已保存')).toBeVisible();
    await page.locator('.company-search select').first().selectOption('replied');
    await expect(page.getByText('当前筛选下没有档案')).toBeVisible();
    await page.locator('.company-search select').first().selectOption('following');
    await expect(page.getByText('Chosen Company · TUR')).toBeVisible();
    await page.getByText('Chosen Company · TUR').click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '软删除档案' }).click();
    await expect(page.getByText('当前筛选下没有档案')).toBeVisible();
    assert.equal((await post(sales, 'company-timeline/list', { profileId: saved.id })).status, 404);
    assert.equal((await post(sales, 'company-attachments/list', { profileId: saved.id })).status, 404);
    assert.equal((await post(sales, 'company-contacts/profile', { profileId: saved.id })).status, 404);
    assert.equal((await post(sales, 'company-details/quote', { candidateId: saved.candidate })).status, 409);
    await page.getByLabel('查看已删除').check();
    await page.getByText('Chosen Company · TUR').click();
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '恢复档案' }).click();
    await expect(page.getByText('当前筛选下没有档案')).toBeVisible();
    await page.getByLabel('查看已删除').uncheck();
    await expect(page.getByText('Chosen Company · TUR')).toBeVisible();
    const linked = (await pool.query('SELECT company_id,communication_id,deleted_at FROM company_attachments WHERE id=$1', [attachment])).rows[0];
    assert.equal(linked.company_id, saved.id);
    assert.equal(linked.communication_id, manual);
    assert.equal(linked.deleted_at, null);
    assert.equal((await pool.query('SELECT company_id,deleted_at FROM timeline_manual_records WHERE id=$1', [manual])).rows[0].company_id, saved.id);
    assert.equal((await pool.query('SELECT profile_id FROM email_batches WHERE id=$1', [batch])).rows[0].profile_id, saved.id);
    assert.equal((await pool.query('SELECT profile_id FROM email_previews WHERE id=$1', [preview])).rows[0].profile_id, saved.id);
    const events = (await (await post(admin, 'company-profiles/history', { profileId: saved.id })).json() as Array<{ event: string; actorId: string }>);
    assert.deepEqual(events.map(item => item.event), ['restore', 'delete', 'update', 'update']);
    assert.equal(events[3].actorId, sales.id);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM query_point_ledger WHERE query_id=$1', [saved.query])).rows[0].n, 0);
  } finally {
    await app.close();
    await pool.end();
  }
});
