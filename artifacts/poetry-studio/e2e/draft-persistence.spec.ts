import { expect, test } from '@playwright/test';

const titleInput = '[data-testid="input-poem-title"]';
const editor = '[data-testid="editor-manuscript"]';
const draftSwitcher = '[data-testid="select-browser-draft"]';

async function expectDraft(page: import('@playwright/test').Page, title: string, lines: string[]) {
  await expect(page.locator(titleInput)).toHaveValue(title);
  const manuscript = await page.locator(editor).innerText();
  for (const line of lines) expect(manuscript).toContain(line);
}

test('keeps each draft and imported source paired through switching and reload', async ({ page }) => {
  await page.goto('/');

  const firstTitle = 'Harbor at dawn';
  const firstLines = ['The harbor wakes', 'Blue glass holds the light'];
  await page.locator(titleInput).fill(firstTitle);
  await page.locator(editor).fill(firstLines.join('\n'));

  await page.getByTestId('button-new-draft').click();
  const secondTitle = 'Rain in the orchard';
  const secondLines = ['Rain counts the leaves', 'Apples darken in the grass'];
  await page.locator(titleInput).fill(secondTitle);
  await page.locator(editor).fill(secondLines.join('\n'));

  await page.locator(draftSwitcher).selectOption({ label: firstTitle });
  await expectDraft(page, firstTitle, firstLines);
  await page.locator(draftSwitcher).selectOption({ label: secondTitle });
  await expectDraft(page, secondTitle, secondLines);

  const importedFileName = 'winter-window.txt';
  const importedTitle = 'Winter window';
  const importedLines = ['Frost gathers on the pane', 'A small lamp answers'];
  await page.getByTestId('input-open-poem').setInputFiles({
    name: importedFileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(`${importedTitle}\n\n${importedLines.join('\n')}`),
  });
  await expectDraft(page, importedTitle, importedLines);
  const importedDraftId = await page.locator(draftSwitcher).inputValue();

  await page.reload();
  await expectDraft(page, importedTitle, importedLines);
  await expect(page.getByTestId('button-open-poem')).toHaveAttribute('title', new RegExp(importedFileName));

  const importedDraft = await page.evaluate((draftId) => {
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      id: string;
      source: { fileName: string; format: string } | null;
    }>;
    return drafts.find((draft) => draft.id === draftId);
  }, importedDraftId);
  expect(importedDraft?.source).toEqual({ fileName: importedFileName, format: 'txt' });

  await page.locator(draftSwitcher).selectOption({ label: firstTitle });
  await expectDraft(page, firstTitle, firstLines);
  await expect(page.getByTestId('button-open-poem')).not.toHaveAttribute('title', new RegExp(importedFileName));

  await page.locator(draftSwitcher).selectOption({ label: secondTitle });
  await expectDraft(page, secondTitle, secondLines);
  await page.reload();
  await expectDraft(page, secondTitle, secondLines);

  await page.locator(draftSwitcher).selectOption({ label: importedTitle });
  await expectDraft(page, importedTitle, importedLines);
  await expect(page.getByTestId('button-open-poem')).toHaveAttribute('title', new RegExp(importedFileName));
});

test('confirms draft removal, switches safely, and keeps remaining drafts after reload', async ({ page }) => {
  await page.goto('/');
  await page.locator(titleInput).fill('Keep this poem');
  await page.locator(editor).fill('Still here after reload');

  await page.getByTestId('button-new-draft').click();
  await page.locator(titleInput).fill('Remove this poem');
  await page.locator(editor).fill('This draft will be removed');

  const activeDraftBeforeCancel = await page.locator(draftSwitcher).inputValue();
  await page.getByTestId('button-remove-draft').click();
  await expect(page.getByRole('alertdialog')).toContainText('Remove this poem?');
  await page.getByTestId('button-cancel-remove-draft').click();
  await expect(page.locator(draftSwitcher)).toHaveValue(activeDraftBeforeCancel);
  await expectDraft(page, 'Remove this poem', ['This draft will be removed']);

  await page.getByTestId('button-remove-draft').click();
  await page.getByTestId('button-confirm-remove-draft').click();
  await expectDraft(page, 'Keep this poem', ['Still here after reload']);
  await expect(page.locator(draftSwitcher).locator('option')).toHaveCount(1);

  const storedDrafts = await page.evaluate(() => JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{ title: string }>);
  expect(storedDrafts.map((draft) => draft.title)).toEqual(['Keep this poem']);
  await page.reload();
  await expectDraft(page, 'Keep this poem', ['Still here after reload']);

  await page.getByTestId('button-remove-draft').click();
  await page.getByTestId('button-confirm-remove-draft').click();
  await expect(page.locator(draftSwitcher).locator('option')).toHaveCount(1);
  await expect(page.locator(titleInput)).toHaveValue('Untitled poem');
  await expect(page.locator(editor)).toBeEmpty();
});
