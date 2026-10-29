import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const before = execFileSync('git', ['show', 'HEAD:application/web/pages/help/RoleHelpPage.vue'], { encoding: 'utf8' });
const after = readFileSync('web/pages/help/RoleHelpPage.vue', 'utf8');
assert.equal(before.replaceAll('\r\n', '\n').split('<script setup lang="ts">')[1].split('</script>')[0], after.replaceAll('\r\n', '\n').split('<script setup lang="ts">')[1].split('</script>')[0]);
assert.deepEqual([...after.matchAll(/<p>([^<{]+)<\/p>/g)].map(m => m[1]), [...before.matchAll(/<p>([^<{]+)<\/p>/g)].map(m => m[1]));
const expected = {
  platform: ['/platform/organizations', '/platform/ledger', '/platform/ledger/procurement', '/platform/settings', '/platform/reconciliation', '/account/settings'],
  distributor: ['/distribution/organizations', '/distribution/orders', '/distribution/profit', '/account/settings'],
  admin: ['/terminal/search', '/terminal/emails', '/terminal/members', '/account/settings'],
  sales: ['/terminal/search', '/terminal/emails', '/account/settings']
};
const browser = await chromium.launch();
const results = [];
const errors = [];
for (const role of Object.keys(expected)) {
  const page = await browser.newPage();
  page.on('pageerror', e => { if (new URL(page.url()).pathname === '/help') errors.push(e.message); });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    assert.equal(route.request().method(), 'GET', 'Help must not submit business writes');
    await route.fulfill({ json: path === '/api/auth/session' ? { id: 'layout-actor-64', role, email: 'layout@example.test', loginName: 'layout@example.test', mustChange: false } : {} });
  });
  for (const width of [1920, 1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1080 });
    await page.goto('http://127.0.0.1:5183/help');
    await page.locator('.help-faq').waitFor();
    const layout = await page.locator('.role-help').evaluate(root => {
      const box = root.getBoundingClientRect();
      const main = document.querySelector('.console-main').getBoundingClientRect();
      const grid = root.querySelector('.help-guides');
      const cards = [...grid.children].map(e => ({ x: e.getBoundingClientRect().x, width: e.getBoundingClientRect().width }));
      return { width: box.width, centered: Math.abs((box.left + box.right) / 2 - (main.left + main.right) / 2) < 4, columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, cards, overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('.console-main').scrollWidth > document.querySelector('.console-main').clientWidth };
    });
    assert.equal(layout.overflow, false);
    assert.equal(layout.centered, true);
    assert.equal(layout.columns, layout.width >= 960 ? 2 : 1);
    if (layout.columns === 2) assert.ok(Math.abs(layout.cards.at(-1).width - layout.width) < 2);
    results.push({ role, viewport: width, ...layout });
    if (role === 'distributor' && [1920, 390].includes(width)) await page.screenshot({ path: `.scratch/help-layout/${role}-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1080 });
  for (let i = 0; i < expected[role].length; i++) {
    await page.goto('http://127.0.0.1:5183/help');
    // Destination business data is outside this layout check; verify the router target only.
    await page.locator('.role-help .help-link').nth(i).click();
    await page.waitForURL(url => url.pathname === expected[role][i]);
  }
  await page.goto('http://127.0.0.1:5183/help');
  await page.locator('.role-help .help-link').first().focus();
  assert.ok(await page.locator('.role-help .help-link').first().evaluate(e => getComputedStyle(e).outlineStyle !== 'none'));
  if (role === 'sales') assert.equal(await page.locator('.help-guide').last().locator('button').count(), 0);
  await page.close();
}
await browser.close();
assert.deepEqual(errors, []);
writeFileSync('.scratch/help-layout/results.json', JSON.stringify({ scriptAndCopyUnchanged: true, navigationChecks: 17, results, errors }, null, 2));
console.log(JSON.stringify({ viewportChecks: results.length, navigationChecks: 17, scriptAndCopyUnchanged: true, errors }));
