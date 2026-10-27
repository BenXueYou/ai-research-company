import { randomBytes, randomUUID } from 'node:crypto';
import { database, migrate } from '../server/database.js';
import { createApplication } from '../server/app.js';

// Dedicated T06 container/port; never loads .env or T02's TEST_DATABASE_URL.
export async function procurementDatabase() {
  const name = `t06_${randomUUID().replaceAll('-', '')}_test`;
  const admin = database('postgresql://postgres@127.0.0.1:55436/postgres');
  try { await admin.query(`CREATE DATABASE "${name}"`); }
  finally { await admin.end(); }
  const pool = database(`postgresql://postgres@127.0.0.1:55436/${name}`);
  process.env.ORG_CONTACT_KEY = randomBytes(32).toString('hex');
  await migrate(pool);
  return { pool, name };
}
export async function procurementHttp(port = 3095) {
  const { pool, name } = await procurementDatabase();
  const origin = `http://127.0.0.1:${port}`;
  const app = await createApplication(pool, origin);
  await app.listen(port, '127.0.0.1');
  type Session = { cookie: string; csrf: string };
  const anonymous: Session = { cookie: '', csrf: '' };
  async function http(path: string, body?: object, session = anonymous) {
    return fetch(`${origin}/api/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
      body: body ? JSON.stringify(body) : undefined });
  }
  async function login(email: string, password: string): Promise<Session> {
    const response = await http('auth/login', { email, password });
    if (response.status!==200) throw new Error(`Login failed: ${response.status}`);
    const cookies = response.headers.getSetCookie().map(item => item.split(';')[0]);
    return { cookie: cookies.join('; '), csrf: cookies.find(item => item.startsWith('identity_csrf='))!.slice(14) };
  }
  return { pool, name, app, origin, http, login };
}
