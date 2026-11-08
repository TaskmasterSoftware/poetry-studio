import { expect, test } from '@playwright/test';

test('saves searchable poem metadata and keeps separate publisher submissions', async ({ page }) => {
  await page.goto('/');
  const poemId = await page.getByTestId('select-browser-draft').inputValue();
  await page.getByTestId('nav-metadata').click();

  await page.getByTestId('input-metadata-date-written').fill('2025-03-10');
  await page.getByTestId('input-metadata-form').fill('Ghazal');
  await page.getByTestId('input-metadata-tag').fill('winter');
  await page.getByTestId('input-metadata-tag').press('Enter');
  await page.getByTestId('textarea-metadata-notes').fill('A blue harbor at dusk');

  await page.getByTestId('button-add-submission').click();
  await page.getByTestId('input-submission-publisher-1').fill('North Review');
  await page.getByTestId('input-submission-website-1').fill('https://north.example');
  await page.getByTestId('input-submission-date-1').fill('2025-04-01');
  await page.getByTestId('select-submission-status-1').selectOption('rejected');
  await page.getByTestId('input-submission-decision-date-1').fill('2025-05-01');
  await page.getByTestId('textarea-submission-notes-1').fill('Try a different poem next time.');

  await page.getByTestId('button-add-submission').click();
  await page.getByTestId('input-submission-publisher-2').fill('North Review');
  await page.getByTestId('input-submission-website-2').fill('https://north.example');
  await page.getByTestId('input-submission-date-2').fill('2025-06-01');

  await expect.poll(() => page.evaluate((id) => {
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      id: string;
      metadata?: { submissions?: Array<{ publisher: string; status: string }> };
    }>;
    return drafts.find((draft) => draft.id === id)?.metadata?.submissions?.length ?? 0;
  }, poemId)).toBe(2);

  await page.getByTestId('input-poem-search').fill('north review rejected');
  await expect(page.getByTestId(`search-result-poem-${poemId}`)).toBeVisible();
  await page.getByTestId('button-clear-poem-search').click();
  await page.reload();

  await page.getByTestId('nav-metadata').click();
  await expect(page.getByTestId('input-metadata-date-written')).toHaveValue('2025-03-10');
  await expect(page.getByTestId('input-metadata-form')).toHaveValue('Ghazal');
  await expect(page.getByTestId('textarea-metadata-notes')).toHaveValue('A blue harbor at dusk');
  await expect(page.getByTestId('select-submission-status-1')).toHaveValue('rejected');
  await expect(page.getByTestId('select-submission-status-2')).toHaveValue('pending');
  await expect(page.getByTestId('input-submission-date-2')).toHaveValue('2025-06-01');
});
