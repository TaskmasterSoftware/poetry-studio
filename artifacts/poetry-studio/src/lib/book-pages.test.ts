import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBookMatterPage, normalizeBookPages } from './book-pages';

test('uses conventional recto and verso defaults for front matter', () => {
  assert.equal(createBookMatterPage('title-page', 'title', 'Collected poems').side, 'recto');
  assert.equal(createBookMatterPage('copyright', 'copyright', 'Collected poems').side, 'verso');
  assert.equal(createBookMatterPage('frontispiece', 'image', 'Collected poems').side, 'verso');
  assert.equal(createBookMatterPage('dedication', 'dedication', 'Collected poems').side, 'recto');
});

test('normalizes malformed stored book pages to safe editable defaults', () => {
  const pages = normalizeBookPages([
    { id: 'copyright', type: 'copyright', section: 'unknown', side: 'center', title: 'Copyright', content: 'Text', alignment: 'justify' },
    { type: 'unsupported', title: 12, content: null },
    null,
  ]);

  assert.deepEqual(pages, [
    {
      id: 'copyright',
      type: 'copyright',
      section: 'before-contents',
      side: 'verso',
      title: 'Copyright',
      content: 'Text',
      alignment: 'left',
    },
    {
      id: 'book-page-2',
      type: 'custom',
      section: 'back-matter',
      side: 'recto',
      title: '',
      content: '',
      alignment: 'left',
    },
  ]);
});
