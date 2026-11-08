import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

test('adds and edits book pages, then places them on the selected sides in PDF', async ({ page }) => {
  await page.goto('/');
  const shelf = page.locator('[data-testid^="shelf-book-"]').first();
  const shelfTestId = await shelf.getAttribute('data-testid');
  const bookId = shelfTestId?.slice('shelf-book-'.length);
  expect(bookId).toBeTruthy();

  await page.getByTestId(`button-edit-book-pages-${bookId}`).click();
  await expect(page.getByTestId('book-pages-editor')).toBeVisible();

  await page.getByTestId('select-book-page-type').selectOption('title-page');
  await page.getByTestId('button-add-book-page').click();
  const titlePage = page.locator('.book-page-card').first();
  const titlePageId = (await titlePage.getAttribute('data-testid'))?.slice('book-page-card-'.length);
  expect(titlePageId).toBeTruthy();
  await page.getByTestId(`input-book-page-title-${titlePageId}`).fill('A Test Collection');
  await page.getByTestId(`textarea-book-page-content-${titlePageId}`).fill('By Example Poet');

  await page.getByTestId('select-book-page-type').selectOption('copyright');
  await page.getByTestId('button-add-book-page').click();
  const copyrightPage = page.locator('.book-page-card').nth(1);
  const copyrightPageId = (await copyrightPage.getAttribute('data-testid'))?.slice('book-page-card-'.length);
  expect(copyrightPageId).toBeTruthy();
  await page.getByTestId(`textarea-book-page-content-${copyrightPageId}`).fill('Copyright 2026 Example Poet');
  await expect(page.getByTestId(`select-book-page-side-${copyrightPageId}`)).toHaveValue('verso');

  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByTestId(`button-edit-book-pages-${bookId}`).click();
  await expect(page.getByTestId(`input-book-page-title-${titlePageId}`)).toHaveValue('A Test Collection');
  await expect(page.getByTestId(`textarea-book-page-content-${copyrightPageId}`)).toHaveValue('Copyright 2026 Example Poet');
  await page.getByRole('button', { name: 'Done' }).click();

  await page.getByTestId(`button-export-book-${bookId}`).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('button-download-book-pdf').click();
  const download = await downloadPromise;
  const filePath = await download.path();
  expect(filePath).toBeTruthy();
  const pdf = await readFile(filePath!);
  const pdfText = pdf.toString('latin1');
  const pdfHex = (value: string) => Buffer.from(value, 'latin1').toString('hex').toUpperCase();

  expect(pdfText).toContain(`<${pdfHex('A Test Collection')}>`);
  expect(pdfText).toContain(`<${pdfHex('Copyright 2026 Example Poet')}>`);
  expect(Number(pdfText.match(/\/Count (\d+)/)?.[1])).toBe(5);
});
