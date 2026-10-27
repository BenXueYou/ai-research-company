import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApplication } from '../server/app.js';
import { migrate } from '../server/database.js';
import { MemberService } from '../server/members.js';
import { digest } from '../server/identity.js';
import { testDatabase } from './helpers.js';

test('T03 真实HTTP/PostgreSQL成员创建、交付、停用及竞争', async t => {
  const { pool } = await testDatabase();
  await migrate(pool);
  const origin = 'http://127.0.0.1:3191';
  const app = await createApplication(pool, origin);
  await app.listen(3191, '127.0.0.1');
  type Session = { cookie: string; csrf: string };
  type Created = { accountId: string; organizationId: string; email: string; temporaryPassword: string; expiresAt: string };
  const empty = { cookie: '', csrf: '' };
  const next = '成员验收新密码安全十二字符😀';
  let serial = 0;
  const data = (role = 'sales') => ({ name: `成员原名-${++serial}`, email: `Member.${serial}+tag@EXAMPLE.COM`, role, requestId: randomUUID() });
  async function http(session: Session, path: string, body?: object) {
    return fetch(`${origin}/api/${path}`, { method: body ? 'POST' : 'GET', headers: {
      Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf
    }, body: body ? JSON.stringify(body) : undefined });
  }
  async function login(email: string, password: string) {
    const response = await http(empty, 'auth/login', { email, password });
    assert.equal(response.status, 200, '登录应成功（不输出凭据）');
    const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return { cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  async function activate(account: { email: string; temporaryPassword: string }) {
    const session = await login(account.email, account.temporaryPassword);
    assert.equal((await http(session, 'members')).status, 403);
    assert.equal((await http(session, 'auth/password', { currentPassword: account.temporaryPassword, newPassword: next, confirmPassword: next })).status, 200);
    assert.equal((await http(session, 'workspace')).status, 401);
    assert.equal((await http(empty, 'auth/login', { email: account.email, password: account.temporaryPassword })).status, 401);
    return login(account.email, next);
  }
  async function create(session: Session, input = data()): Promise<Created> {
    const response = await http(session, 'members', input);
    assert.equal(response.status, 201);
    return response.json() as Promise<Created>;
  }
  async function open(session: Session) {
    const n = ++serial;
    const response = await http(session, 'organizations', { name: `企业-${n}`, kind: 'terminal', countryCode: '+86', phone: `1399000${n}`, email: `Owner.${n}@EXAMPLE.COM`, requestId: randomUUID() });
    assert.equal(response.status, 201);
    return response.json() as Promise<Created>;
  }
  try {
    const platform = await activate({ email: 'super_admin', temporaryPassword: 'init@Base123' });
    const company = await open(platform);
    const owner = await activate(company);
    const otherCompany = await open(platform);
    const otherOwner = await activate(otherCompany);
    let member: Created;
    let admin: Created;
    let adminSession: Session;
    await t.test('角色、姓名、邮箱及身份来源；首次登录强改密和旧密码失效', async () => {
      for (const role of ['sales', 'admin']) {
        const input = data(role);
        const created = await create(owner, input);
        assert.equal(created.email, input.email.replace('EXAMPLE.COM', 'example.com'));
        assert.equal(created.organizationId, company.organizationId);
        assert.notEqual(created.organizationId, created.accountId);
        assert.equal(created.temporaryPassword.length, 24);
        const row = (await pool.query('SELECT * FROM accounts WHERE id=$1', [created.accountId])).rows[0];
        assert.equal(row.name, input.name);
        assert.equal(row.email, created.email);
        assert.equal(row.role, role);
        assert.equal(row.organization_id, company.organizationId);
        assert.ok(Math.abs(new Date(created.expiresAt).getTime() - Date.now() - 72 * 3600000) < 10000);
        assert.ok(!JSON.stringify(row).includes(created.temporaryPassword));
        const activated = await activate(created);
        if (role === 'sales') member = created;
        else { admin = created; adminSession = activated; }
      }
      const list = await http(owner, 'members').then(r => r.json());
      assert.equal(list.members.length, 3);
      assert.ok(!JSON.stringify(list).includes('password'));
      assert.deepEqual(list.allowedRoles, ['sales', 'admin']);
    });
    await t.test('必填、邮箱不裁剪、未知字段及越权拒绝，无账号写入', async () => {
      const before = (await pool.query('SELECT count(*) FROM accounts')).rows[0].count;
      for (const field of ['name', 'email', 'role', 'requestId']) {
        const input: Record<string, unknown> = data(); delete input[field];
        assert.equal((await http(owner, 'members', input)).status, 400);
        assert.equal((await http(owner, 'members', { ...data(), [field]: '' })).status, 400);
      }
      for (const extra of [{ organizationId: otherCompany.organizationId }, { password: 'manual' }, { phone: '123' }, { active: true }, { accountId: randomUUID() }])
        assert.equal((await http(owner, 'members', { ...data(), ...extra })).status, 400);
      for (const email of [' a@example.com', 'a@example.com ', 'bad', 'a b@example.com'])
        assert.equal((await http(owner, 'members', { ...data(), email })).status, 400);
      for (const role of ['platform', 'distributor', 'ADMIN'])
        assert.equal((await http(owner, 'members', data(role))).status, 400);
      assert.equal((await http(empty, 'members', data())).status, 401);
      assert.equal((await http({ ...owner, csrf: 'bad' }, 'members', data())).status, 403);
      assert.equal((await http(platform, 'members', data())).status, 403);
      const sales = await login(member!.email, next);
      assert.equal((await http(sales, 'members')).status, 403);
      assert.equal((await http(sales, 'members', data())).status, 403);
      assert.equal((await pool.query('SELECT count(*) FROM accounts')).rows[0].count, before);
    });
    await t.test('跨企业/并发邮箱冲突与大小写加号圆点保留', async () => {
      assert.equal((await http(otherOwner, 'members', { ...data(), email: member!.email })).status, 409);
      const input = data();
      const responses = await Promise.all([http(owner, 'members', input), http(otherOwner, 'members', { ...input, requestId: randomUUID() })]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      for (const email of ['Mixed.Tag+one@example.com', 'mixed.Tag+one@example.com', 'MixedTag+one@example.com', 'Mixed.Tag@example.com'])
        assert.equal((await http(owner, 'members', { ...data(), email })).status, 201);
    });
    await t.test('同请求并发及载荷变化重试不重复创建，不回放明文', async () => {
      const input = data();
      const responses = await Promise.all([http(owner, 'members', input), http(owner, 'members', input)]);
      assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
      assert.equal((await http(owner, 'members', { ...input, name: '变更载荷', email: 'Changed@example.com' })).status, 409);
      assert.equal((await pool.query('SELECT count(*) FROM member_creations WHERE request_id=$1', [input.requestId])).rows[0].count, '1');
    });
    await t.test('审计插入故障时账号与幂等同事务回滚，可重新提交', async () => {
      const input = data();
      await pool.query(`CREATE FUNCTION fail_member_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.result='success' THEN RAISE EXCEPTION 'test fault'; END IF; RETURN NEW; END $$;
        CREATE TRIGGER fail_member_audit BEFORE INSERT ON member_audit FOR EACH ROW EXECUTE FUNCTION fail_member_audit()`);
      try { assert.equal((await http(owner, 'members', input)).status, 500); }
      finally { await pool.query('DROP TRIGGER fail_member_audit ON member_audit; DROP FUNCTION fail_member_audit()'); }
      assert.equal((await pool.query('SELECT 1 FROM accounts WHERE email=$1', [input.email.replace('EXAMPLE.COM', 'example.com')])).rowCount, 0);
      assert.equal((await pool.query('SELECT 1 FROM member_creations WHERE request_id=$1', [input.requestId])).rowCount, 0);
      await create(owner, input);
    });
    await t.test('本人/首位/跨企业停用拒绝；其他管理员可停用，保留历史并撤销全设备', async () => {
      assert.equal((await http(owner, 'members/disable', { accountId: company.accountId })).status, 403);
      assert.equal((await http(adminSession!, 'members/disable', { accountId: company.accountId })).status, 403);
      assert.equal((await http(adminSession!, 'members/disable', { accountId: admin!.accountId })).status, 403);
      assert.equal((await http(otherOwner, 'members/disable', { accountId: admin!.accountId })).status, 403);
      const list = await http(otherOwner, 'members').then(r => r.json());
      assert.equal(list.members.length, 1);
      const device2 = await login(admin!.email, next);
      assert.equal((await http(owner, 'members/disable', { accountId: admin!.accountId })).status, 201);
      assert.equal((await http(adminSession!, 'workspace')).status, 401);
      assert.equal((await http(device2, 'workspace')).status, 401);
      assert.equal((await http(empty, 'auth/login', { email: admin!.email, password: next })).status, 401);
      assert.equal((await pool.query('SELECT active FROM accounts WHERE id=$1', [admin!.accountId])).rows[0].active, false);
      assert.ok((await pool.query('SELECT 1 FROM member_creations WHERE account_id=$1', [admin!.accountId])).rowCount);
      assert.equal((await http(adminSession!, 'auth/password', { currentPassword: next, newPassword: next + '2', confirmPassword: next + '2' })).status, 401);
    });
    await t.test('临时密码72小时到期与停用受限会话均不能改密恢复启用', async () => {
      const expired = await create(owner);
      await pool.query("UPDATE accounts SET temporary_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [expired.accountId]);
      assert.equal((await http(empty, 'auth/login', { email: expired.email, password: expired.temporaryPassword })).status, 401);
      const fresh = await create(owner);
      const restricted = await login(fresh.email, fresh.temporaryPassword);
      assert.equal((await http(owner, 'members/disable', { accountId: fresh.accountId })).status, 201);
      assert.equal((await http(restricted, 'auth/password', { currentPassword: fresh.temporaryPassword, newPassword: next, confirmPassword: next })).status, 401);
    });
    await t.test('确定性账号锁：停用先于创建；锁后重新校验操作者', async () => {
      const created = await create(owner, data('admin'));
      const active = await activate(created);
      const token = active.cookie.match(/identity_session=([^;]+)/)![1];
      const identity = await (await import('../server/identity.js')).IdentityService.prototype.authenticate.call({ pool }, token);
      const blocker = await pool.connect();
      await blocker.query('BEGIN');
      await blocker.query('SELECT id FROM accounts WHERE id=$1 FOR UPDATE', [created.accountId]);
      const pending = new MemberService(pool).create(identity, token, data()).then(() => false, () => true);
      await blocker.query('UPDATE accounts SET active=false WHERE id=$1', [created.accountId]);
      await blocker.query('DELETE FROM sessions WHERE account_id=$1', [created.accountId]);
      await blocker.query('COMMIT'); blocker.release();
      assert.equal(await pending, true);
      assert.equal((await pool.query('SELECT 1 FROM member_creations WHERE actor_id=$1', [created.accountId])).rowCount, 0);
      assert.equal((await pool.query('SELECT 1 FROM sessions WHERE token_hash=$1', [digest(token)])).rowCount, 0);
    });
  } finally { await app.close(); await pool.end(); }
});
