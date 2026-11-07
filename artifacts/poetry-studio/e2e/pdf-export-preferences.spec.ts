import { expect, test } from '@playwright/test';

const pageSize = '[data-testid="select-pdf-page-size"]';
const margins = '[data-testid="select-pdf-margins"]';
const orientation = '[data-testid="select-pdf-orientation"]';

async function expectDefaultPdfOptions(page: import('@playwright/test').Page) {
  await expect(page.locator(pageSize)).toHaveValue('letter');
  await expect(page.locator(margins)).toHaveValue('standard');
  await expect(page.locator(orientation)).toHaveValue('portrait');
}

test('restores PDF print choices after reload in poem and book export dialogs', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('button-export').click();
  await page.locator(pageSize).selectOption('a5');
  await page.locator(margins).selectOption('wide');
  await page.locator(orientation).selectOption('landscape');

  await expect.poll(() => page.evaluate(() => localStorage.getItem('poetry-studio-pdf-export-options'))).toBe(
    JSON.stringify({ pageSize: 'a5', margins: 'wide', orientation: 'landscape' }),
  );

  await page.reload();
  await page.getByTestId('button-export').click();
  await expect(page.locator(pageSize)).toHaveValue('a5');
  await expect(page.locator(margins)).toHaveValue('wide');
  await expect(page.locator(orientation)).toHaveValue('landscape');

  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.locator('[data-testid^="button-export-book-"]').first().click();
  await expect(page.locator(pageSize)).toHaveValue('a5');
  await expect(page.locator(margins)).toHaveValue('wide');
  await expect(page.locator(orientation)).toHaveValue('landscape');

  await page.evaluate(() => localStorage.setItem(
    'poetry-studio-pdf-export-options',
    JSON.stringify({ pageSize: 'tabloid', margins: 'huge', orientation: 'sideways' }),
  ));
  await page.reload();
  await page.getByTestId('button-export').click();
  await expectDefaultPdfOptions(page);

  await page.evaluate(() => localStorage.removeItem('poetry-studio-pdf-export-options'));
  await page.reload();
  await page.getByTestId('button-export').click();
  await expectDefaultPdfOptions(page);
});
