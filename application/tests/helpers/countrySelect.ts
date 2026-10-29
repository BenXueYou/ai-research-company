import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export async function selectCountries(page: Page, root: Locator | Page, codes: string) {
  const select = root.locator('.country-select');
  while (await select.locator('.el-tag__close').count()) {
    const count = await select.locator('.el-tag__close').count();
    await select.locator('.el-tag__close').first().click();
    await expect(select.locator('.el-tag__close')).toHaveCount(count - 1);
  }
  const input = select.getByRole('combobox');
  for (const code of codes.split(',')) {
    await input.fill(code);
    await page.getByRole('option', { name: new RegExp(`(?:^|\\s)${code}$`) }).click({ timeout: 10000 });
  }
  await input.press('Escape');
  await root.getByLabel('公司名称', { exact: true }).click();
}

export async function selectCountry(page: Page, root: Locator, code: string) {
  const input = root.locator('.country-select').getByRole('combobox');
  await input.fill(code);
  await page.getByRole('option', { name: new RegExp(`(?:^|\\s)${code}$`) }).click();
  await input.press('Escape');
}
