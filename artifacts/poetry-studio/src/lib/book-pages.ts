export type BookPageSection = 'before-contents' | 'after-contents' | 'back-matter';
export type BookPageSide = 'recto' | 'verso' | 'either';
export type BookPageAlignment = 'left' | 'center' | 'right';

export const bookPageKinds = [
  { type: 'half-title', label: 'Half title', section: 'before-contents', side: 'recto' },
  { type: 'frontispiece', label: 'Frontispiece or caption', section: 'before-contents', side: 'verso' },
  { type: 'title-page', label: 'Title page', section: 'before-contents', side: 'recto' },
  { type: 'copyright', label: 'Copyright page', section: 'before-contents', side: 'verso' },
  { type: 'dedication', label: 'Dedication', section: 'before-contents', side: 'recto' },
  { type: 'epigraph', label: 'Epigraph', section: 'before-contents', side: 'recto' },
  { type: 'list-of-figures', label: 'List of figures or tables', section: 'after-contents', side: 'recto' },
  { type: 'foreword', label: 'Foreword', section: 'after-contents', side: 'recto' },
  { type: 'preface', label: 'Preface', section: 'after-contents', side: 'recto' },
  { type: 'acknowledgments', label: 'Acknowledgments', section: 'after-contents', side: 'recto' },
  { type: 'introduction', label: 'Introduction', section: 'after-contents', side: 'recto' },
  { type: 'appendix', label: 'Appendix', section: 'back-matter', side: 'recto' },
  { type: 'notes', label: 'Notes', section: 'back-matter', side: 'recto' },
  { type: 'glossary', label: 'Glossary', section: 'back-matter', side: 'recto' },
  { type: 'index', label: 'Index', section: 'back-matter', side: 'recto' },
  { type: 'about-author', label: 'About the author', section: 'back-matter', side: 'recto' },
  { type: 'colophon', label: 'Colophon', section: 'back-matter', side: 'recto' },
  { type: 'custom', label: 'Custom page', section: 'back-matter', side: 'recto' },
] as const;

export type BookPageType = typeof bookPageKinds[number]['type'];
export type BookMatterPage = {
  id: string;
  type: BookPageType;
  section: BookPageSection;
  side: BookPageSide;
  title: string;
  content: string;
  alignment: BookPageAlignment;
};

const pageTypeSet = new Set<string>(bookPageKinds.map((page) => page.type));
const sectionSet = new Set<string>(['before-contents', 'after-contents', 'back-matter']);
const sideSet = new Set<string>(['recto', 'verso', 'either']);
const alignmentSet = new Set<string>(['left', 'center', 'right']);
const maxBookPages = 80;
const maxBookPageContentLength = 100_000;

export function getBookPageKind(type: BookPageType) {
  return bookPageKinds.find((page) => page.type === type) ?? bookPageKinds[bookPageKinds.length - 1];
}

export function createBookMatterPage(type: BookPageType, id: string, bookTitle: string): BookMatterPage {
  const kind = getBookPageKind(type);
  const title = type === 'half-title' || type === 'title-page'
    ? bookTitle.trim()
    : ['copyright', 'foreword', 'preface', 'acknowledgments', 'introduction',
      'list-of-figures', 'appendix', 'notes', 'glossary', 'index', 'about-author', 'colophon'].includes(type)
      ? kind.label
      : '';
  const alignment: BookPageAlignment = ['half-title', 'frontispiece', 'title-page', 'dedication', 'epigraph'].includes(type)
    ? 'center'
    : 'left';
  return {
    id,
    type,
    section: kind.section,
    side: kind.side,
    title,
    content: '',
    alignment,
  };
}

export function normalizeBookPages(value: unknown): BookMatterPage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, maxBookPages).flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') return [];
    const candidate = entry as Partial<BookMatterPage>;
    const type: BookPageType = typeof candidate.type === 'string' && pageTypeSet.has(candidate.type)
      ? candidate.type as BookPageType
      : 'custom';
    const kind = getBookPageKind(type);
    const section = typeof candidate.section === 'string' && sectionSet.has(candidate.section)
      ? candidate.section as BookPageSection
      : kind.section;
    const side = typeof candidate.side === 'string' && sideSet.has(candidate.side)
      ? candidate.side as BookPageSide
      : kind.side;
    const alignment = typeof candidate.alignment === 'string' && alignmentSet.has(candidate.alignment)
      ? candidate.alignment as BookPageAlignment
      : 'left';
    const title = typeof candidate.title === 'string' ? candidate.title.slice(0, 500) : '';
    const content = typeof candidate.content === 'string' ? candidate.content.slice(0, maxBookPageContentLength) : '';
    return [{
      id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id.slice(0, 120) : `book-page-${index + 1}`,
      type,
      section,
      side,
      title,
      content,
      alignment,
    }];
  });
}
