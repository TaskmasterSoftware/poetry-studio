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

test('keeps imported book poems paired with their titles through switching and reload', async ({ page }) => {
  await page.goto('/');

  const bookTitle = 'Tide marks';
  const poems = [
    {
      title: 'The glass buoy',
      lines: ['A green bell below the foam', 'Rings once against the morning'],
    },
    {
      title: 'Low-tide map',
      lines: ['The shore redraws its silver edge', 'A path appears, then disappears'],
    },
  ];
  const bundle = {
    format: 'poetry-studio-book',
    version: 1,
    book: { title: bookTitle },
    poems: poems.map((poem) => ({
      title: poem.title,
      editorHtml: poem.lines.map((line) => `<p>${line}</p>`).join(''),
      source: null,
    })),
  };

  const fileChooserPromise = page.waitForEvent('filechooser');
  await page.getByTestId('button-import-book').click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: 'tide-marks.poetrybook',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(bundle)),
  });

  await expectDraft(page, poems[0].title, poems[0].lines);
  const storedBook = await page.evaluate((title) => {
    const books = JSON.parse(localStorage.getItem('poetry-studio-books') || '[]') as Array<{
      id: string;
      title: string;
    }>;
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      id: string;
      title: string;
      editorHtml: string;
      bookId?: string;
    }>;
    const book = books.find((item) => item.title === title);
    if (!book) return null;
    return {
      id: book.id,
      title: book.title,
      poems: drafts
        .filter((draft) => draft.bookId === book.id)
        .map(({ id, title: poemTitle, editorHtml, bookId }) => ({ id, title: poemTitle, editorHtml, bookId })),
    };
  }, bookTitle);

  expect(storedBook).not.toBeNull();
  expect(storedBook?.poems).toHaveLength(2);
  expect(storedBook?.poems.map((poem) => poem.title)).toEqual(poems.map((poem) => poem.title));
  for (const poem of poems) {
    const storedPoem = storedBook?.poems.find((item) => item.title === poem.title);
    expect(storedPoem?.bookId).toBe(storedBook?.id);
    for (const line of poem.lines) expect(storedPoem?.editorHtml).toContain(line);
  }

  const bookShelf = page.getByTestId(`shelf-book-${storedBook!.id}`);
  await expect(bookShelf).toContainText(bookTitle);
  await expect(bookShelf.locator('.book-count')).toHaveText('2 poems');
  for (const poem of poems) {
    const storedPoem = storedBook!.poems.find((item) => item.title === poem.title)!;
    await expect(bookShelf.getByTestId(`shelf-poem-${storedPoem.id}`)).toContainText(poem.title);
  }

  const secondPoem = storedBook!.poems.find((poem) => poem.title === poems[1].title)!;
  await bookShelf.getByTestId(`button-select-poem-${secondPoem.id}`).click();
  await expectDraft(page, poems[1].title, poems[1].lines);
  const firstPoem = storedBook!.poems.find((poem) => poem.title === poems[0].title)!;
  await bookShelf.getByTestId(`button-select-poem-${firstPoem.id}`).click();
  await expectDraft(page, poems[0].title, poems[0].lines);

  await page.reload();
  await expectDraft(page, poems[0].title, poems[0].lines);
  const reopenedBook = await page.evaluate((title) => {
    const books = JSON.parse(localStorage.getItem('poetry-studio-books') || '[]') as Array<{
      id: string;
      title: string;
    }>;
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      id: string;
      title: string;
      editorHtml: string;
      bookId?: string;
    }>;
    const book = books.find((item) => item.title === title);
    if (!book) return null;
    return {
      id: book.id,
      poems: drafts
        .filter((draft) => draft.bookId === book.id)
        .map(({ id, title: poemTitle }) => ({ id, title: poemTitle })),
    };
  }, bookTitle);

  expect(reopenedBook?.id).toBe(storedBook!.id);
  expect(reopenedBook?.poems).toHaveLength(2);
  expect(reopenedBook?.poems.map((poem) => poem.title)).toEqual(poems.map((poem) => poem.title));
  const reopenedShelf = page.getByTestId(`shelf-book-${storedBook!.id}`);
  await expect(reopenedShelf.locator('.book-count')).toHaveText('2 poems');
  for (const poem of poems) {
    const reopenedPoem = reopenedBook!.poems.find((item) => item.title === poem.title)!;
    await reopenedShelf.getByTestId(`button-select-poem-${reopenedPoem.id}`).click();
    await expectDraft(page, poem.title, poem.lines);
  }
});

test('merges edits to different poems made in two open tabs', async ({ page }) => {
  await page.goto('/');
  await page.locator(titleInput).fill('First poem');
  await page.locator(editor).fill('First poem original');
  await page.getByTestId('button-new-draft').click();
  await page.locator(titleInput).fill('Second poem');
  await page.locator(editor).fill('Second poem original');
  await page.getByTestId('button-save').click();

  const secondTab = await page.context().newPage();
  await secondTab.goto('/');
  await expectDraft(secondTab, 'Second poem', ['Second poem original']);

  await page.locator(draftSwitcher).selectOption({ label: 'First poem' });
  await expectDraft(page, 'First poem', ['First poem original']);

  await page.locator(titleInput).fill('First poem revised');
  await page.locator(editor).fill('First poem saved from the first tab');
  await page.getByTestId('button-save').click();
  await expect(page.getByTestId('status-save')).toContainText('Saved');

  await secondTab.locator(titleInput).fill('Second poem revised');
  await secondTab.locator(editor).fill('Second poem saved from the second tab');
  await secondTab.getByTestId('button-save').click();
  await expect(secondTab.getByTestId('status-save')).toContainText('Saved');

  await page.reload();
  await expectDraft(page, 'First poem revised', ['First poem saved from the first tab']);
  await secondTab.reload();
  await expectDraft(secondTab, 'Second poem revised', ['Second poem saved from the second tab']);

  const storedTitles = await page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      title: string;
      editorHtml: string;
    }>;
    return stored.map(({ title, editorHtml }) => ({ title, editorHtml }));
  });
  expect(storedTitles).toHaveLength(2);
  expect(storedTitles.find((draft) => draft.title === 'First poem revised')?.editorHtml)
    .toContain('First poem saved from the first tab');
  expect(storedTitles.find((draft) => draft.title === 'Second poem revised')?.editorHtml)
    .toContain('Second poem saved from the second tab');
});

test('saves overlapping edits as a separate copy instead of replacing newer work', async ({ page }) => {
  await page.goto('/');
  await page.locator(titleInput).fill('Shared poem');
  await page.locator(editor).fill('Original shared text');
  await page.getByTestId('button-save').click();

  const secondTab = await page.context().newPage();
  await secondTab.goto('/');
  await secondTab.locator(titleInput).fill('Second-tab version');
  await secondTab.locator(editor).fill('Second-tab manuscript');

  await page.evaluate(() => {
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      id: string;
      title: string;
      editorHtml: string;
      source: unknown;
      bookId?: string;
    }>;
    const activeId = JSON.parse(localStorage.getItem('poetry-studio-active-draft') || '""') as string;
    const updatedDrafts = drafts.map((draft) => draft.id === activeId
      ? { ...draft, title: 'First-tab version', editorHtml: '<p>First-tab manuscript</p>' }
      : draft);
    localStorage.setItem('poetry-studio-drafts', JSON.stringify(updatedDrafts));
  });

  await expect(secondTab.getByRole('status')).toHaveText(
    'This poem changed in another tab. Your edits are still here; saving will keep both copies.',
  );
  await secondTab.getByTestId('button-save').click();
  await expect(secondTab.locator(titleInput)).toHaveValue('Second-tab version (conflict copy)');

  const versions = await secondTab.evaluate(() => {
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      title: string;
      editorHtml: string;
    }>;
    return drafts.map(({ title, editorHtml }) => ({ title, editorHtml }));
  });
  expect(versions).toHaveLength(2);
  expect(versions.find((draft) => draft.title === 'First-tab version')?.editorHtml).toContain('First-tab manuscript');
  expect(versions.find((draft) => draft.title === 'Second-tab version (conflict copy)')?.editorHtml)
    .toContain('Second-tab manuscript');

  await secondTab.reload();
  await expectDraft(secondTab, 'Second-tab version (conflict copy)', ['Second-tab manuscript']);
});

test('compares two saved versions without changing the active draft', async ({ page }) => {
  await page.goto('/');

  await page.locator(titleInput).fill('First title');
  await page.locator(editor).fill('First opening line\nA shared ending');
  await page.getByTestId('button-version-history').click();
  await page.getByRole('button', { name: 'Cancel' }).click();

  await page.locator(titleInput).fill('Second title');
  await page.locator(editor).fill('Revised opening line\nA shared ending');
  await page.getByTestId('button-version-history').click();

  await expect(page.getByTestId('select-version-compare-1')).toBeVisible();
  await expect(page.getByTestId('select-version-compare-2')).toBeVisible();
  const firstTitleVersionId = await page.getByTestId('select-version-compare-2').locator('option').nth(2).getAttribute('value');
  await page.getByTestId('select-version-compare-2').selectOption(firstTitleVersionId!);
  await expect(page.getByTestId('version-comparison-summary')).toHaveText('Titles differ · Manuscripts differ');
  await expect(page.getByTestId('version-comparison-manuscript-1').locator('.changed')).toContainText('Revised opening line');
  await expect(page.locator(titleInput)).toHaveValue('Second title');
  await expect(page.locator(editor)).toContainText('Revised opening line');

  const draftWhileComparing = await page.evaluate(() => {
    const drafts = JSON.parse(localStorage.getItem('poetry-studio-drafts') || '[]') as Array<{
      id: string;
      title: string;
      editorHtml: string;
    }>;
    const activeId = JSON.parse(localStorage.getItem('poetry-studio-active-draft') || '""') as string;
    return drafts.find((draft) => draft.id === activeId);
  });
  expect(draftWhileComparing?.title).toBe('Second title');
  expect(draftWhileComparing?.editorHtml).toContain('Revised opening line');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator(titleInput)).toHaveValue('Second title');
  await expect(page.locator(editor)).toContainText('Revised opening line');
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
