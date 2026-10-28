import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { createApplication } from './app.js';
import { hashPassword } from './identity/policy.js';
import { testDatabase } from '../tests/helpers.js';
test('T15 explicit detail and contact refresh retains prior evidence and old contacts', async () => {
    const { pool } = await testDatabase();
    const origin = 'http://127.0.0.1:3145';
    const detailCalls = [];
    const contactCalls = [];
    let contactList = [
        { mailsouId: 'mail-source-old', id: 'source-id-different', fileId: 'file-id-different',
            companyName: 'Chosen Company', email: 'old@example.test' },
        { mailsouId: 'mail-source-kept', id: 'another-id', fileId: 'another-file',
            companyName: 'Chosen Company', email: 'kept@example.test' }
    ];
    let detailVersion = 1;
    let detailZero = false;
    let contactFailure = false;
    const app = await createApplication(pool, origin, false, undefined, undefined, undefined, { detail: async (input) => {
            detailCalls.push(input);
            return { data: { id: detailZero ? null : 'detail-data-id-909', countryCode3: 'TUR', version: detailVersion },
                actualUpstreamPoints: '0.2500' };
        } }, undefined, { contacts: async (input) => {
            contactCalls.push(input);
            if (contactFailure)
                throw new Error('controlled timeout');
            return { data: { list: contactList, pageNo: input.pageNo, pageSize: input.pageSize, total: contactList.length },
                actualUpstreamPoints: '0.2500' };
        } }, undefined, undefined, undefined, resolve('.scratch/t15-web'));
    await app.listen(3145, '127.0.0.1');
    try {
        const parent = randomUUID();
        const organization = randomUUID();
        const actor = randomUUID();
        const searchId = randomUUID();
        const candidateId = randomUUID();
        const email = 't15-user@example.test';
        const password = 't15-test-password-2026';
        await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'parent','platform')", [parent]);
        await pool.query(`INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked)
      VALUES($1,'terminal','terminal',$2,'encrypted','t15-phone','***')`, [organization, parent]);
        await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
      VALUES($1,$2,$3,$4,'admin',false)`, [actor, organization, email, await hashPassword(password)]);
        await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,5.0000)', [organization]);
        await pool.query(`INSERT INTO company_searches(id,organization_id,actor_id,name,country_codes,page_no,page_size,total,status)
      VALUES($1,$2,$3,'Chosen Company','TUR',1,20,1,'verified')`, [searchId, organization, actor]);
        await pool.query(`INSERT INTO company_candidates(id,search_id,organization_id,source_id,source_name,source_country,verification_status)
      VALUES($1,$2,$3,'list-id-404','Chosen Company','TUR','verified')`, [candidateId, searchId, organization]);
        await pool.query(`INSERT INTO interface_prices(interface_path,upstream_unit_price,maximum_billable_units,evidence,evidence_type,version,actor_id)
      VALUES('/v2/company',0.2500,2,'fixture','controlled_test',$1,$2),
        ('/v2/contact',0.2500,2,'fixture','controlled_test',$3,$2)`, [randomUUID(), actor, randomUUID()]);
        const login = await fetch(`${origin}/api/auth/login`, { method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        assert.equal(login.status, 200);
        const cookies = login.headers.getSetCookie().map(item => item.split(';')[0]);
        const headers = { Origin: origin, 'Content-Type': 'application/json', Cookie: cookies.join('; '),
            'X-CSRF-Token': cookies.find(item => item.startsWith('identity_csrf=')).slice(14) };
        async function post(path, body) {
            return fetch(`${origin}/api/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
        }
        const first = await (await post('company-details/quote', { candidateId })).json();
        await post('company-details/execute', { queryId: first.queryId });
        const profile = (await pool.query('SELECT id,fetched_at FROM company_profiles WHERE organization_id=$1', [organization])).rows[0];
        const body = { profileId: profile.id, positionTags: ['TECHNOLGY'], pageNo: 1, pageSize: 20 };
        const contactsFirst = await (await post('company-contacts/quote', body)).json();
        await post('company-contacts/execute', { queryId: contactsFirst.queryId });
        const oldId = (await pool.query("SELECT id FROM company_contacts WHERE mailsou_id='mail-source-old'")).rows[0].id;
        assert.equal((await post('company-contacts/quote', body)).status, 200);
        assert.deepEqual([detailCalls.length, contactCalls.length], [1, 1]);
        assert.equal((await post('company-details/refresh-quote', { profileId: candidateId })).status, 404);
        assert.equal((await post('company-contacts/refresh-quote', { ...body, profileId: candidateId })).status, 404);
        assert.equal((await post('company-details/refresh-quote', { profileId: 'list-id-404' })).status, 400);
        assert.deepEqual([detailCalls.length, contactCalls.length], [1, 1]);
        const refreshDetail = await (await post('company-details/refresh-quote', { profileId: profile.id })).json();
        const refreshContacts = await (await post('company-contacts/refresh-quote', body)).json();
        assert.deepEqual([detailCalls.length, contactCalls.length], [1, 1]);
        detailVersion = 2;
        contactList = [{ mailsouId: 'mail-source-kept', id: 'changed-id', fileId: 'changed-file',
                companyName: 'Chosen Company', email: 'new@example.test' }];
        assert.equal((await post('company-details/execute', { queryId: refreshDetail.queryId })).status, 200);
        assert.equal((await post('company-contacts/execute', { queryId: refreshContacts.queryId })).status, 200);
        assert.deepEqual(detailCalls[1], { name: 'Chosen Company', countryCode3: 'TUR' });
        assert.deepEqual(contactCalls[1], { companyName: 'Chosen Company', positionTags: ['TECHNOLGY'], pageNo: 1, pageSize: 20 });
        assert.equal((await post('company-contacts/execute', { queryId: refreshContacts.queryId })).status, 200);
        assert.deepEqual([detailCalls.length, contactCalls.length], [2, 2]);
        const current = (await pool.query('SELECT detail,query_id,fetched_at FROM company_profiles WHERE id=$1', [profile.id])).rows[0];
        assert.equal(current.detail.version, 2);
        assert.equal(current.query_id, refreshDetail.queryId);
        assert.ok(current.fetched_at >= profile.fetched_at);
        const historicalDetail = (await pool.query('SELECT result FROM company_detail_queries WHERE id=$1', [first.queryId])).rows[0];
        assert.equal(historicalDetail.result.version, 1);
        const old = (await pool.query('SELECT id,email,not_returned_in_last_update FROM company_contacts WHERE id=$1', [oldId])).rows[0];
        assert.deepEqual(old, { id: oldId, email: 'old@example.test', not_returned_in_last_update: true });
        const kept = (await pool.query("SELECT email,not_returned_in_last_update FROM company_contacts WHERE mailsou_id='mail-source-kept'")).rows[0];
        assert.deepEqual(kept, { email: 'new@example.test', not_returned_in_last_update: false });
        const history = (await pool.query(`SELECT source_payload->>'email' AS email FROM company_contact_source_history
      WHERE mailsou_id='mail-source-kept' ORDER BY fetched_at`)).rows;
        assert.deepEqual(history.map(item => item.email).sort(), ['kept@example.test', 'new@example.test']);
        const listed = await (await post('company-contacts/profile', { profileId: profile.id })).json();
        assert.equal(listed.contacts.find(item => item.id === oldId)?.notReturnedInLastUpdate, true);
        assert.ok(listed.fetchedAt);
        assert.equal((await pool.query('SELECT balance,query_frozen FROM internal_point_accounts WHERE organization_id=$1', [organization])).rows[0].balance, '4.0000');
        const browser = await chromium.launch({ headless: true });
        try {
            const page = await browser.newPage();
            await page.goto(origin);
            await page.getByLabel('登录账号', { exact: true }).fill(email);
            await page.getByLabel('密码', { exact: true }).fill(password);
            await page.getByRole('button', { name: '登录', exact: true }).click();
            await page.getByText('Chosen Company · TUR').click();
            await page.getByText('本次更新未返回；仅表示本次查询结果').waitFor();
            assert.equal(detailCalls.length, 2);
            await page.getByRole('button', { name: '主动更新企业详情' }).click();
            await page.getByRole('button', { name: '取消' }).last().click();
            assert.equal(detailCalls.length, 2);
            await page.getByRole('button', { name: '主动更新企业详情' }).click();
            await page.getByRole('button', { name: '再次确认费用并更新' }).click();
            await page.waitForFunction(() => !document.body.textContent?.includes('再次确认费用并更新'));
            assert.equal(detailCalls.length, 3);
            await page.getByRole('button', { name: '主动更新当前职位第 1 页' }).click();
            await page.getByRole('button', { name: '取消' }).last().click();
            assert.equal(contactCalls.length, 2);
            await page.getByRole('button', { name: '主动更新当前职位第 1 页' }).click();
            await page.getByRole('button', { name: '再次确认费用并更新本页' }).click();
            await page.getByText('本页已结算，扣点').waitFor();
            assert.equal(contactCalls.length, 3);
        }
        finally {
            await browser.close();
        }
        detailZero = true;
        contactList = [];
        const zeroDetail = await (await post('company-details/refresh-quote', { profileId: profile.id })).json();
        const zeroContacts = await (await post('company-contacts/refresh-quote', body)).json();
        const zeroDetailResult = await (await post('company-details/execute', { queryId: zeroDetail.queryId })).json();
        const zeroContactResult = await (await post('company-contacts/execute', { queryId: zeroContacts.queryId })).json();
        assert.deepEqual([zeroDetailResult.state, zeroContactResult.state], ['zero', 'zero']);
        assert.equal((await pool.query('SELECT detail->>\'version\' AS version FROM company_profiles WHERE id=$1', [profile.id])).rows[0].version, '2');
        assert.equal((await pool.query('SELECT count(*)::int AS n FROM company_contacts WHERE profile_id=$1', [profile.id])).rows[0].n, 2);
        contactFailure = true;
        const unknown = await (await post('company-contacts/refresh-quote', body)).json();
        const pending = await (await post('company-contacts/execute', { queryId: unknown.queryId })).json();
        assert.equal(pending.state, 'pending');
        const beforeRepeat = contactCalls.length;
        assert.equal((await post('company-contacts/execute', { queryId: unknown.queryId })).status, 200);
        assert.equal(contactCalls.length, beforeRepeat);
        assert.equal((await pool.query('SELECT query_frozen FROM internal_point_accounts WHERE organization_id=$1', [organization])).rows[0].query_frozen, '0.5000');
    }
    finally {
        await app.close();
        await pool.end();
    }
});
//# sourceMappingURL=company-refresh.test.js.map