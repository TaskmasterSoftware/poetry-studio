import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  ArrowDown, ArrowUp, BookMarked, BookOpen, Check, ChevronDown, Download, FilePlus2, FolderPlus, Import, MoreHorizontal, Search,
  Pencil, Plus, X,
} from 'lucide-react';
import { matchesPoemMetadataSearch, type PoemMetadata } from '../lib/poem-files';
import type { PoemOrderDirection } from '../lib/poem-order';
import './BookShelf.css';

export type ShelfBook = { id: string; title: string; poemCount: number };
export type ShelfPoem = { id: string; title: string; bookId: string; metadata: PoemMetadata };
const collapsedBooksStorageKey = 'poetry-studio-collapsed-books';

function readCollapsedBookIds() {
  try {
    const saved = localStorage.getItem(collapsedBooksStorageKey);
    const parsed: unknown = saved ? JSON.parse(saved) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}

export type BookShelfProps = {
  books: ShelfBook[];
  poems: ShelfPoem[];
  activeBookId: string;
  activePoemId: string;
  onSelectPoem: (poemId: string) => void;
  onCreateBook: () => void;
  onCreatePoem: (bookId: string) => void;
  onRenameBook: (bookId: string, title: string) => void;
  onMovePoem: (poemId: string, bookId: string) => void;
  onReorderPoem: (poemId: string, direction: PoemOrderDirection) => void;
  onExportBook: (bookId: string) => void;
  onEditBookPages: (bookId: string) => void;
  onImportBook: () => void;
};

export default function BookShelf({
  books,
  poems,
  activeBookId,
  activePoemId,
  onSelectPoem,
  onCreateBook,
  onCreatePoem,
  onRenameBook,
  onMovePoem,
  onReorderPoem,
  onExportBook,
  onEditBookPages,
  onImportBook,
}: BookShelfProps) {
  const [renamingBookId, setRenamingBookId] = useState('');
  const [renameValue, setRenameValue] = useState('');
  const [collapsedBookIds, setCollapsedBookIds] = useState(readCollapsedBookIds);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    try {
      localStorage.setItem(collapsedBooksStorageKey, JSON.stringify([...collapsedBookIds]));
    } catch {
      // The shelf remains usable when browser storage is unavailable.
    }
  }, [collapsedBookIds]);

  const beginRename = (book: ShelfBook) => {
    setRenamingBookId(book.id);
    setRenameValue(book.title);
  };

  const cancelRename = () => {
    setRenamingBookId('');
    setRenameValue('');
  };

  const saveRename = (event: FormEvent<HTMLFormElement>, bookId: string) => {
    event.preventDefault();
    const title = renameValue.trim();
    if (title) onRenameBook(bookId, title);
    cancelRename();
  };

  const handleRenameKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') cancelRename();
  };

  const toggleBook = (bookId: string) => {
    setCollapsedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const isSearching = Boolean(searchQuery.trim());
  const matchingPoems = poems.filter((poem) => matchesPoemMetadataSearch(poem, searchQuery));

  return (
    <section className="bookshelf" aria-label="Bookshelf">
      <header className="bookshelf-head">
        <div className="bookshelf-heading">
          <span className="bookshelf-eyebrow">Your writing room</span>
          <h2>Bookshelf</h2>
        </div>
        <span className="bookshelf-total" aria-label={`${books.length} books`}>{books.length.toString().padStart(2, '0')}</span>
      </header>

      <div className="bookshelf-actions">
        <button className="shelf-action shelf-action-primary" type="button" onClick={onCreateBook} data-testid="button-create-book">
          <FolderPlus aria-hidden="true" />
          <span>New book</span>
        </button>
        <button className="shelf-action shelf-action-import" type="button" onClick={onImportBook} data-testid="button-import-book">
          <Import aria-hidden="true" />
          <span>Import</span>
        </button>
      </div>

      <div className="bookshelf-search">
        <Search aria-hidden="true" />
        <label className="sr-only" htmlFor="bookshelf-search">Search poems and metadata</label>
        <input
          id="bookshelf-search"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search poems and metadata"
          data-testid="input-poem-search"
        />
        {searchQuery && <button
          type="button"
          onClick={() => setSearchQuery('')}
          aria-label="Clear poem search"
          data-testid="button-clear-poem-search"
        ><X aria-hidden="true" /></button>}
      </div>

      {isSearching ? (
        <div className="bookshelf-search-results" role="list" aria-label="Matching poems" data-testid="poem-search-results">
          <div className="bookshelf-search-count">{matchingPoems.length} {matchingPoems.length === 1 ? 'poem' : 'poems'} found</div>
          {matchingPoems.map((poem) => {
            const bookTitle = books.find((book) => book.id === poem.bookId)?.title ?? 'Unfiled';
            return <div role="listitem" key={poem.id}>
              <button
                type="button"
                className={`bookshelf-search-result${poem.id === activePoemId ? ' is-current' : ''}`}
                onClick={() => onSelectPoem(poem.id)}
                aria-label={`Open ${poem.title} from ${bookTitle}`}
                data-testid={`search-result-poem-${poem.id}`}
              >
                <span>{poem.title}</span>
                <small>{bookTitle}</small>
              </button>
            </div>;
          })}
          {!matchingPoems.length && <p className="bookshelf-search-empty">No matches. Try a title, tag, note, publisher, or status.</p>}
        </div>
      ) : books.length === 0 ? (
        <div className="bookshelf-empty" data-testid="empty-bookshelf">
          <div className="empty-mark" aria-hidden="true"><BookOpen /></div>
          <h3>A place for what’s next</h3>
          <p>Gather poems into a book when you’re ready.</p>
          <button type="button" className="empty-create" onClick={onCreateBook} data-testid="button-create-first-book">
            <Plus aria-hidden="true" /> Create your first book
          </button>
        </div>
      ) : (
        <div className="bookshelf-list" aria-label="Books and poems">
          {books.map((book, index) => {
            const bookPoems = poems.filter((poem) => poem.bookId === book.id);
            const isActiveBook = book.id === activeBookId;
            const isRenaming = renamingBookId === book.id;
            const isCollapsed = collapsedBookIds.has(book.id);
            return (
              <section
                className={`shelf-book${isActiveBook ? ' is-current' : ''}${isCollapsed ? ' is-collapsed' : ''}`}
                key={book.id}
                aria-labelledby={`shelf-book-title-${book.id}`}
                data-testid={`shelf-book-${book.id}`}
              >
                <div className="shelf-book-top">
                  <div className="book-spine" aria-hidden="true">
                    <BookMarked />
                    <span>{String(index + 1).padStart(2, '0')}</span>
                  </div>
                  <div className="book-heading">
                    {isRenaming ? (
                      <form className="rename-form" onSubmit={(event) => saveRename(event, book.id)}>
                        <label className="sr-only" htmlFor={`rename-book-${book.id}`}>Rename {book.title}</label>
                        <input
                          id={`rename-book-${book.id}`}
                          autoFocus
                          value={renameValue}
                          onChange={(event) => setRenameValue(event.target.value)}
                          onKeyDown={handleRenameKey}
                          maxLength={120}
                          data-testid={`input-rename-book-${book.id}`}
                        />
                        <button type="submit" aria-label={`Save book name ${renameValue || book.title}`} data-testid={`button-save-book-name-${book.id}`}>
                          <Check aria-hidden="true" />
                        </button>
                        <button type="button" onClick={cancelRename} aria-label="Cancel rename" data-testid={`button-cancel-rename-${book.id}`}>
                          <X aria-hidden="true" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <h3 id={`shelf-book-title-${book.id}`} title={book.title}>
                          <button
                            className="book-toggle"
                            type="button"
                            onClick={() => toggleBook(book.id)}
                            aria-expanded={!isCollapsed}
                            aria-controls={`book-poems-${book.id}`}
                            aria-label={`${isCollapsed ? 'Open' : 'Close'} ${book.title}`}
                            data-testid={`button-toggle-book-${book.id}`}
                          >
                            <span className="book-toggle-title">{book.title}</span>
                            <ChevronDown className="book-chevron" aria-hidden="true" />
                          </button>
                        </h3>
                        <span className="book-count">{bookPoems.length} {bookPoems.length === 1 ? 'poem' : 'poems'}</span>
                      </>
                    )}
                  </div>
                  {!isRenaming && (
                    <div className="book-tools">
                      <button
                        className="book-tool"
                        type="button"
                        onClick={() => beginRename(book)}
                        aria-label={`Rename ${book.title}`}
                        title="Rename book"
                        data-testid={`button-rename-book-${book.id}`}
                      ><Pencil aria-hidden="true" /></button>
                      <button
                        className="book-tool"
                        type="button"
                        onClick={() => onEditBookPages(book.id)}
                        aria-label={`Edit pages in ${book.title}`}
                        title="Edit book pages"
                        data-testid={`button-edit-book-pages-${book.id}`}
                      ><BookOpen aria-hidden="true" /></button>
                      <button
                        className="book-tool"
                        type="button"
                        onClick={() => onExportBook(book.id)}
                        aria-label={`Export ${book.title}`}
                        title="Export book"
                        data-testid={`button-export-book-${book.id}`}
                      ><Download aria-hidden="true" /></button>
                    </div>
                  )}
                </div>

                {isActiveBook && <span className="current-book-label"><span />Current book</span>}
                <div className="book-poems" id={`book-poems-${book.id}`} hidden={isCollapsed}>
                  {bookPoems.length ? bookPoems.map((poem, poemIndex) => {
                    const selected = poem.id === activePoemId;
                    return (
                      <div className={`shelf-poem${selected ? ' is-selected' : ''}`} key={poem.id} data-testid={`shelf-poem-${poem.id}`}>
                        <button
                          type="button"
                          className="poem-select"
                          onClick={() => onSelectPoem(poem.id)}
                          aria-current={selected ? 'page' : undefined}
                          aria-label={`${poem.title}${selected ? ', current poem' : ''}`}
                          data-testid={`button-select-poem-${poem.id}`}
                        >
                          <span className="poem-marker" aria-hidden="true" />
                          <span className="poem-title" title={poem.title}>{poem.title}</span>
                          {selected && <span className="poem-current">Current</span>}
                        </button>
                        {bookPoems.length > 1 && (
                          <div className="poem-order-tools" role="group" aria-label={`Reorder ${poem.title}`}>
                            <button
                              type="button"
                              disabled={poemIndex === 0}
                              onClick={() => onReorderPoem(poem.id, 'up')}
                              aria-label={`Move ${poem.title} up`}
                              title="Move poem up"
                              data-testid={`button-move-poem-up-${poem.id}`}
                            ><ArrowUp aria-hidden="true" /></button>
                            <button
                              type="button"
                              disabled={poemIndex === bookPoems.length - 1}
                              onClick={() => onReorderPoem(poem.id, 'down')}
                              aria-label={`Move ${poem.title} down`}
                              title="Move poem down"
                              data-testid={`button-move-poem-down-${poem.id}`}
                            ><ArrowDown aria-hidden="true" /></button>
                          </div>
                        )}
                        {books.length > 1 && (
                          <label className="move-poem-label">
                            <span className="sr-only">Move {poem.title} to another book</span>
                            <select
                              value={book.id}
                              onChange={(event) => onMovePoem(poem.id, event.target.value)}
                              aria-label={`Move ${poem.title} to another book`}
                              data-testid={`select-move-poem-${poem.id}`}
                            >
                              {books.map((destination) => (
                                <option value={destination.id} key={destination.id}>{destination.title}</option>
                              ))}
                            </select>
                            <MoreHorizontal aria-hidden="true" />
                          </label>
                        )}
                      </div>
                    );
                  }) : (
                    <p className="book-empty-note">A quiet page, waiting.</p>
                  )}
                </div>
                <button
                  type="button"
                  className="add-poem"
                  onClick={() => onCreatePoem(book.id)}
                  data-testid={`button-create-poem-${book.id}`}
                >
                  <FilePlus2 aria-hidden="true" />
                  <span>New poem</span>
                  <Plus aria-hidden="true" className="add-poem-plus" />
                </button>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}
