import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
const base = 'http://127.0.0.1:5184';
const out = 'public/help/screenshots';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const captures = [
  ['platform', '/platform/organizations?view=new', 'platform-organizations'],
  ['platform', '/platform/ledger', 'platform-orders'],
  ['platform', '/platform/ledger/procurement', 'procurement'],
  ['platform', '/platform/settings', 'pricing'],
  ['platform', '/platform/reconciliation', 'reconciliation'],
  ['distributor', '/distribution/organizations?view=new', 'distribution-organizations'],
  ['distributor', '/distribution/orders', 'distribution-orders'],
  ['distributor', '/distribution/profit', 'profit'],
  ['admin', '/terminal/search', 'search'],
  ['admin', '/terminal/emails', 'emails'],
  ['admin', '/terminal/members', 'members'],
  ['sales', '/terminal/sending-settings', 'sales-permissions'],
  ['admin', '/account/settings', 'account']
];
const children = [{ id: 'example-org-21', accountId: 'example-account-83', name: '远航贸易（示例）', kind: 'terminal', active: true, email: 'admin@example.test', phoneMasked: '139****0021' }];
const inventory = { balance: '8000.0000', frozen: '0.0000', reserved: '100.0000', available: '7900.0000', average_cost: '1.4400', minimum_sale_price: '1.5840' };
const errors = [];
for (const [role, path, name] of captures) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push({ name, error: e.message }));
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (!url.pathname.startsWith('/api/')) return route.continue();
    if (route.request().method() !== 'GET') throw Error('Capture must not submit');
    const endpoint = url.pathname.slice(5);
    let data = {};
    if (endpoint === 'auth/session') data = { id: 'example-actor-64', role, loginName: 'guide@example.test', email: 'guide@example.test', mustChange: false };
    if (endpoint === 'organizations') data = { parentName: '示例组织', allowedKinds: ['terminal', 'distributor'], children };
    if (endpoint === 'point-orders') data = { inventory, pricing: { minimum_markup: '0.1000' }, children, orders: [{ id: 'example-order-48', buyerId: 'example-org-21', buyerName: '远航贸易（示例）', buyerActive: true, quantity: '100.0000', unitPrice: '4.0000', amount: '400.0000', status: 'unpaid' }] };
    if (endpoint === 'procurement') data = { currency: 'CNY', inventory, pricing: { coefficient: '1.0000', minimum_markup: '0.1000' }, totals: { recorded_upstream_credits: '8000.0000', cash_outflow: '11520.0000', expenses: '0.0000' }, prices: [], purchases: [], expenses: [], ledger: [] };
    if (endpoint === 'coefficient') data = { current: '1.0000', changes: [] };
    if (endpoint === 'upstream-monitor') data = { snapshot: null, usage: null, events: [], configured: false };
    if (endpoint.endsWith('/reconciliations')) data = [];
    if (endpoint === 'reports') data = { role, grossProfit: '256.0000', organizations: children, accounts: [], transactions: [], sales: [], usage: [], emailUsage: [], ledger: [] };
    if (endpoint === 'members') data = { members: [{ id: 'example-member-45', name: '示例业务员', email: 'sales@example.test', role: 'sales', active: true, canDisable: true }] };
    if (endpoint === 'email-batches') data = { batches: [{ id: 'example-batch-72', profileId: 'example-profile-92', channel: 'smtp', count: 3, usageDay: '2026-10-29', accepted: 2, delivered: 1, uncertain: 1, paused: 0, replyTo: 'team@example.test' }] };
    if (endpoint === 'sending-channels/smtp') data = { channel: null };
    if (endpoint === 'sending-channels/umail') data = { resource: null, channel: null };
    await route.fulfill({ json: data });
  });
  await page.goto(base + path);
  await page.locator('.console-main').waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector('.console-main').scrollTop = 0;
  });
  const main = page.locator('.console-main');
  const box = await main.boundingBox();
  await page.screenshot({ path: `${out}/${name}.png`, clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 930) } });
  console.log(name);
  await page.close();
}
await browser.close();
writeFileSync('.scratch/help-layout/capture-results.json', JSON.stringify({ captures, errors }, null, 2));
if (errors.length) throw Error(JSON.stringify(errors));
