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
for (const [name, path] of [['orders', '/distribution/orders'], ['profit', '/distribution/profit'], ['opening', '/distribution/organizations?view=new']]) {
  await page.goto('http://127.0.0.1:5290' + path);
  await page.locator(name === 'orders' ? '#order-buyer' : name === 'profit' ? '.metric-card' : '#organization-name').waitFor();
  if (name === 'opening') await page.getByRole('button', { name: '确认开户', exact: true }).waitFor({ state: 'visible' });
  await page.screenshot({ path: `${dir}/${phase}-${name}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/${phase}-${name}-mobile.png` });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(name + ' page overflow');
  await page.setViewportSize({ width: 1440, height: 1050 });
  if (name === 'orders') {
    await page.locator('#order-buyer').selectOption('org-child-21');
    await page.locator('#order-quantity').fill('17.2500');
    await page.locator('#order-price').fill('4.2500');
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/point-orders') && r.request().method() === 'POST'), page.getByRole('button', { name: '建单', exact: true }).click()]);
    await page.getByRole('button', { name: '确认足额收款', exact: true }).click();
    await page.locator('#receipt-reference').fill('receipt-dist-52');
    await Promise.all([page.waitForResponse(r => r.url().endsWith('/api/point-orders/confirm')), page.getByRole('button', { name: '登记足额收款', exact: true }).click()]);
  }
  if (name === 'opening') {
    await page.locator('#organization-name').fill('新远航企业');
    await page.locator('#organization-kind').selectOption('terminal');
    await page.locator('#country-code').fill('+65');
    await page.locator('#organization-phone').fill('81234567');
    await page.locator('#administrator-email').fill('new@voyage.test');
    await page.getByRole('button', { name: '确认开户', exact: true }).click();
    await page.getByTestId('handoff-password').waitFor();
  }
}
if (errors.length) throw Error(errors.join('\n'));
const normalized = writes.map(({path, body: { requestId, ...body }}) => ({path, body}));
writeFileSync(`${dir}/${phase}-requests.json`, JSON.stringify(normalized, null, 2));
if (phase === 'after' && JSON.stringify(normalized) !== JSON.stringify(JSON.parse(readFileSync(`${dir}/before-requests.json`, 'utf8')))) throw Error('Request contract changed');
console.log(JSON.stringify({ phase, screenshots: 6, requests: normalized, browserErrors: errors }));
await browser.close();
