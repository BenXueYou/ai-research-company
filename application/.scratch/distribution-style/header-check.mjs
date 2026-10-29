import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const dir = '.scratch/distribution-style';
const fixture = readFileSync(`${dir}/visual.mjs`, 'utf8').split('for (const [name, path]')[0];
writeFileSync(`${dir}/header-render.mjs`, fixture + `
for (const [view, query] of [['list', ''], ['opening', '?view=new'], ['accounts', '?view=accounts']]) {
  await page.goto('http://127.0.0.1:5290/distribution/organizations' + query);
  await page.locator('.organization-tabs').waitFor();
  if (await page.locator('.parent-context').count()) throw Error('Unexpected parent card');
  if ((await page.locator('.organization-heading').innerText()).replace(/\\s+/g, ' ').trim() !== 'ORGANIZATION MANAGEMENT 下级管理 管理直属合作组织、管理员凭据和组织状态。') throw Error('Unexpected heading');
  for (const [size, width, height] of [['desktop', 1440, 1050], ['mobile', 390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: dir + '/header-' + view + '-' + size + '.png' });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Page overflow');
  }
}
if (errors.length || writes.length) throw Error(JSON.stringify({ errors, writes }));
console.log('PASS: list/opening/accounts; desktop/mobile; parent card absent; heading matches platform; no writes or browser errors');
await browser.close();
`);
const result = spawnSync(process.execPath, [`${dir}/header-render.mjs`], { stdio: 'inherit', windowsHide: true });
process.exitCode = result.status;
