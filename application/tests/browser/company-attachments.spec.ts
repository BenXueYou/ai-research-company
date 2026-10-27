import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApplication } from '../../server/app.js';
import { hashPassword } from '../../server/policy.js';
import { testDatabase } from '../helpers.js';

test('T18 浏览器从档案选择 WhatsApp 附件并下载', async ({ page }) => {
  const temporary = await mkdtemp(join(tmpdir(), 't18-browser-'));
  const scanner = join(temporary, 'scanner.mjs');
  await writeFile(scanner, 'process.exit(0);\n');
  process.env.COMPANY_ATTACHMENT_STORAGE_DIR = join(temporary, 'private');
  process.env.COMPANY_ATTACHMENT_SCANNER = process.execPath;
  process.env.COMPANY_ATTACHMENT_SCANNER_ARGS = JSON.stringify([scanner]);
  const { pool } = await testDatabase();
  const previousDirectory = process.cwd();
  process.chdir(resolve(previousDirectory, '.scratch/t18-dist'));
  const origin = 'http://127.0.0.1:3189';
  const app = await createApplication(pool, origin);
  await app.listen(3189, '127.0.0.1');
  try {
    const parent = randomUUID();
    const organization = randomUUID();
    const account = randomUUID();
    const email = 't18-browser@example.com';
    const password = 't18-browser-password-2026';
    await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'平台','platform')", [parent]);
    await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,$2,'terminal',$3,'encrypted','t18-browser','***')`, [organization, '浏览器企业', parent]);
    await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,'admin',false)`, [account, organization, email, await hashPassword(password)]);
    const search = randomUUID();
    const candidate = randomUUID();
    const query = randomUUID();
    const profile = randomUUID();
    await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'搜索名称','TUR',1,20,1,'verified')`, [search, organization, account]);
    await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'list-id-different','档案企业','TUR','verified')`, [candidate, search, organization]);
    await pool.query(`INSERT INTO company_detail_queries(id,organization_id,actor_id,candidate_id,name,country_code3,coefficient,maximum_points,price_version,state)
      VALUES($1,$2,$3,$4,'档案企业','TUR',1,1,$5,'settled')`, [query, organization, account, candidate, randomUUID()]);
    await pool.query(`INSERT INTO company_profiles(id,organization_id,detail_id,name,country_code3,detail,query_id)
      VALUES($1,$2,'detail-id-different','档案企业','TUR','{}',$3)`, [profile, organization, query]);
    const pdf = Buffer.from('%PDF-1.4\nBrowser attachment\n');
    await page.goto(origin);
    await page.getByLabel('登录账号', { exact: true }).fill(email);
    await page.getByLabel('密码', { exact: true }).fill(password);
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByText('档案企业 · TUR').click();
    await page.getByLabel('记录类型').click();
    await page.getByRole('option', { name: 'WhatsApp' }).click();
    await page.getByLabel('发生时间').fill('2026-10-26T14:30');
    await page.getByLabel('联系人或号码').fill('+86 138-1234-5678');
    await page.getByLabel('摘要', { exact: true }).fill('浏览器 WhatsApp 留档');
    await page.getByRole('group', { name: '附件（可选）' }).locator('input[type="file"]')
      .setInputFiles({ name: 'chat.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.getByRole('button', { name: '登记记录' }).click();
    await expect(page.getByText('浏览器 WhatsApp 留档')).toBeVisible();
    await expect(page.getByText('chat.pdf', { exact: false })).toBeVisible();
    const row = (await pool.query('SELECT company_id,communication_id FROM company_attachments WHERE organization_id=$1', [organization])).rows[0];
    assert.equal(row.company_id, profile);
    const record = (await pool.query('SELECT id FROM timeline_manual_records WHERE company_id=$1', [profile])).rows[0];
    assert.equal(row.communication_id, record.id);
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载' }).click();
    const downloaded = await downloadPromise;
    expect(downloaded.suggestedFilename()).toBe('chat.pdf');
    assert.deepEqual(await readFile(await downloaded.path()), pdf);
  } finally {
    await app.close();
    await pool.end();
    process.chdir(previousDirectory);
    await rm(temporary, { recursive: true, force: true });
  }
});
