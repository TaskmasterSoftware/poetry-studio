import { expect, test } from '@playwright/test';

test('lists forms alphabetically and exposes example links for each form', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-forms').click();

  const cards = page.locator('.form-item');
  const count = await cards.count();
  expect(count).toBeGreaterThanOrEqual(34);
  const names = await cards.locator('strong').allTextContents();
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' })));
  for (let index = 0; index < count; index++) {
    await expect(cards.nth(index).getByRole('link', { name: /^Read example:/ })).toHaveAttribute('href', /^https?:\/\//);
  }

  await page.getByTestId('input-form-search').fill('cinquin');
  await expect(page.locator('.form-item')).toHaveCount(1);
  await expect(page.locator('.form-item')).toContainText('Cinquain');
  await expect(page.locator('.form-item').getByRole('link')).toHaveAttribute('href', /gutenberg\.org/);
});

test('checks the poem against a form and reports potential diversions', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('nav-forms').click();
  await page.getByTestId('button-check-form-haiku').click();

  const report = page.getByTestId('panel-form-check');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Haiku');
  await expect(page.getByTestId('form-check-summary')).toContainText(/potential diversion/i);
  await expect(page.getByTestId('form-line-check-1')).toBeVisible();
  await page.getByTestId('button-recheck-form').click();
  await expect(report).toBeVisible();
});
