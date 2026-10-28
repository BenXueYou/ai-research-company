import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { digest } from '../server/identity/identity.js';
import { migrate } from '../server/database.js';
import { testDatabase, ordinaryAccount } from './helpers.js';

test('真实 PostgreSQL / HTTP 身份闭环与安全边界', async t => {
  const { pool, service } = await testDatabase();
  const origin = 'http://127.0.0.1:3091';
  const app = await createApplication(pool, origin);
  await app.listen(3091, '127.0.0.1');
  let account = { email: '', password: '' };
  let token = '';
  let csrf = '';
  const first = 'NewPassword123!';
  const second = 'second-password-ASCII!';
  const change = (currentPassword: string, newPassword: string) => ({ currentPassword, newPassword, confirmPassword: newPassword });
  async function http(path: string, body?: object, options: { token?: string; csrf?: string; origin?: string } = {}) {
    return fetch(origin + '/api/' + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Origin: options.origin ?? origin,
        Cookie: `identity_session=${options.token ?? token}`,
        'X-CSRF-Token': options.csrf ?? csrf
      },
      body: body ? JSON.stringify(body) : undefined
    });
  }
  try {
    await t.test('普通邮箱夹具与真实服务；无公开引导接口', async () => {
      account = await ordinaryAccount(pool, 'Admin@EXAMPLE.COM');
      assert.equal(account.password.length, 24);
      assert.equal((await http('bootstrap', {})).status, 404);
    });
    await t.test('未认证拒绝、错误密码与未知邮箱统一提示，邮箱域名折叠/本地敏感', async () => {
      assert.equal((await http('workspace')).status, 401);
      const bad = await http('auth/login', { email: account.email, password: 'incorrect' });
      const unknown = await http('auth/login', { email: 'unknown@example.com', password: 'incorrect' });
      assert.equal(bad.status, 401);
      assert.deepEqual(await bad.json(), await unknown.json());
      assert.equal((await http('auth/login', { email: account.email.toLowerCase(), password: account.password })).status, 401);
      const credentials = await service.login({ email: account.email.replace('example.com', 'EXAMPLE.COM'), password: account.password }, 'device-a');
      token = credentials.token;
      csrf = credentials.csrf;
    });
    await t.test('强改密不可直访业务；当前密码、两次新密码、相同密码、CSRF、Origin保护', async () => {
      assert.equal((await http('workspace')).status, 403);
      assert.equal((await http('auth/session')).status, 200);
      assert.equal((await http('auth/password', change(account.password, first), { csrf: 'forged' })).status, 403);
      assert.equal((await http('auth/password', change(account.password, first), { origin: 'https://evil.example' })).status, 403);
      assert.equal((await http('auth/password', { ...change(account.password, first), confirmPassword: 'different' })).status, 400);
      assert.equal((await http('auth/password', change('incorrect', first))).status, 400);
      assert.equal((await http('auth/password', change(account.password, account.password))).status, 400);
      assert.equal((await http('auth/password', change(account.password, 'non-ascii-password-安全'))).status, 400);
    });
    await t.test('临时到期不能登录且已有临时会话失效', async () => {
      await pool.query("UPDATE accounts SET temporary_expires_at=clock_timestamp() - interval '1 second'");
      assert.equal((await http('auth/login', account)).status, 401);
      assert.equal((await http('auth/session')).status, 401);
      await pool.query("UPDATE accounts SET temporary_expires_at=clock_timestamp() + interval '72 hours'");
    });
    await t.test('强改密成功全设备撤销，旧密码失败，新密码登录允许工作台', async () => {
      const device = await service.login(account, 'device-b');
      assert.equal((await http('auth/password', change(account.password, first))).status, 200);
      await assert.rejects(service.authenticate(device.token));
      assert.equal((await http('auth/session')).status, 401);
      assert.equal((await http('auth/login', account)).status, 401);
      const login = await http('auth/login', { email: account.email, password: first });
      assert.equal(login.status, 200);
      const cookies = login.headers.getSetCookie();
      assert.ok(cookies.some(value => value.startsWith('identity_session=') && value.includes('HttpOnly') && value.includes('SameSite=Strict')));
      token = cookies.find(value => value.startsWith('identity_session='))!.split(';')[0].slice(17);
      csrf = cookies.find(value => value.startsWith('identity_csrf='))!.split(';')[0].slice(14);
      assert.equal((await http('workspace')).status, 200);
    });
    await t.test('并发主动改密仅一个成功，不覆盖最新密码；全设备失效', async () => {
      const device = await service.login({ email: account.email, password: first }, 'device-c');
      const third = 'third-password-ASCII!';
      const results = await Promise.all([http('auth/password', change(first, second)), http('auth/password', change(first, third))]);
      assert.deepEqual(results.map(result => result.status).sort(), [200, 401]);
      const winner = results[0].status === 200 ? second : third;
      const loser = winner === second ? third : second;
      await assert.rejects(service.login({ email: account.email, password: loser }, 'loser'));
      await assert.rejects(service.authenticate(device.token));
      const login = await service.login({ email: account.email, password: winner }, 'winner');
      token = login.token;
      csrf = login.csrf;
    });
    await t.test('退出、8h绝对到期、30min空闲到期均不能复用', async () => {
      assert.equal((await http('auth/logout', {})).status, 200);
      assert.equal((await http('workspace')).status, 401);
      const hash = (await pool.query('SELECT password_hash FROM accounts')).rows[0].password_hash;
      // Session fixtures use the real account and production authentication query.
      for (const field of ['expires_at', 'last_seen_at']) {
        const fixture = randomUUID();
        await pool.query(`INSERT INTO sessions(token_hash,account_id,csrf_hash,${field}) SELECT $1,id,$2,clock_timestamp() - interval '9 hours' FROM accounts`, [digest(fixture), digest('csrf')]);
        await assert.rejects(service.authenticate(fixture));
      }
      assert.ok(hash.startsWith('scrypt-32768-8-3$'));
    });
    await t.test('唯一键与登录同规范；审计及会话不泄密', async () => {
      const row = (await pool.query('SELECT * FROM accounts')).rows[0];
      await assert.rejects(pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role) VALUES($1,$2,$3,$4,'sales')`, [randomUUID(), row.organization_id, row.email, row.password_hash]));
      const audit = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
      for (const secret of [account.password, first, second, row.password_hash, token, csrf]) assert.ok(!audit.includes(secret));
      const stored = JSON.stringify((await pool.query('SELECT * FROM sessions')).rows);
      assert.ok(!stored.includes(token));
      assert.ok(!stored.includes(csrf));
      assert.deepEqual(Object.keys((await pool.query('SELECT * FROM audit_events LIMIT 1')).rows[0]).sort(), ['account_id', 'event', 'happened_at', 'id']);
    });
    await t.test('所有角色复用本人改密，不接受目标账号覆盖；重置态同样受强改密保护', async () => {
      const owner = (await pool.query('SELECT * FROM accounts LIMIT 1')).rows[0];
      const victimId = randomUUID();
      await pool.query(`INSERT INTO accounts(id,organization_id,email,password_hash,role,must_change)
        VALUES($1,$2,'Victim@example.com',$3,'sales',false)`, [victimId, owner.organization_id, owner.password_hash]);
      for (const role of ['platform', 'distributor', 'admin', 'sales']) {
        await pool.query('UPDATE accounts SET role=$1 WHERE id=$2', [role, owner.id]);
        const password = `role-password-${role}`;
        const { hashPassword } = await import('../server/identity/policy.js');
        await pool.query('UPDATE accounts SET password_hash=$1,must_change=true,temporary_expires_at=clock_timestamp()+interval \'72 hours\' WHERE id=$2', [await hashPassword(password), owner.id]);
        const login = await service.login({ email: account.email, password }, role);
        assert.equal((await http('workspace', undefined, { token: login.token })).status, 403);
        assert.equal((await http('auth/password', { ...change(password, first), accountId: victimId }, login)).status, 200);
        assert.equal((await pool.query('SELECT password_hash FROM accounts WHERE id=$1', [victimId])).rows[0].password_hash, owner.password_hash);
        const updated = await service.login({ email: account.email, password: first }, role);
        assert.equal((await http('workspace', undefined, updated)).status, 200);
      }
    });
  } finally {
    await app.close();
    await pool.end();
  }
});

test('数据库内置平台账号：并发初始化、登录、改密、重复初始化及到期', async () => {
  const { pool, service } = await testDatabase();
  const initial = { email: 'super_admin', password: 'init@Base123' };
  const next = 'PlatformPwd123!';
  try {
    await Promise.all([migrate(pool), migrate(pool)]);
    const rows = await pool.query('SELECT * FROM accounts');
    assert.equal(rows.rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM organizations')).rowCount, 1);
    assert.equal((await pool.query('SELECT * FROM bootstrap_marker')).rowCount, 1);
    assert.equal(rows.rows[0].email, null);
    assert.equal(rows.rows[0].username, 'super_admin');
    assert.equal(rows.rows[0].must_change, true);
    assert.notEqual(rows.rows[0].password_hash, initial.password);
    for (const email of ['SUPER_ADMIN', ' super_admin', 'someone', 'super_admin@example.com'])
      await assert.rejects(service.login({ ...initial, email }, 'invalid-name'));
    const first = await service.login(initial, 'platform-a');
    const second = await service.login(initial, 'platform-b');
    assert.equal((await service.authenticate(first.token)).email, null);
    await service.changePassword(first.token, { currentPassword: initial.password, newPassword: next, confirmPassword: next });
    await assert.rejects(service.authenticate(second.token));
    const before = (await pool.query('SELECT * FROM accounts')).rows[0];
    const session = await service.login({ ...initial, password: next }, 'platform-c');
    await Promise.all([migrate(pool), migrate(pool)]);
    const after = (await pool.query('SELECT * FROM accounts')).rows[0];
    assert.deepEqual(after, before);
    assert.equal((await service.authenticate(session.token)).must_change, false);
    await assert.rejects(service.login(initial, 'old-password'));
    assert.equal((await pool.query("SELECT * FROM audit_events WHERE event='bootstrap'")).rowCount, 1);
    await pool.query("UPDATE accounts SET must_change=true,temporary_expires_at=clock_timestamp()-interval '1 second'");
    await assert.rejects(service.authenticate(session.token));
    await assert.rejects(service.login({ ...initial, password: next }, 'expired'));
    await migrate(pool);
    await assert.rejects(service.login(initial, 'expired-initial'));
    const audit = JSON.stringify((await pool.query('SELECT * FROM audit_events')).rows);
    for (const secret of [initial.password, next, after.password_hash, first.token])
      assert.ok(!audit.includes(secret));
  } finally {
    await pool.end();
  }
});
