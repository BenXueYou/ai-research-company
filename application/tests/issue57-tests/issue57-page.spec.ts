import { test, expect } from '@playwright/test';

test('独立页面保持管理员提交映射和业务员只读', async ({ page }) => {
  await page.goto('/tests/issue57-tests/fixtures/index.html?role=admin');
  await expect(page.getByRole('heading', { name: '团队发信设置' })).toBeVisible();
  await page.locator('#smtp-host').fill('smtp.example.test');
  await page.locator('#smtp-port').fill('587');
  await page.locator('#smtp-security').selectOption('starttls');
  await page.locator('#smtp-username').fill('sender@example.test');
  await page.locator('#smtp-credential').fill('fixture-secret');
  await page.locator('#smtp-reply-to').fill('reply@example.test');
  await page.getByRole('button', { name: '验证设置并保存' }).click();
  await expect(page.locator('#smtp-credential')).toHaveValue('');
  await expect(page.getByTestId('smtp-reply-to')).toHaveText('reply@example.test');
  await page.locator('#umail-domain').fill('mail.example.test');
  await page.locator('#umail-sender-address').fill('send@mail.example.test');
  await page.locator('#umail-reply-address').fill('another-reply@example.test');
  await page.getByRole('button', { name: '核验域名渠道并保存' }).click();
  await expect(page.getByTestId('umail-reply-address')).toHaveText('another-reply@example.test');
  const calls = await page.evaluate(() => (window as unknown as { issue57Calls: Array<{ path: string; body?: Record<string, unknown> }> }).issue57Calls);
  const smtp = calls.find(item => item.path === 'sending-channels/smtp' && item.body)?.body;
  const umail = calls.find(item => item.path === 'sending-channels/umail' && item.body)?.body;
  expect(smtp).toMatchObject({ host: 'smtp.example.test', port: '587', security: 'starttls', username: 'sender@example.test', credential: 'fixture-secret', replyTo: 'reply@example.test', defaultChannel: false });
  expect(umail).toMatchObject({ domain: 'mail.example.test', senderAddress: 'send@mail.example.test', replyAddress: 'another-reply@example.test', defaultChannel: false });
  expect(Object.keys(smtp!).sort()).toEqual(['credential', 'defaultChannel', 'host', 'port', 'replyTo', 'requestId', 'security', 'username'].sort());
  expect(Object.keys(umail!).sort()).toEqual(['defaultChannel', 'domain', 'replyAddress', 'requestId', 'senderAddress'].sort());
  await page.goto('/tests/issue57-tests/fixtures/index.html?role=sales');
  await expect(page.getByText('业务员可查看团队渠道状态，但不能维护设置。')).toBeVisible();
  await expect(page.locator('#smtp-host')).toHaveCount(0);
  await expect(page.locator('#umail-domain')).toHaveCount(0);
  const salesCalls = await page.evaluate(() => (window as unknown as { issue57Calls: Array<{ body?: unknown }> }).issue57Calls);
  expect(salesCalls).toHaveLength(2);
  expect(salesCalls.every(item => item.body === undefined)).toBe(true);
});

