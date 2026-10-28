import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { hashPassword } from '../server/identity/policy.js';
import { HttpTengdaoCompanyClient } from '../server/upstream/tengdao.js';
import { testDatabase } from '../tests/helpers.js';
class SharedState {
    tokenValue = null;
    calls = [];
    token() { return Promise.resolve(this.tokenValue); }
    cacheToken(token) { this.tokenValue = token; return Promise.resolve(); }
    tryTokenLock() { return Promise.resolve(true); }
    releaseTokenLock() { return Promise.resolve(); }
    reserve(kind) { this.calls.push(kind); return Promise.resolve(); }
    usage() { return Promise.resolve({ minute: this.calls.length, dataToday: this.calls.filter(item => item === 'data').length, businessToday: this.calls.filter(item => item === 'business').length }); }
}
test('ISSUE-45 平台监控只在主动刷新时请求上游，失败保留快照且租户无权查看', async () => {
    const { pool } = await testDatabase();
    await pool.query('TRUNCATE upstream_monitor_events,upstream_account_snapshot RESTART IDENTITY');
    const state = new SharedState();
    const requests = [];
    let fail = false;
    const vendor = new HttpTengdaoCompanyClient(state, {
        baseUrl: 'https://vendor.example', apiKey: 'private-api-key', businessDailyLimit: 8,
        fetch: (async (input) => {
            const url = new URL(String(input));
            requests.push(url.pathname);
            if (url.pathname === '/v2/access-token')
                return Response.json({ success: true, code: 200, data: { accessToken: 'private-token', expiresIn: 3600, unit: 'SECONDS' } });
            if (fail)
                return Response.json({ success: false, code: '40304', traceId: 'failed-trace', data: null });
            return Response.json({ success: true, code: 200, traceId: 'account-trace', data: { balance: '123.50', expiresIn: '2027-01-01 00:00:00' } });
        })
    });
    const origin = 'http://127.0.0.1:3206';
    const app = await createApplication(pool, origin, false, undefined, undefined, undefined, undefined, vendor);
    await app.listen(3206, '127.0.0.1');
    async function user(kind, role) {
        const organizationId = randomUUID();
        const accountId = randomUUID();
        const password = '测试密码-足够十二字符';
        if (kind === 'terminal') {
            const parent = randomUUID();
            await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'parent','platform')", [parent]);
            await pool.query("INSERT INTO organizations(id,name,kind,parent_id,phone_encrypted,phone_key,phone_masked) VALUES($1,'tenant','terminal',$2,'encrypted',$3,'***')", [organizationId, parent, randomUUID()]);
        }
        else
            await pool.query("INSERT INTO organizations(id,name,kind) VALUES($1,'platform','platform')", [organizationId]);
        const email = kind === 'platform' ? 'super_admin' : `${accountId}@example.com`;
        await pool.query('INSERT INTO accounts(id,organization_id,email,username,password_hash,role,must_change) VALUES($1,$2,$3,$4,$5,$6,false)', [accountId, organizationId, kind === 'platform' ? null : email, kind === 'platform' ? email : null, await hashPassword(password), role]);
        const response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
        assert.equal(response.status, 200);
        const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
        return { cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf=')).slice(14) };
    }
    try {
        const platform = await user('platform', 'platform');
        const tenant = await user('terminal', 'admin');
        const tenantId = (await pool.query("SELECT organization_id FROM accounts WHERE email LIKE '%@example.com' LIMIT 1")).rows[0].organization_id;
        await pool.query('INSERT INTO internal_point_accounts(organization_id,balance) VALUES($1,$2)', [tenantId, '77.0000']);
        const get = (cookie) => fetch(`${origin}/api/upstream-monitor`, { headers: { Cookie: cookie } });
        const refresh = (session) => fetch(`${origin}/api/upstream-monitor/refresh`, {
            method: 'POST', headers: { Origin: origin, Cookie: session.cookie, 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf }, body: '{}'
        });
        assert.equal((await get(tenant.cookie)).status, 403);
        assert.equal((await refresh(tenant)).status, 403);
        assert.deepEqual(requests, []);
        const initial = await (await get(platform.cookie)).json();
        assert.equal(initial.snapshot, null);
        assert.deepEqual(requests, []);
        assert.equal((await refresh(platform)).status, 200);
        assert.deepEqual(requests, ['/v2/access-token', '/v2/account']);
        const after = await (await get(platform.cookie)).json();
        assert.equal(after.snapshot.balance, '123.50');
        assert.equal(after.usage.businessToday, 2);
        fail = true;
        assert.equal((await refresh(platform)).status, 503);
        const retained = await (await get(platform.cookie)).json();
        assert.equal(retained.snapshot.balance, '123.50');
        assert.equal(retained.events[0].category, 'points_exhausted');
        assert.equal(retained.usage.businessToday, 3);
        assert.equal(JSON.stringify(retained).includes('private-api-key'), false);
        assert.equal(JSON.stringify(retained).includes('private-token'), false);
        assert.equal(Number((await pool.query('SELECT count(*) FROM query_point_ledger')).rows[0].count), 0);
        assert.equal((await pool.query('SELECT balance FROM internal_point_accounts WHERE organization_id=$1', [tenantId])).rows[0].balance, '77.0000');
    }
    finally {
        await app.close();
        await pool.end();
    }
});
//# sourceMappingURL=upstream.test.js.map