import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const baseline = readFileSync('.scratch/help-layout/before-screenshots.vue', 'utf8');
const current = readFileSync('web/pages/help/RoleHelpPage.vue', 'utf8');
const guideData = value => value.slice(value.indexOf('const guides:'), value.indexOf('</script>')).replaceAll('\r\n', '\n');
assert.equal(guideData(current), guideData(baseline));
const browser = await chromium.launch();
const results = [];
const errors = [];
const writes = [];
let links = 0;
for (const role of ['platform', 'distributor', 'admin', 'sales']) {
  const page = await browser.newPage();
  page.on('pageerror', e => { if (new URL(page.url()).pathname === '/help') errors.push(e.message); });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith('/api/')) return route.continue();
    if (route.request().method() !== 'GET') writes.push(path);
    await route.fulfill({ json: path === '/api/auth/session' ? { id: 'example-actor-64', role, loginName: 'guide@example.test', email: 'guide@example.test', mustChange: false } : {} });
  });
  for (const width of [1920, 1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('http://127.0.0.1:5184/help');
    await page.locator('.help-faq').waitFor();
    const screenshots = page.locator('.help-screenshot');
    assert.equal(await screenshots.count(), role === 'platform' ? 6 : 4);
    for (const button of await screenshots.all()) {
      await button.scrollIntoViewIfNeeded();
      const img = button.locator('img');
      await expect(img).toHaveJSProperty('complete', true);
      assert.ok(await img.evaluate(e => e.naturalWidth > 0));
      await button.click();
      const dialog = page.locator('dialog[open]');
      await expect(dialog).toBeVisible();
      assert.equal(await dialog.locator('img').getAttribute('src'), await img.getAttribute('src'));
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(button).toBeFocused();
    }
    await screenshots.first().click();
    await page.locator('dialog[open]').getByRole('button', { name: '关闭截图' }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('.console-main').scrollWidth > document.querySelector('.console-main').clientWidth), false);
    results.push({ role, width, images: await screenshots.count(), previewAndFocus: true, overflow: false });
    if (width === 1440 || width === 390) {
      await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.console-main').scrollTop = 0; });
      await page.screenshot({ path: `.scratch/help-layout/screenshots-${role}-${width}.png`, fullPage: true });
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  const expected = role === 'platform' ? ['/platform/organizations', '/platform/ledger', '/platform/ledger/procurement', '/platform/settings', '/platform/reconciliation'] : role === 'distributor' ? ['/distribution/organizations', '/distribution/orders', '/distribution/profit'] : ['/terminal/search', '/terminal/emails', ...(role === 'admin' ? ['/terminal/members'] : [])];
  expected.push('/account/settings');
  for (let i = 0; i < expected.length; i++) {
    await page.goto('http://127.0.0.1:5184/help');
    await page.locator('.help-link').nth(i).click();
    await page.waitForURL(url => url.pathname === expected[i]);
    links++;
  }
  await page.close();
}
await browser.close();
// Destination fixtures are outside scope; only help page errors count in this verification.
assert.deepEqual(writes, []);
assert.deepEqual(errors, []);
writeFileSync('.scratch/help-layout/screenshot-results.json', JSON.stringify({ guideDataUnchanged: true, results, links, writes, errors }, null, 2));
console.log(JSON.stringify({ viewportChecks: results.length, links, writes, errors }));
