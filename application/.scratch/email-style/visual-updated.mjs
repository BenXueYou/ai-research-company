import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = server.resolvedUrls.local[0];
const browser = await chromium.launch();
const evidence = [];
try {
  const page = await browser.newPage();
  for (const [name, width] of [['desktop', 1440], ['tablet', 900], ['mobile', 390], ['small', 320]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${origin}.scratch/email-style/harness.html`);
    await page.locator('.email-recipient').first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    if (overflow) throw new Error(`${name} horizontal overflow`);
    await page.screenshot({ path: `.scratch/email-style/records-${name}-updated.png`, fullPage: true });
    evidence.push({ name, width, overflow, rows: await page.locator('.email-record').count() });
  }
  await writeFile('.scratch/email-style/visual-updated.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); await server.close(); }
