import { test, expect } from '@playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

let server: ViteDevServer;
test.beforeAll(async () => {
  await mkdir('.scratch/platform-integration-fixture', { recursive: true });
  await writeFile('.scratch/platform-integration-fixture/index.html', `
<div id="app"></div>
<script type="module">
import { createApp, defineComponent, h, ref, KeepAlive } from 'vue';
import { createRouter, createWebHistory, RouterView } from 'vue-router';
import { provideFormLeave, useFormLeave } from '/web/router/formLeave.ts';
const states = { a: ref('clean'), b: ref('clean') };
const discards = { a: ref(0), b: ref(0) };
const mounted = ref(true);
const blocked = ref(false);
let control;
function editor(name) {
  return defineComponent({
    name: 'Editor' + name,
    setup() {
      useFormLeave({
        state: () => states[name].value,
        discard: () => { discards[name].value++; states[name].value = 'clean'; },
        retainUnknown: name === 'a'
      });
      return () => h('p', { id: 'editor' }, name);
    }
  });
}
const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/guard-a', component: editor('a') },
    { path: '/guard-b', component: editor('b') },
    { path: '/guard-empty', component: { render: () => h('p', 'empty') } }
  ]
});
const app = createApp({
  setup() {
    control = provideFormLeave(router, () => true);
    return () => h('div', [
      ...['a', 'b'].map(name => h('div', [
        h('select', { id: 'state-' + name, value: states[name].value, onChange: e => states[name].value = e.target.value },
          ['clean', 'dirty', 'submitting', 'unknown'].map(value => h('option', { value }, value))),
        h('output', { id: 'discard-' + name }, discards[name].value)
      ])),
      ...['a', 'b', 'empty'].map(name => h('button', { onClick: () => router.push('/guard-' + name) }, 'go-' + name)),
      h('button', { onClick: () => router.push({ path: router.currentRoute.value.path, query: { page: '2' } }) }, 'update'),
      h('button', { onClick: () => { const commit = control.prepareLeave(); if (commit) commit(); } }, 'logout'),
      h('button', { onClick: () => mounted.value = !mounted.value }, 'mount'),
      h('button', { onClick: () => blocked.value = !blocked.value }, 'block'),
      mounted.value ? h(RouterView, null, { default: ({ Component }) => h(KeepAlive, null, [h(Component)]) }) : null
    ]);
  }
});
app.use(router);
await router.replace('/guard-a');
app.mount('#app');
router.beforeResolve(() => !blocked.value);
</script>`);
  server = await createServer({
    configFile: resolve('vite.config.ts'),
    server: { host: '127.0.0.1', port: 5184, strictPort: true },
    cacheDir: '.scratch/platform-integration-vite-cache'
  });
  await server.listen();
});
test.afterAll(async () => { await server?.close(); });

test('开发入口仅允许已确认的前端 History GET/HEAD', async ({ request }) => {
  for (const path of [
    '/platform/ledger/procurement', '/platform/settings', '/platform/settings/umail',
    '/platform/settings/email-quota', '/platform/organizations/business-data',
    '/platform/reconciliation/upstream'
  ]) {
    const response = await request.get('http://127.0.0.1:5184' + path);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/html');
    expect((await request.head('http://127.0.0.1:5184' + path)).status()).toBe(200);
  }
  for (const path of ['/assets/missing-integration.js', '/unknown-integration']) {
    expect((await request.get('http://127.0.0.1:5184' + path)).status()).toBe(404);
  }
});

test('两个登记方的隔离、后续守卫取消、参数更新、缓存停用与注销', async ({ page }) => {
  await page.goto('http://127.0.0.1:5184/.scratch/platform-integration-fixture/index.html');
  await expect(page.locator('#editor')).toHaveText('a');
  await page.locator('#state-a').selectOption('dirty');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'go-b', exact: true }).click();
  await expect(page).toHaveURL(/guard-a$/);
  await expect(page.locator('#discard-a')).toHaveText('0');
  await page.getByRole('button', { name: 'block', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'go-b', exact: true }).click();
  await expect(page).toHaveURL(/guard-a$/);
  await expect(page.locator('#state-a')).toHaveValue('dirty');
  await page.getByRole('button', { name: 'block', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'update', exact: true }).click();
  await expect(page).toHaveURL(/guard-a\?page=2$/);
  await expect(page.locator('#discard-a')).toHaveText('1');
  await page.locator('#state-a').selectOption('submitting');
  await page.getByRole('button', { name: 'go-b', exact: true }).click();
  await expect(page).toHaveURL(/guard-a\?page=2$/);
  await page.locator('#state-a').selectOption('unknown');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'go-b', exact: true }).click();
  await expect(page.locator('#editor')).toHaveText('b');
  await expect(page.locator('#state-a')).toHaveValue('unknown');
  await page.locator('#state-b').selectOption('unknown');
  await page.getByRole('button', { name: 'go-empty', exact: true }).click();
  await expect(page).toHaveURL(/guard-b$/);
  await page.locator('#state-b').selectOption('dirty');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'go-empty', exact: true }).click();
  await expect(page.locator('#discard-a')).toHaveText('1');
  await expect(page.locator('#discard-b')).toHaveText('1');
  // Cached unknown context still protects logout and refresh, but not other pages.
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'logout', exact: true }).click();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);
  await page.getByRole('button', { name: 'mount', exact: true }).click();
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
});
