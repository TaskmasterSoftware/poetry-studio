import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { BrowserPoemBook } from '../lib/book-library';
import {
  bookPageKinds,
  type BookMatterPage,
  type BookPageAlignment,
  type BookPageSection,
  type BookPageSide,
  type BookPageType,
} from '../lib/book-pages';

const sections: { value: BookPageSection; label: string }[] = [
  { value: 'before-contents', label: 'Before contents' },
  { value: 'after-contents', label: 'After contents' },
  { value: 'back-matter', label: 'Back matter' },
];

type BookPagesEditorProps = {
  book: BrowserPoemBook;
  onAddPage: (type: BookPageType) => void;
  onUpdatePage: (pageId: string, changes: Partial<Omit<BookMatterPage, 'id'>>) => void;
  onMovePage: (pageId: string, direction: 'up' | 'down') => void;
  onRemovePage: (pageId: string) => void;
};

export default function BookPagesEditor({
  book,
  onAddPage,
  onUpdatePage,
  onMovePage,
  onRemovePage,
}: BookPagesEditorProps) {
  const [selectedType, setSelectedType] = useState<BookPageType>('title-page');

  return <div className="book-pages-editor" data-testid="book-pages-editor">
    <div className="book-pages-guidance">
      Changes save on this device as you type. The contents page is generated from your poem order. Front matter follows the usual order; choose a section and page side for each added page. Recto means right-hand, verso means left-hand. Blank pages are inserted in the PDF when needed. The editor supports text and captions, not images.
      {' '}<a href="https://www.bookdesigntemplates.com/blogs/guides/parts-of-a-book-front-matter-order" target="_blank" rel="noreferrer">Front-matter layout guide</a>
    </div>
    <div className="book-pages-add">
      <label>
        <span className="field-label">Add a page</span>
        <select value={selectedType} onChange={(event) => setSelectedType(event.target.value as BookPageType)} data-testid="select-book-page-type">
          {bookPageKinds.map((kind) => <option key={kind.type} value={kind.type}>{kind.label}</option>)}
        </select>
      </label>
      <button type="button" className="button primary" onClick={() => onAddPage(selectedType)} data-testid="button-add-book-page">
        <Plus aria-hidden="true" /> Add page
      </button>
    </div>

    {sections.map((section) => {
      const pages = book.pages.filter((page) => page.section === section.value);
      return <section className="book-pages-section" key={section.value} aria-label={section.label}>
        <h3>{section.label}<span>{pages.length}</span></h3>
        {pages.length ? pages.map((page, index) => {
          const label = bookPageKinds.find((kind) => kind.type === page.type)?.label ?? 'Custom page';
          return <article className="book-page-card" key={page.id} data-testid={`book-page-card-${page.id}`}>
            <header className="book-page-card-head">
              <strong>{label}</strong>
              <div className="book-page-actions">
                <button type="button" className="book-page-icon" onClick={() => onMovePage(page.id, 'up')} disabled={index === 0} aria-label={`Move ${label} up`} data-testid={`button-move-book-page-up-${page.id}`}><ArrowUp aria-hidden="true" /></button>
                <button type="button" className="book-page-icon" onClick={() => onMovePage(page.id, 'down')} disabled={index === pages.length - 1} aria-label={`Move ${label} down`} data-testid={`button-move-book-page-down-${page.id}`}><ArrowDown aria-hidden="true" /></button>
                <button type="button" className="book-page-icon danger" onClick={() => {
                  if ((page.title.trim() || page.content.trim()) && !window.confirm(`Remove this ${label.toLowerCase()} page and its text?`)) return;
                  onRemovePage(page.id);
                }} aria-label={`Remove ${label}`} data-testid={`button-remove-book-page-${page.id}`}><Trash2 aria-hidden="true" /></button>
              </div>
            </header>
            <div className="book-page-settings">
              <label>
                <span className="field-label">Section</span>
                <select value={page.section} onChange={(event) => onUpdatePage(page.id, { section: event.target.value as BookPageSection })} data-testid={`select-book-page-section-${page.id}`}>
                  {sections.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                <span className="field-label">Page side</span>
                <select value={page.side} onChange={(event) => onUpdatePage(page.id, { side: event.target.value as BookPageSide })} data-testid={`select-book-page-side-${page.id}`}>
                  <option value="recto">Recto — right</option>
                  <option value="verso">Verso — left</option>
                  <option value="either">Either side</option>
                </select>
              </label>
              <label>
                <span className="field-label">Text alignment</span>
                <select value={page.alignment} onChange={(event) => onUpdatePage(page.id, { alignment: event.target.value as BookPageAlignment })} data-testid={`select-book-page-alignment-${page.id}`}>
                  <option value="left">Left</option>
                  <option value="center">Centered</option>
                  <option value="right">Right</option>
                </select>
              </label>
            </div>
            <label className="book-page-field">
              <span className="field-label">Page heading or title</span>
              <input value={page.title} onChange={(event) => onUpdatePage(page.id, { title: event.target.value })} maxLength={500} data-testid={`input-book-page-title-${page.id}`} />
            </label>
            <label className="book-page-field">
              <span className="field-label">Page text</span>
              <textarea value={page.content} onChange={(event) => onUpdatePage(page.id, { content: event.target.value })} rows={4} maxLength={100000} placeholder="Enter the text for this page. Line breaks are preserved." data-testid={`textarea-book-page-content-${page.id}`} />
            </label>
          </article>;
        }) : <p className="book-pages-empty">No pages in this section yet.</p>}
      </section>;
    })}
    <p className="book-pages-footer">{book.pages.length} custom book {book.pages.length === 1 ? 'page' : 'pages'} · blank placement pages are added in the PDF, not saved here.</p>
  </div>;
}
