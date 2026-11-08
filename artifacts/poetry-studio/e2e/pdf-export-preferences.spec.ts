import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

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
    JSON.stringify({ pageSize: 'a5', margins: 'wide', orientation: 'landscape', customWidthInches: 8.5, customHeightInches: 11 }),
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

test('resets poem and book PDF choices to standard defaults and saves them', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('button-export').click();
  await page.locator(pageSize).selectOption('custom');
  await page.getByTestId('input-pdf-custom-width').fill('10.5');
  await page.getByTestId('input-pdf-custom-height').fill('14');
  await page.locator(margins).selectOption('wide');
  await page.locator(orientation).selectOption('landscape');
  await page.getByTestId('button-reset-pdf-options').click();
  await expectDefaultPdfOptions(page);
  await expect(page.getByTestId('input-pdf-custom-width')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('poetry-studio-pdf-export-options'))).toBe(
    JSON.stringify({ pageSize: 'letter', margins: 'standard', orientation: 'portrait', customWidthInches: 8.5, customHeightInches: 11 }),
  );

  await page.reload();
  await page.getByTestId('button-export').click();
  await expectDefaultPdfOptions(page);
  await page.getByRole('button', { name: 'Close dialog' }).click();

  await page.locator('[data-testid^="button-export-book-"]').first().click();
  await page.locator(pageSize).selectOption('a4');
  await page.locator(margins).selectOption('narrow');
  await page.locator(orientation).selectOption('landscape');
  await page.getByTestId('button-reset-pdf-options').click();
  await expectDefaultPdfOptions(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('poetry-studio-pdf-export-options'))).toBe(
    JSON.stringify({ pageSize: 'letter', margins: 'standard', orientation: 'portrait', customWidthInches: 8.5, customHeightInches: 11 }),
  );

  await page.reload();
  await page.locator('[data-testid^="button-export-book-"]').first().click();
  await expectDefaultPdfOptions(page);
});

test('downloads landscape PDFs from both poem and book export dialogs', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('button-export').click();
  await expect(page.locator(orientation).locator('option')).toHaveText(['Portrait', 'Landscape']);
  await page.locator(pageSize).selectOption('a5');
  await page.locator(orientation).selectOption('landscape');
  await expect(page.locator(orientation)).toHaveValue('landscape');

  const poemDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-export-pdf').click();
  const poemDownload = await poemDownloadPromise;
  const poemPdf = (await readFile(await poemDownload.path())).toString('latin1');
  expect(poemPdf).toContain('/MediaBox [0 0 595.28 419.53]');
  expect(poemPdf).not.toContain('/MediaBox [0 0 419.53 595.28]');

  await page.locator('[data-testid^="button-export-book-"]').first().click();
  await expect(page.locator(orientation).locator('option')).toHaveText(['Portrait', 'Landscape']);
  await page.locator(pageSize).selectOption('a5');
  await page.locator(orientation).selectOption('landscape');
  await expect(page.locator(orientation)).toHaveValue('landscape');

  const bookDownloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-download-book-pdf').click();
  const bookDownload = await bookDownloadPromise;
  const bookPdf = (await readFile(await bookDownload.path())).toString('latin1');
  expect(bookPdf).toContain('/MediaBox [0 0 595.28 419.53]');
  expect(bookPdf).not.toContain('/MediaBox [0 0 419.53 595.28]');
});
