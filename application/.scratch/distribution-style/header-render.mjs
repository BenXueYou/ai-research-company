import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const phase = process.argv[2] || 'before';
const dir = '.scratch/distribution-style';
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
const writes = [];
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const organizations = [{ id: 'org-child-21', accountId: 'account-child-83', name: '远航贸易', kind: 'terminal', active: true, email: 'admin@voyage.test', phoneMasked: '139****0021' }];
const report = { role: 'distributor', grossProfit: '256.0000', organizations,
  accounts: [{ organizationId: 'org-child-21', balance: '1200.0000', queryFrozen: '20.0000', salesReserved: '100.0000', available: '1080.0000' }],
  transactions: [{ id: 'order-48', sellerId: 'org-seller-19', buyerId: 'org-child-21', quantity: '100.0000', amount: '400.0000', status: 'transferred' }],
  sales: [{ orderId: 'order-48', sellerId: 'org-seller-19', buyerId: 'org-child-21', salesAmount: '400.0000', salesCost: '144.0000', grossProfit: '256.0000' }],
  usage: [{ organizationId: 'org-child-21', source: 'product', chargedPoints: '12.0000' }],
  emailUsage: [{ organizationId: 'org-child-21', usageDay: '2026-10-29', used: '30', reserved: '5' }],
  ledger: [{ id: 'ledger-73', referenceId: 'query-91', createdAt: '2026-10-29T08:00:00Z', source: 'product', event: 'settle', amount: '12.0000', balanceAfter: '1200.0000', frozenAfter: '20.0000' }] };
await page.route('**/api/**', async route => {
  const req = route.request(), path = new URL(req.url()).pathname.replace('/api/', '');
  if (!new URL(req.url()).pathname.startsWith('/api/')) return route.continue();
  if (req.method() === 'POST') writes.push({ path, body: req.postDataJSON() });
  let body = {};
  if (path === 'auth/session') body = { id: 'actor-64', role: 'distributor', loginName: 'dist@voyage.test', email: 'dist@voyage.test', mustChange: false };
  if (path === 'organizations') body = req.method() === 'POST' ? { email: 'new@voyage.test', temporaryPassword: 'FixtureOnly123!', expiresAt: '2026-11-01T08:00:00Z' } : { parentName: '华远分销', allowedKinds: ['terminal', 'distributor'], children: organizations };
  if (path === 'reports') body = report;
  if (path === 'point-orders') body = { inventory: { balance: '8000.0000', reserved: '100.0000', average_cost: '1.4400' }, pricing: { minimum_markup: '0.1000' }, children: organizations, orders: [{ id: 'order-48', buyerId: 'org-child-21', buyerName: '远航贸易', buyerActive: true, quantity: '100.0000', unitPrice: '4.0000', amount: '400.0000', status: 'unpaid' }] };
  await route.fulfill({ json: body });
});

for (const [view, query] of [['list', ''], ['opening', '?view=new'], ['accounts', '?view=accounts']]) {
  await page.goto('http://127.0.0.1:5290/distribution/organizations' + query);
  await page.locator('.organization-tabs').waitFor();
  if (await page.locator('.parent-context').count()) throw Error('Unexpected parent card');
  if ((await page.locator('.organization-heading').innerText()).replace(/\s+/g, ' ').trim() !== 'ORGANIZATION MANAGEMENT 下级管理 管理直属合作组织、管理员凭据和组织状态。') throw Error('Unexpected heading');
  for (const [size, width, height] of [['desktop', 1440, 1050], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: dir + '/header-' + view + '-' + size + '.png' });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Page overflow');
  }
}
if (errors.length || writes.length) throw Error(JSON.stringify({ errors, writes }));
console.log('PASS: list/opening/accounts; desktop/mobile; parent card absent; heading matches platform; no writes or browser errors');
await browser.close();
