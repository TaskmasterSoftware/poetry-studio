import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, BookOpen, Check, CircleHelp,
  Download, Feather, FileText, FolderOpen, History, Indent, Italic, List, ListOrdered,
  Minus, Moon, PanelRight, Plus, Redo2, Search,
  RotateCcw, Save, Settings2, SpellCheck, Strikethrough, Sun, Trash2, Type, Underline, Undo2, X,
} from 'lucide-react';
import BookShelf, { type ShelfBook, type ShelfPoem } from './components/BookShelf';
import BookPagesEditor from './components/BookPagesEditor';
import FormCheckPanel from './components/FormCheckPanel';
import PoemMetadataPanel from './components/PoemMetadataPanel';
import { analyzeBrowserMeter, type BrowserMeterEstimate } from './lib/browser-meter';
import { findRhymes, findSpellingErrors, scanLineWords, type RhymeMatch, type ScannedWord } from './lib/phonetics';
import { analyzePoemForm, type FormCheckResult } from './lib/form-check';
import { findPoetryForm, searchPoetryForms, type FormEntry } from './lib/poetry-forms';
import { layoutScansionOverlay, type ScanLineEdit, type ScanSymbol, type ScansionOverlayItem } from './lib/scansion-layout';
import { findGrammarSuggestions, type GrammarSuggestion } from './lib/proofing';
import { reorderPoemsInBook, type PoemOrderDirection } from './lib/poem-order';
import {
  downloadBookBundle, normalizeBookLibrary, readBookBundle, serializeBookBundle, type BrowserPoemBook,
} from './lib/book-library';
import {
  choosePoemFile, downloadPoemFile, isWritablePoemFileFormat, poemTextToEditorHtml, readPoemFile, serializeBookPdf, serializePoemPdf,
  appendBrowserPoemRevision, defaultPdfExportOptions, emptyPoemMetadata, isBrowserPoemDraft, isBrowserPoemRevision, isSavedPoemSource, normalizePdfExportOptions, normalizePoemMetadata, removeBrowserPoemDraft, restoreBrowserPoemDraft, serializePoem, writePoemFile,
  type BrowserPoemDraft, type BrowserPoemRevision, type PdfExportOptions, type PoemFileFormat, type PoemMetadata, type WritablePoemFileFormat, type WritablePoemFileHandle,
} from './lib/poem-files';
import { diffWords } from './lib/version-diff';
import { bookPageKinds, createBookMatterPage, normalizeBookPages, type BookMatterPage, type BookPageType } from './lib/book-pages';

type Tool = 'rhymes' | 'forms' | 'proof' | 'scansion' | 'metadata';

const starter = `<p>At first light, the harbor keeps its blue</p><p>like a secret folded into glass.</p><p>The gulls unthread the quiet, one by one;</p><p>the tide turns over what the night let pass.</p><p><br></p><p>I write the names of rain along the sill,</p><p>then watch the letters loosen into air.</p><p>Some things are held by learning to be still.</p><p>Some things are gone, and still are everywhere.</p>`;
const fontFamilies = [
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Palatino', value: '"Palatino Linotype", Palatino, serif' },
  { label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Courier New', value: '"Courier New", Courier, monospace' },
  { label: 'Trebuchet MS', value: '"Trebuchet MS", sans-serif' },
] as const;
type FontFamily = typeof fontFamilies[number]['value'];
const fontSizeOptions = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
const initialSettings = {
  proof: true,
  scansion: false,
  forms: false,
  dark: false,
  fontSize: 14,
  fontFamily: fontFamilies[0].value,
  tab: '4 spaces',
};

function readStorage<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function readSessionStorage<T>(key: string, fallback: T): T {
  try { const raw = sessionStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function readInitialSettings() {
  const saved = readStorage<Partial<typeof initialSettings> & { fontSizeUnit?: string } | null>('poetry-studio-settings', null);
  if (!saved) return initialSettings;
  const storedSize = Number(saved.fontSize);
  const sizeInPoints = Number.isFinite(storedSize)
    ? saved.fontSizeUnit === 'pt' ? storedSize : storedSize * 0.75
    : initialSettings.fontSize;
  const fontSize = fontSizeOptions.reduce((nearest, candidate) =>
    Math.abs(candidate - sizeInPoints) < Math.abs(nearest - sizeInPoints) ? candidate : nearest,
  fontSizeOptions[0]);
  const fontFamily = fontFamilies.find((font) => font.value === saved.fontFamily)?.value ?? initialSettings.fontFamily;
  return { ...initialSettings, ...saved, fontSize, fontFamily };
}
function readSavedPoemSource() {
  const source = readStorage<unknown>('poetry-studio-source', null);
  return isSavedPoemSource(source) ? source : null;
}
const draftsStorageKey = 'poetry-studio-drafts';
const booksStorageKey = 'poetry-studio-books';
const activeDraftStorageKey = 'poetry-studio-active-draft';
const tabActiveDraftStorageKey = 'poetry-studio-tab-active-draft';
const pdfExportOptionsStorageKey = 'poetry-studio-pdf-export-options';
const revisionStorageKey = (draftId: string) => `poetry-studio-revisions-${draftId}`;
const maxPoemRevisions = 20;
function createDraftId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function readPoemRevisions(draftId: string): BrowserPoemRevision[] {
  const saved = readStorage<unknown>(revisionStorageKey(draftId), []);
  return Array.isArray(saved)
    ? saved.filter(isBrowserPoemRevision).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, maxPoemRevisions)
    : [];
}
function readStoredDrafts(): BrowserPoemDraft[] {
  const saved = readStorage<unknown>(draftsStorageKey, []);
  return Array.isArray(saved)
    ? saved.filter(isBrowserPoemDraft).map((draft) => ({ ...draft, metadata: normalizePoemMetadata(draft.metadata) }))
    : [];
}
function sameDraft(left: BrowserPoemDraft | undefined, right: BrowserPoemDraft | undefined) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function mergeDraftChanges(
  baseDrafts: BrowserPoemDraft[],
  localDrafts: BrowserPoemDraft[],
  storedDrafts: BrowserPoemDraft[],
) {
  const baseById = new Map(baseDrafts.map((draft) => [draft.id, draft]));
  const localById = new Map(localDrafts.map((draft) => [draft.id, draft]));
  const merged = [...storedDrafts];
  const conflictCopies = new Map<string, string>();

  for (const localDraft of localDrafts) {
    const baseDraft = baseById.get(localDraft.id);
    if (baseDraft && sameDraft(baseDraft, localDraft)) continue;

    const storedIndex = merged.findIndex((draft) => draft.id === localDraft.id);
    const storedDraft = storedIndex >= 0 ? merged[storedIndex] : undefined;
    if (!baseDraft) {
      if (!storedDraft) merged.push(localDraft);
      continue;
    }

    if (!storedDraft || (!sameDraft(baseDraft, storedDraft) && !sameDraft(localDraft, storedDraft))) {
      const copy: BrowserPoemDraft = {
        ...localDraft,
        id: createDraftId(),
        title: `${localDraft.title || 'Untitled poem'} (conflict copy)`,
      };
      merged.push(copy);
      conflictCopies.set(localDraft.id, copy.id);
    } else if (storedIndex >= 0) {
      merged[storedIndex] = localDraft;
    }
  }

  for (const baseDraft of baseDrafts) {
    if (localById.has(baseDraft.id)) continue;
    const storedIndex = merged.findIndex((draft) => draft.id === baseDraft.id);
    if (storedIndex < 0) continue;
    if (sameDraft(baseDraft, merged[storedIndex])) merged.splice(storedIndex, 1);
  }

  return { drafts: merged, conflictCopies };
}
function loadBrowserDraftStore() {
  const savedDrafts = readStorage<unknown>(draftsStorageKey, null);
  const drafts = Array.isArray(savedDrafts)
    ? savedDrafts.filter(isBrowserPoemDraft).map((draft) => ({ ...draft, metadata: normalizePoemMetadata(draft.metadata) }))
    : [];
  if (drafts.length) {
    const savedActiveId = readSessionStorage<string>(tabActiveDraftStorageKey, '')
      || readStorage<string>(activeDraftStorageKey, '');
    return {
      drafts,
      activeDraftId: drafts.some((draft) => draft.id === savedActiveId) ? savedActiveId : drafts[0].id,
    };
  }
  const migratedDraft: BrowserPoemDraft = {
    id: createDraftId(),
    title: readStorage('poetry-studio-title', 'The harbor at first light'),
    editorHtml: readStorage('poetry-studio-manuscript', starter),
    source: readSavedPoemSource(),
    metadata: emptyPoemMetadata(),
  };
  return { drafts: [migratedDraft], activeDraftId: migratedDraft.id };
}
function loadBrowserLibraryStore() {
  const draftStore = loadBrowserDraftStore();
  const library = normalizeBookLibrary(
    readStorage<unknown>(booksStorageKey, null),
    draftStore.drafts,
    draftStore.activeDraftId,
    createDraftId,
  );
  return { ...draftStore, ...library };
}
function cleanText(html: string) {
  const node = document.createElement('div');
  node.innerHTML = html;
  const readNode = (current: Node): string => {
    if (current.nodeType === Node.TEXT_NODE) return current.textContent || '';
    if (current.nodeType !== Node.ELEMENT_NODE) return '';
    const element = current as HTMLElement;
    if (element.tagName === 'BR') return '\n';
    const content = Array.from(element.childNodes).map(readNode).join('');
    if (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(element.tagName)) {
      return element.tagName === 'P' && content === '\n' ? '\n' : `${content}\n`;
    }
    return content;
  };
  return Array.from(node.childNodes).map(readNode).join('').replace(/\u00a0/g, ' ').replace(/\n+$/, '');
}
type TextPoint = { node: Text; offset: number } | null;
function createEditorTextRange(editor: HTMLElement, start: number, end: number): Range | null {
  const flatten = (current: Node): { text: string; points: TextPoint[] } => {
    if (current.nodeType === Node.TEXT_NODE) {
      const original = current.textContent || '';
      return {
        text: original.replace(/\u00a0/g, ' '),
        points: Array.from({ length: original.length }, (_, offset) => ({ node: current as Text, offset })),
      };
    }
    if (current.nodeType !== Node.ELEMENT_NODE) return { text: '', points: [] };
    const element = current as HTMLElement;
    if (element.tagName === 'BR') return { text: '\n', points: [null] };
    const children = Array.from(element.childNodes).map(flatten);
    const text = children.map((child) => child.text).join('');
    const points = children.flatMap((child) => child.points);
    if (/^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/.test(element.tagName)) {
      if (element.tagName === 'P' && text === '\n') return { text: '\n', points: [null] };
      return { text: `${text}\n`, points: [...points, null] };
    }
    return { text, points };
  };

  const mapped = Array.from(editor.childNodes).map(flatten);
  const text = mapped.map((part) => part.text).join('');
  const points = mapped.flatMap((part) => part.points);
  let textLength = text.length;
  while (textLength > 0 && text[textLength - 1] === '\n') {
    textLength -= 1;
    points.pop();
  }
  if (start < 0 || end > textLength || start >= end) return null;

  let first: Exclude<TextPoint, null> | null = null;
  let last: Exclude<TextPoint, null> | null = null;
  for (let index = start; index < end; index += 1) {
    if (points[index]) {
      first ??= points[index];
      last = points[index];
    }
  }
  if (!first || !last) return null;
  const range = document.createRange();
  range.setStart(first.node, first.offset);
  range.setEnd(last.node, last.offset + 1);
  return range;
}
function wordsOf(text: string): string[] { return text.trim().match(/\b[\w’'-]+\b/g) ?? []; }
function lineSyllables(text: string) { return wordsOf(text).reduce((total, word) => total + syllables(word), 0); }
function syllables(word: string) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  if (clean.length <= 3) return 1;
  const groups = clean.replace(/(?:[^laeiouy]e|ed|es)$/i, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length || 1);
}
type AlignedComparisonLine = { text: string; lineNumber: number; peerText: string | null; changed: boolean };
function alignComparisonLines(left: string[], right: string[]): [AlignedComparisonLine[], AlignedComparisonLine[]] {
  const lcsLengths = (
    leftStart: number,
    leftEnd: number,
    rightStart: number,
    rightEnd: number,
    reversed = false,
  ) => {
    const rightLength = rightEnd - rightStart;
    let previous = new Uint32Array(rightLength + 1);
    let current = new Uint32Array(rightLength + 1);
    for (let leftOffset = 0; leftOffset < leftEnd - leftStart; leftOffset += 1) {
      current[0] = 0;
      const leftLine = left[reversed ? leftEnd - leftOffset - 1 : leftStart + leftOffset];
      for (let rightOffset = 0; rightOffset < rightLength; rightOffset += 1) {
        const rightLine = right[reversed ? rightEnd - rightOffset - 1 : rightStart + rightOffset];
        current[rightOffset + 1] = leftLine === rightLine
          ? previous[rightOffset] + 1
          : Math.max(previous[rightOffset + 1], current[rightOffset]);
      }
      [previous, current] = [current, previous];
    }
    return previous;
  };

  const matches: Array<[number, number]> = [];
  const collectMatches = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => {
    const leftLength = leftEnd - leftStart;
    const rightLength = rightEnd - rightStart;
    if (!leftLength || !rightLength) return;
    if (leftLength === 1) {
      const rightIndex = right.slice(rightStart, rightEnd).indexOf(left[leftStart]);
      if (rightIndex >= 0) matches.push([leftStart, rightStart + rightIndex]);
      return;
    }
    if (rightLength === 1) {
      const leftIndex = left.slice(leftStart, leftEnd).indexOf(right[rightStart]);
      if (leftIndex >= 0) matches.push([leftStart + leftIndex, rightStart]);
      return;
    }

    const leftMiddle = leftStart + Math.floor(leftLength / 2);
    const forward = lcsLengths(leftStart, leftMiddle, rightStart, rightEnd);
    const backward = lcsLengths(leftMiddle, leftEnd, rightStart, rightEnd, true);
    let rightMiddle = 0;
    let longest = -1;
    for (let split = 0; split <= rightLength; split += 1) {
      const length = forward[split] + backward[rightLength - split];
      if (length > longest) {
        longest = length;
        rightMiddle = split;
      }
    }
    collectMatches(leftStart, leftMiddle, rightStart, rightStart + rightMiddle);
    collectMatches(leftMiddle, leftEnd, rightStart + rightMiddle, rightEnd);
  };
  collectMatches(0, left.length, 0, right.length);

  const alignedLeft: AlignedComparisonLine[] = [];
  const alignedRight: AlignedComparisonLine[] = [];
  let leftIndex = 0;
  let rightIndex = 0;
  const appendGap = (leftEnd: number, rightEnd: number) => {
    const pairedCount = Math.min(leftEnd - leftIndex, rightEnd - rightIndex);
    for (let offset = 0; offset < pairedCount; offset += 1) {
      const leftText = left[leftIndex + offset];
      const rightText = right[rightIndex + offset];
      const changed = leftText !== rightText;
      alignedLeft.push({ text: leftText, lineNumber: leftIndex + offset + 1, peerText: rightText, changed });
      alignedRight.push({ text: rightText, lineNumber: rightIndex + offset + 1, peerText: leftText, changed });
    }
    for (let index = leftIndex + pairedCount; index < leftEnd; index += 1) {
      alignedLeft.push({ text: left[index], lineNumber: index + 1, peerText: null, changed: true });
    }
    for (let index = rightIndex + pairedCount; index < rightEnd; index += 1) {
      alignedRight.push({ text: right[index], lineNumber: index + 1, peerText: null, changed: true });
    }
    leftIndex = leftEnd;
    rightIndex = rightEnd;
  };

  for (const [matchedLeft, matchedRight] of matches) {
    appendGap(matchedLeft, matchedRight);
    alignedLeft.push({ text: left[matchedLeft], lineNumber: matchedLeft + 1, peerText: right[matchedRight], changed: false });
    alignedRight.push({ text: right[matchedRight], lineNumber: matchedRight + 1, peerText: left[matchedLeft], changed: false });
    leftIndex = matchedLeft + 1;
    rightIndex = matchedRight + 1;
  }
  appendGap(left.length, right.length);
  return [alignedLeft, alignedRight];
}
function App() {
  const [initialLibraryStore] = useState(loadBrowserLibraryStore);
  const [books, setBooks] = useState(initialLibraryStore.books);
  const booksRef = useRef(books);
  const [drafts, setDrafts] = useState(initialLibraryStore.drafts);
  const draftsRef = useRef(drafts);
  const draftBaselineRef = useRef(initialLibraryStore.drafts);
  const conflictRedirectsRef = useRef(new Map<string, string>());
  const [activeDraftId, setActiveDraftId] = useState(initialLibraryStore.activeDraftId);
  const [revisionHistory, setRevisionHistory] = useState(() => readPoemRevisions(initialLibraryStore.activeDraftId));
  const [selectedRevisionId, setSelectedRevisionId] = useState('');
  const [comparisonRevisionIds, setComparisonRevisionIds] = useState<[string, string]>(['', '']);
  const [activeComparisonChangeIndices, setActiveComparisonChangeIndices] = useState<[number | null, number | null]>([null, null]);
  const comparisonManuscriptRefs = useRef<Array<HTMLPreElement | null>>([]);
  const [openedSource, setOpenedSource] = useState(() => initialLibraryStore.drafts.find((draft) => draft.id === initialLibraryStore.activeDraftId)?.source ?? null);
  const editorRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bookInputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<WritablePoemFileHandle | null>(null);
  const fileHandlesRef = useRef(new Map<string, WritablePoemFileHandle>());
  const savedHtml = useRef('');
  const savedEditorRange = useRef<Range | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const titleTimer = useRef<number | undefined>(undefined);
  const [title, setTitle] = useState(() => initialLibraryStore.drafts.find((draft) => draft.id === initialLibraryStore.activeDraftId)?.title ?? 'The harbor at first light');
  const [html, setHtml] = useState(() => initialLibraryStore.drafts.find((draft) => draft.id === initialLibraryStore.activeDraftId)?.editorHtml ?? starter);
  const [settings, setSettings] = useState(readInitialSettings);
  const [customWords, setCustomWords] = useState<string[]>(() => readStorage('poetry-studio-dictionary', []));
  const [activeTool, setActiveTool] = useState<Tool>('rhymes');
  const [selection, setSelection] = useState('');
  const [rhymeQuery, setRhymeQuery] = useState('');
  const [rhymeResults, setRhymeResults] = useState<{ perfect: RhymeMatch[]; near: RhymeMatch[] }>({ perfect: [], near: [] });
  const [rhymeLoading, setRhymeLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState('');
  const [formQuery, setFormQuery] = useState('');
  const [formCheckState, setFormCheckState] = useState<{ draftId: string; result: FormCheckResult } | null>(null);
  const [formCheckError, setFormCheckError] = useState('');
  const [isCheckingForm, setIsCheckingForm] = useState(false);
  const [proofOn, setProofOn] = useState(settings.proof);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [modal, setModal] = useState<'export' | 'settings' | 'history' | 'book-export' | 'book-pages' | 'remove-draft' | null>(null);
  const [draftToRemoveId, setDraftToRemoveId] = useState('');
  const [bookExportId, setBookExportId] = useState('');
  const [bookPagesId, setBookPagesId] = useState('');
  const [toast, setToast] = useState('');
  const [savedAt, setSavedAt] = useState(() => openedSource ? 'Draft restored · updated copy available' : 'All changes saved');
  const [dirty, setDirty] = useState(false);
  const [isDark, setIsDark] = useState(settings.dark);
  const [tabStops, setTabStops] = useState(settings.tab);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [fontFamily, setFontFamily] = useState(settings.fontFamily);
  const [toolbarFontSize, setToolbarFontSize] = useState(settings.fontSize);
  const [toolbarFontFamily, setToolbarFontFamily] = useState(settings.fontFamily);
  const [ignoredGrammar, setIgnoredGrammar] = useState<string[]>([]);
  const [focusedProofRange, setFocusedProofRange] = useState<{ start: number; end: number } | null>(null);
  const [scansionRows, setScansionRows] = useState<ScannedWord[][]>([]);
  const [meterAnalyses, setMeterAnalyses] = useState<(BrowserMeterEstimate | null)[]>([]);
  const [scansionOverlayItems, setScansionOverlayItems] = useState<ScansionOverlayItem[]>([]);
  const [scanEdits, setScanEdits] = useState<Record<string, ScanLineEdit>>(() => readStorage('poetry-studio-scansion', {}));
  const [spellingErrors, setSpellingErrors] = useState<string[]>([]);
  const [pdfExportOptions, setPdfExportOptions] = useState<PdfExportOptions>(() =>
    normalizePdfExportOptions(readStorage<unknown>(pdfExportOptionsStorageKey, null)),
  );
  const [pdfExportOptionsSaveFailed, setPdfExportOptionsSaveFailed] = useState(false);

  useEffect(() => {
    if (editorRef.current) { editorRef.current.innerHTML = html; savedHtml.current = html; }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('poetry-studio-settings', JSON.stringify({
      ...settings, dark: isDark, proof: proofOn, tab: tabStops, fontSize, fontFamily, fontSizeUnit: 'pt',
    }));
  }, [isDark, proofOn, settings, tabStops, fontSize, fontFamily]);
  useEffect(() => {
    if (localStorage.getItem(draftsStorageKey) === null) {
      localStorage.setItem(draftsStorageKey, JSON.stringify(drafts));
      draftBaselineRef.current = drafts;
    }
  }, []);
  useEffect(() => { localStorage.setItem('poetry-studio-dictionary', JSON.stringify(customWords)); }, [customWords]);
  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(() => {
    localStorage.setItem(booksStorageKey, JSON.stringify(books));
    booksRef.current = books;
  }, [books]);
  useEffect(() => {
    localStorage.setItem(activeDraftStorageKey, JSON.stringify(activeDraftId));
    sessionStorage.setItem(tabActiveDraftStorageKey, JSON.stringify(activeDraftId));
  }, [activeDraftId]);
  useEffect(() => {
    try {
      localStorage.setItem(pdfExportOptionsStorageKey, JSON.stringify(pdfExportOptions));
      setPdfExportOptionsSaveFailed(false);
    } catch {
      setPdfExportOptionsSaveFailed(true);
    }
  }, [pdfExportOptions]);
  useEffect(() => {
    if (toast) { const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout); }
    return undefined;
  }, [toast]);
  useEffect(() => {
    setActiveComparisonChangeIndices([null, null]);
  }, [comparisonRevisionIds[0], comparisonRevisionIds[1]]);

  const text = useMemo(() => cleanText(html), [html]);
  const wordCount = wordsOf(text).length;
  const lines = text.split(/\n/).filter((line) => line.trim());
  const lineCount = lines.length;
  const activeDraft = drafts.find((draft) => draft.id === activeDraftId);
  const activePoemMetadata = normalizePoemMetadata(activeDraft?.metadata);
  const formLabel = activePoemMetadata.form || 'Free verse';
  const intendedForm = findPoetryForm(activePoemMetadata.form);
  const activeFormCheck = formCheckState?.draftId === activeDraftId ? formCheckState.result : null;
  const activeBookId = activeDraft?.bookId ?? books[0]?.id ?? '';
  const shelfBooks: ShelfBook[] = books.map((book) => ({
    id: book.id,
    title: book.title,
    poemCount: drafts.filter((draft) => draft.bookId === book.id).length,
  }));
  const shelfPoems: ShelfPoem[] = drafts.map((draft) => ({
    id: draft.id,
    title: draft.title || 'Untitled poem',
    bookId: draft.bookId ?? activeBookId,
    metadata: normalizePoemMetadata(draft.metadata),
  }));
  const bookToExport = books.find((book) => book.id === bookExportId);
  const bookToEditPages = books.find((book) => book.id === bookPagesId);
  const scanTextLines = text.split('\n');
  const countedLineEntries = scanTextLines.map((line, index) => ({ line, index })).filter(({ line }) => line.trim());
  const query = (rhymeQuery || selection.split(/\s+/).filter(Boolean).pop() || '').replace(/[^\p{L}'-]/gu, '');
  const grammars = useMemo(() => findGrammarSuggestions(text).filter((item) => !dismissed.includes(item.id) && !ignoredGrammar.includes(item.id)), [text, dismissed, ignoredGrammar]);
  const filteredForms = searchPoetryForms(formQuery);

  useEffect(() => {
    let current = true;
    if (!query) {
      setRhymeResults({ perfect: [], near: [] });
      setRhymeLoading(false);
      return () => { current = false; };
    }
    setRhymeLoading(true);
    Promise.all([findRhymes(query, 'perfect'), findRhymes(query, 'near')])
      .then(([perfect, near]) => {
        if (current) {
          setRhymeResults({ perfect, near });
          setDictionaryError('');
        }
      })
      .catch(() => {
        if (current) {
          setRhymeResults({ perfect: [], near: [] });
          setDictionaryError('The built-in pronunciation dictionary could not be loaded. Reload the page to try again.');
        }
      })
      .finally(() => {
        if (current) setRhymeLoading(false);
      });
    return () => { current = false; };
  }, [query]);

  useEffect(() => {
    let current = true;
    if (!text) {
      setScansionRows([]);
      setMeterAnalyses([]);
      return () => { current = false; };
    }
    Promise.all(text.split('\n').map(async (line) => {
      const words = await scanLineWords(line);
      return { words, analysis: line.trim() ? analyzeBrowserMeter(line, words) : null };
    }))
      .then((results) => {
        if (current) {
          setScansionRows(results.map((result) => result.words));
          setMeterAnalyses(results.map((result) => result.analysis));
        }
      })
      .catch(() => {
        if (current) {
          setScansionRows([]);
          setMeterAnalyses([]);
        }
      });
    return () => { current = false; };
  }, [text]);

  useEffect(() => {
    localStorage.setItem('poetry-studio-scansion', JSON.stringify(scanEdits));
  }, [scanEdits]);

  useEffect(() => {
    const editor = editorRef.current;
    const paper = paperRef.current;
    if (!settings.scansion || !editor || !paper) {
      setScansionOverlayItems([]);
      return;
    }

    const updateOverlay = () => {
      setScansionOverlayItems(layoutScansionOverlay(editor, paper, scanTextLines, scansionRows, scanEdits));
    };
    updateOverlay();
    const observer = new ResizeObserver(updateOverlay);
    observer.observe(editor);
    window.addEventListener('resize', updateOverlay);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateOverlay);
    };
  }, [settings.scansion, text, scansionRows, scanEdits, fontSize, tabStops]);

  useEffect(() => {
    let current = true;
    if (!proofOn || !text) {
      setSpellingErrors([]);
      return () => { current = false; };
    }
    findSpellingErrors(text, customWords)
      .then((errors) => {
        if (current) setSpellingErrors(errors);
      })
      .catch(() => {
        if (current) {
          setSpellingErrors([]);
          setDictionaryError('The built-in English word dictionary could not be loaded. Reload the page to try again.');
        }
      });
    return () => { current = false; };
  }, [text, customWords, proofOn]);

  useEffect(() => {
    const editor = editorRef.current;
    const registry = (window.CSS as unknown as {
      highlights?: { set: (name: string, value: object) => void; delete: (name: string) => void };
    }).highlights;
    const HighlightConstructor = (window as unknown as {
      Highlight?: new (...ranges: Range[]) => object;
    }).Highlight;
    if (!editor || !registry || !HighlightConstructor || !proofOn) {
      registry?.delete('poetry-spelling');
      registry?.delete('poetry-grammar');
      return;
    }

    const spellingWords = new Set(spellingErrors.map((word) => word.toLowerCase()));
    const spellingRanges: Range[] = [];
    if (spellingWords.size) {
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent) continue;
        for (const match of node.textContent.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
          if (match.index === undefined || !spellingWords.has(match[0].toLowerCase())) continue;
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          spellingRanges.push(range);
        }
      }
    }
    const grammarRanges = grammars
      .map((item) => createEditorTextRange(editor, item.start, item.end))
      .filter((range): range is Range => range !== null);

    registry.set('poetry-spelling', new HighlightConstructor(...spellingRanges));
    registry.set('poetry-grammar', new HighlightConstructor(...grammarRanges));
    return () => {
      registry.delete('poetry-spelling');
      registry.delete('poetry-grammar');
    };
  }, [html, spellingErrors, grammars, proofOn]);

  useEffect(() => {
    const editor = editorRef.current;
    const registry = (window.CSS as unknown as {
      highlights?: { set: (name: string, value: object) => void; delete: (name: string) => void };
    }).highlights;
    const HighlightConstructor = (window as unknown as {
      Highlight?: new (...ranges: Range[]) => object;
    }).Highlight;
    if (!editor || !focusedProofRange || !proofOn) {
      registry?.delete('poetry-proof-focus');
      return;
    }

    const range = createEditorTextRange(editor, focusedProofRange.start, focusedProofRange.end);
    if (!range) {
      registry?.delete('poetry-proof-focus');
      return;
    }
    if (registry && HighlightConstructor) {
      registry.set('poetry-proof-focus', new HighlightConstructor(range));
      return () => registry.delete('poetry-proof-focus');
    }

    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    editor.focus({ preventScroll: true });
    return undefined;
  }, [focusedProofRange, html, proofOn]);

  const persistDraftList = useCallback((nextDrafts: BrowserPoemDraft[]) => {
    const latestDrafts = readStoredDrafts();
    const merged = mergeDraftChanges(draftBaselineRef.current, nextDrafts, latestDrafts);
    for (const [originalId, conflictId] of merged.conflictCopies) {
      conflictRedirectsRef.current.set(originalId, conflictId);
    }
    draftsRef.current = merged.drafts;
    draftBaselineRef.current = merged.drafts;
    setDrafts(merged.drafts);
    localStorage.setItem(draftsStorageKey, JSON.stringify(merged.drafts));

    const conflictDraftId = merged.conflictCopies.get(activeDraftId);
    if (conflictDraftId) {
      const conflictDraft = merged.drafts.find((draft) => draft.id === conflictDraftId);
      setActiveDraftId(conflictDraftId);
      localStorage.setItem(activeDraftStorageKey, JSON.stringify(conflictDraftId));
      sessionStorage.setItem(tabActiveDraftStorageKey, JSON.stringify(conflictDraftId));
      if (conflictDraft) {
        setTitle(conflictDraft.title);
        if (titleRef.current) titleRef.current.value = conflictDraft.title;
      }
      setToast('This poem changed in another tab. Your edits were saved as a separate copy.');
    }
    return merged.conflictCopies;
  }, [activeDraftId]);

  const persistBookList = useCallback((nextBooks: BrowserPoemBook[]) => {
    booksRef.current = nextBooks;
    setBooks(nextBooks);
    localStorage.setItem(booksStorageKey, JSON.stringify(nextBooks));
  }, []);

  const updateBookPage = useCallback((bookId: string, pageId: string, changes: Partial<Omit<BookMatterPage, 'id'>>) => {
    const book = booksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    const pages = book.pages.map((page) => page.id === pageId ? { ...page, ...changes } : page);
    persistBookList(booksRef.current.map((item) => item.id === bookId ? { ...item, pages } : item));
  }, [persistBookList]);

  const addBookPage = useCallback((bookId: string, type: BookPageType) => {
    const book = booksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    if (book.pages.length >= 80) {
      setToast('A book can contain up to 80 custom pages.');
      return;
    }
    const page = createBookMatterPage(type, createDraftId(), book.title);
    const kindOrder = (pageType: BookPageType) => bookPageKinds.findIndex((kind) => kind.type === pageType);
    const targetOrder = kindOrder(page.type);
    const firstLaterKind = book.pages.findIndex((existing) =>
      existing.section === page.section && kindOrder(existing.type) > targetOrder,
    );
    const sameSectionIndexes = book.pages
      .map((existing, index) => existing.section === page.section ? index : -1)
      .filter((index) => index >= 0);
    let insertAt = sameSectionIndexes.length ? sameSectionIndexes[sameSectionIndexes.length - 1] + 1 : book.pages.length;
    if (firstLaterKind >= 0) insertAt = firstLaterKind;
    else if (!sameSectionIndexes.length && page.section === 'before-contents') insertAt = 0;
    else if (!sameSectionIndexes.length && page.section === 'after-contents') {
      const backMatterIndex = book.pages.findIndex((existing) => existing.section === 'back-matter');
      insertAt = backMatterIndex < 0 ? book.pages.length : backMatterIndex;
    }
    const pages = [...book.pages];
    pages.splice(insertAt, 0, page);
    persistBookList(booksRef.current.map((item) => item.id === bookId ? { ...item, pages } : item));
  }, [persistBookList]);

  const moveBookPage = useCallback((bookId: string, pageId: string, direction: 'up' | 'down') => {
    const book = booksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    const pages = [...book.pages];
    const pageIndex = pages.findIndex((page) => page.id === pageId);
    if (pageIndex < 0) return;
    const sectionIndexes = pages.map((page, index) => page.section === pages[pageIndex].section ? index : -1).filter((index) => index >= 0);
    const sectionPosition = sectionIndexes.indexOf(pageIndex);
    const targetIndex = sectionIndexes[sectionPosition + (direction === 'up' ? -1 : 1)];
    if (targetIndex === undefined) return;
    [pages[pageIndex], pages[targetIndex]] = [pages[targetIndex], pages[pageIndex]];
    persistBookList(booksRef.current.map((item) => item.id === bookId ? { ...item, pages } : item));
  }, [persistBookList]);

  const removeBookPage = useCallback((bookId: string, pageId: string) => {
    const book = booksRef.current.find((item) => item.id === bookId);
    if (!book) return;
    persistBookList(booksRef.current.map((item) => item.id === bookId
      ? { ...item, pages: item.pages.filter((page) => page.id !== pageId) }
      : item));
  }, [persistBookList]);

  const updateDraft = useCallback((draftId: string, changes: Partial<Omit<BrowserPoemDraft, 'id'>>) => {
    const targetDraftId = conflictRedirectsRef.current.get(draftId) ?? draftId;
    const nextDrafts = draftsRef.current.map((draft) => draft.id === targetDraftId ? { ...draft, ...changes } : draft);
    const conflictCopies = persistDraftList(nextDrafts);
    return conflictRedirectsRef.current.get(targetDraftId)
      ?? conflictCopies.get(targetDraftId)
      ?? targetDraftId;
  }, [persistDraftList]);

  const updatePoemMetadata = useCallback((draftId: string, metadata: PoemMetadata) => {
    const currentDraft = draftsRef.current.find((draft) => draft.id === draftId);
    if (!currentDraft) return;
    const changes: Partial<Omit<BrowserPoemDraft, 'id'>> = {
      metadata: normalizePoemMetadata(metadata),
    };
    if (draftId === activeDraftId) {
      changes.title = titleRef.current?.value ?? title;
      changes.editorHtml = editorRef.current?.innerHTML ?? currentDraft.editorHtml;
      changes.source = openedSource;
    }
    updateDraft(draftId, changes);
  }, [activeDraftId, openedSource, title, updateDraft]);

  const saveRevision = useCallback((draftId: string, revisionTitle: string, editorHtml: string) => {
    const history = readPoemRevisions(draftId);
    const revision: BrowserPoemRevision = {
      id: createDraftId(),
      title: revisionTitle,
      editorHtml,
      createdAt: new Date().toISOString(),
    };
    const nextHistory = appendBrowserPoemRevision(history, revision, maxPoemRevisions);
    if (nextHistory !== history && !(history[0]?.title === revisionTitle && history[0]?.editorHtml === editorHtml)) {
      localStorage.setItem(revisionStorageKey(draftId), JSON.stringify(nextHistory));
    }
    if (draftId === activeDraftId) setRevisionHistory(nextHistory);
    return nextHistory;
  }, [activeDraftId]);

  const activateDraft = useCallback((draft: BrowserPoemDraft) => {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(titleTimer.current);
    conflictRedirectsRef.current.delete(draft.id);
    fileHandleRef.current = fileHandlesRef.current.get(draft.id) ?? null;
    setActiveDraftId(draft.id);
    localStorage.setItem(activeDraftStorageKey, JSON.stringify(draft.id));
    sessionStorage.setItem(tabActiveDraftStorageKey, JSON.stringify(draft.id));
    const nextHistory = readPoemRevisions(draft.id);
    setRevisionHistory(nextHistory);
    setSelectedRevisionId(nextHistory[0]?.id ?? '');
    setOpenedSource(draft.source);
    setTitle(draft.title);
    setHtml(draft.editorHtml);
    savedHtml.current = draft.editorHtml;
    if (editorRef.current) editorRef.current.innerHTML = draft.editorHtml;
    setDirty(false);
    setSavedAt(draft.source ? 'Draft restored · updated copy available' : 'All changes saved');
    setSelection('');
    setRhymeQuery('');
    setDismissed([]);
    setIgnoredGrammar([]);
    setFocusedProofRange(null);
  }, []);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== draftsStorageKey || event.newValue === null) return;
      let latest: BrowserPoemDraft[];
      try {
        const parsed: unknown = JSON.parse(event.newValue);
        latest = Array.isArray(parsed)
          ? parsed.filter(isBrowserPoemDraft).map((draft) => ({ ...draft, metadata: normalizePoemMetadata(draft.metadata) }))
          : [];
      } catch {
        return;
      }
      const previousActiveDraft = draftsRef.current.find((draft) => draft.id === activeDraftId);
      const updatedActiveDraft = latest.find((draft) => draft.id === activeDraftId);
      draftsRef.current = latest;
      setDrafts(latest);

      if (dirty && previousActiveDraft && updatedActiveDraft && !sameDraft(previousActiveDraft, updatedActiveDraft)) {
        setToast('This poem changed in another tab. Your edits are still here; saving will keep both copies.');
      } else if (!dirty && updatedActiveDraft) {
        setTitle(updatedActiveDraft.title);
        setHtml(updatedActiveDraft.editorHtml);
        setOpenedSource(updatedActiveDraft.source);
        savedHtml.current = updatedActiveDraft.editorHtml;
        if (titleRef.current) titleRef.current.value = updatedActiveDraft.title;
        if (editorRef.current) editorRef.current.innerHTML = updatedActiveDraft.editorHtml;
      } else if (!updatedActiveDraft && latest.length && !dirty) {
        activateDraft(latest[0]);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [activateDraft, activeDraftId, dirty]);

  const persistNow = useCallback((nextHtml = editorRef.current?.innerHTML ?? html) => {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(titleTimer.current);
    const currentTitle = titleRef.current?.value || title;
    const savedDraftId = updateDraft(activeDraftId, {
      title: currentTitle,
      editorHtml: nextHtml,
      source: openedSource,
    });
    saveRevision(savedDraftId, titleRef.current?.value || currentTitle, nextHtml);
    savedHtml.current = nextHtml;
    setHtml(nextHtml);
    setDirty(false);
    setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    return savedDraftId;
  }, [activeDraftId, html, openedSource, saveRevision, title, updateDraft]);

  const openHistory = useCallback(() => {
    persistNow();
    const history = readPoemRevisions(activeDraftId);
    setRevisionHistory(history);
    setSelectedRevisionId(history[0]?.id ?? '');
    setComparisonRevisionIds([history[0]?.id ?? '', history[1]?.id ?? '']);
    setModal('history');
  }, [activeDraftId, persistNow]);

  const restoreRevision = useCallback(() => {
    const revision = revisionHistory.find((item) => item.id === selectedRevisionId);
    if (!revision) return;
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(titleTimer.current);
    const currentTitle = titleRef.current?.value || title;
    const currentHtml = editorRef.current?.innerHTML ?? html;
    saveRevision(activeDraftId, currentTitle, currentHtml);
    const activeDraft = draftsRef.current.find((draft) => draft.id === activeDraftId);
    if (!activeDraft) return;
    const restoredDraft = restoreBrowserPoemDraft(activeDraft, revision);
    persistDraftList(draftsRef.current.map((draft) => draft.id === activeDraftId ? restoredDraft : draft));
    saveRevision(activeDraftId, revision.title, revision.editorHtml);
    setTitle(revision.title);
    setHtml(revision.editorHtml);
    if (titleRef.current) titleRef.current.value = revision.title;
    if (editorRef.current) editorRef.current.innerHTML = revision.editorHtml;
    savedHtml.current = revision.editorHtml;
    setDirty(false);
    setSavedAt('Earlier version restored');
    setModal(null);
    setToast('Earlier version restored');
  }, [activeDraftId, html, persistDraftList, revisionHistory, saveRevision, selectedRevisionId, title]);

  const switchDraft = useCallback((draftId: string) => {
    if (draftId === activeDraftId) return;
    persistNow();
    const nextDraft = draftsRef.current.find((draft) => draft.id === draftId);
    if (nextDraft) activateDraft(nextDraft);
  }, [activeDraftId, activateDraft, persistNow]);

  const createBrowserDraft = useCallback((bookId = activeBookId) => {
    persistNow();
    const draft: BrowserPoemDraft = {
      id: createDraftId(),
      title: 'Untitled poem',
      editorHtml: '<p><br></p>',
      source: null,
      bookId: bookId || booksRef.current[0]?.id,
      metadata: emptyPoemMetadata(),
    };
    persistDraftList([...draftsRef.current, draft]);
    activateDraft(draft);
    setSavedAt('New poem');
    setToast('New poem created');
  }, [activeBookId, activateDraft, persistDraftList, persistNow]);

  const removeDraft = useCallback(() => {
    const draft = draftsRef.current.find((item) => item.id === draftToRemoveId);
    if (!draft) {
      setModal(null);
      return;
    }
    persistNow();
    const remainingDrafts = removeBrowserPoemDraft(draftsRef.current, draft.id);
    localStorage.removeItem(revisionStorageKey(draft.id));
    fileHandlesRef.current.delete(draft.id);

    if (draft.id === activeDraftId) {
      if (remainingDrafts.length) {
        persistDraftList(remainingDrafts);
        activateDraft(remainingDrafts[0]);
      } else {
        const cleanDraft: BrowserPoemDraft = {
          id: createDraftId(),
          title: 'Untitled poem',
          editorHtml: '<p><br></p>',
          source: null,
          bookId: draft.bookId ?? booksRef.current[0]?.id,
          metadata: emptyPoemMetadata(),
        };
        persistDraftList([cleanDraft]);
        activateDraft(cleanDraft);
      }
    } else {
      persistDraftList(remainingDrafts);
    }

    setDraftToRemoveId('');
    setModal(null);
    setToast(`Removed “${draft.title || 'Untitled poem'}”`);
  }, [activeDraftId, activateDraft, draftToRemoveId, persistDraftList, persistNow]);

  const createBook = useCallback(() => {
    persistNow();
    const book: BrowserPoemBook = {
      id: createDraftId(),
      title: 'Untitled book',
      createdAt: new Date().toISOString(),
      pages: [],
    };
    const draft: BrowserPoemDraft = {
      id: createDraftId(),
      title: 'Untitled poem',
      editorHtml: '<p><br></p>',
      source: null,
      bookId: book.id,
      metadata: emptyPoemMetadata(),
    };
    persistBookList([...booksRef.current, book]);
    persistDraftList([...draftsRef.current, draft]);
    activateDraft(draft);
    setSavedAt('New book created');
    setToast('New book and poem created');
  }, [activateDraft, persistBookList, persistDraftList, persistNow]);

  const renameBook = useCallback((bookId: string, title: string) => {
    const nextTitle = title.trim().slice(0, 120);
    if (!nextTitle) {
      setToast('A book needs a name');
      return;
    }
    const previousBook = booksRef.current.find((book) => book.id === bookId);
    if (!previousBook || previousBook.title === nextTitle) return;
    const nextBooks = booksRef.current.map((book) => book.id === bookId ? { ...book, title: nextTitle } : book);
    persistBookList(nextBooks);
    setToast('Book renamed');
  }, [persistBookList]);

  const movePoem = useCallback((poemId: string, targetBookId: string) => {
    if (!booksRef.current.some((book) => book.id === targetBookId)) return;
    const poem = draftsRef.current.find((draft) => draft.id === poemId);
    if (!poem || poem.bookId === targetBookId) return;
    persistNow();
    const currentPoem = draftsRef.current.find((draft) => draft.id === poemId);
    if (!currentPoem) return;
    const remaining = draftsRef.current.filter((draft) => draft.id !== poemId);
    persistDraftList([...remaining, { ...currentPoem, bookId: targetBookId }]);
    setToast(`Moved “${poem.title || 'Untitled poem'}” to ${booksRef.current.find((book) => book.id === targetBookId)?.title}`);
  }, [persistDraftList, persistNow]);

  const reorderPoem = useCallback((poemId: string, direction: PoemOrderDirection) => {
    const currentDrafts = draftsRef.current;
    const reorderedDrafts = reorderPoemsInBook(currentDrafts, poemId, direction);
    if (reorderedDrafts === currentDrafts) return;
    persistDraftList(reorderedDrafts);
    const poem = reorderedDrafts.find((draft) => draft.id === poemId);
    if (poem) setToast(`Moved “${poem.title || 'Untitled poem'}” ${direction === 'up' ? 'up' : 'down'} in its book`);
  }, [persistDraftList]);

  const openBookExport = useCallback((bookId: string) => {
    setBookExportId(bookId);
    setModal('book-export');
  }, []);

  const openBookPages = useCallback((bookId: string) => {
    setBookPagesId(bookId);
    setModal('book-pages');
  }, []);

  const beginBookImport = useCallback(() => {
    persistNow();
    bookInputRef.current?.click();
  }, [persistNow]);

  const onBookImportFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const imported = await readBookBundle(file);
      const book: BrowserPoemBook = {
        id: createDraftId(),
        title: imported.title,
        createdAt: new Date().toISOString(),
        pages: normalizeBookPages(imported.pages),
      };
      const importedDrafts: BrowserPoemDraft[] = imported.poems.map((poem) => ({
        id: createDraftId(),
        title: poem.title,
        editorHtml: poem.editorHtml,
        source: poem.source,
        bookId: book.id,
        metadata: normalizePoemMetadata(poem.metadata),
      }));
      persistBookList([...booksRef.current, book]);
      persistDraftList([...draftsRef.current, ...importedDrafts]);
      activateDraft(importedDrafts[0]);
      setToast(`Imported “${book.title}” with ${importedDrafts.length} ${importedDrafts.length === 1 ? 'poem' : 'poems'}`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not import this book file.');
    }
  }, [activateDraft, persistBookList, persistDraftList]);

  const applyOpenedPoem = useCallback((poem: { title: string; text: string; editorHtml?: string; fileName: string; format: PoemFileFormat }, handle: WritablePoemFileHandle | null) => {
    persistNow();
    const nextHtml = poem.editorHtml ?? poemTextToEditorHtml(poem.text);
    const writableFormat = isWritablePoemFileFormat(poem.format) ? poem.format : null;
    const source = writableFormat ? { fileName: poem.fileName, format: writableFormat } : null;
    const draft: BrowserPoemDraft = {
      id: createDraftId(),
      title: poem.title,
      editorHtml: nextHtml,
      source,
      bookId: activeBookId || booksRef.current[0]?.id,
      metadata: emptyPoemMetadata(),
    };
    const nextDrafts = [...draftsRef.current, draft];
    persistDraftList(nextDrafts);
    activateDraft(draft);
    if (writableFormat && handle) fileHandlesRef.current.set(draft.id, handle);
    fileHandleRef.current = writableFormat ? handle : null;
    const isOfficeDocument = poem.format === 'rtf' || poem.format === 'docx' || poem.format === 'odt';
    const keepsBasicStyling = poem.format === 'docx' || poem.format === 'odt';
    setSavedAt(isOfficeDocument ? (keepsBasicStyling ? 'Imported with basic styling' : 'Imported as editable text') : 'Opened from device');
    setToast(isOfficeDocument
      ? keepsBasicStyling
        ? `Opened ${poem.fileName} with supported styling; saving keeps its text and title`
        : `Opened ${poem.fileName} as editable text; saving keeps its text and title`
      : `Opened ${poem.fileName}`);
  }, [activeBookId, activateDraft, persistDraftList, persistNow]);

  const openPoem = useCallback(async () => {
    persistNow();
    try {
      const handle = await choosePoemFile();
      if (handle) {
        const poem = await readPoemFile(await handle.getFile());
        applyOpenedPoem(poem, handle);
      } else {
        fileInputRef.current?.click();
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setToast(error instanceof Error ? error.message : 'Could not open that poem file.');
    }
  }, [applyOpenedPoem, persistNow]);

  const onFallbackFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const poem = await readPoemFile(file);
      applyOpenedPoem(poem, null);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not open that poem file.');
    }
  }, [applyOpenedPoem]);

  const savePoem = useCallback(async () => {
    const currentTitle = titleRef.current?.value || title;
    const currentHtml = editorRef.current?.innerHTML ?? html;
    const currentText = cleanText(currentHtml);
    const handle = fileHandleRef.current;
    const format = openedSource?.format ?? null;
    const content = format ? serializePoem(currentTitle, currentText, format, currentHtml) : null;
    if (handle && format) {
      try {
        await writePoemFile(handle, content!);
        const editorUnchanged = editorRef.current?.innerHTML === currentHtml;
        const titleUnchanged = titleRef.current?.value === currentTitle;
        if (editorUnchanged && titleUnchanged) {
          persistNow(currentHtml);
          setToast(format === 'rtf' || format === 'docx' || format === 'odt'
            ? `Saved to ${handle.name}; supported emphasis and paragraph layout were retained`
            : `Saved to ${handle.name}`);
          setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
        } else {
          setToast(`Saved to ${handle.name}; newer edits remain in the browser draft`);
          setSavedAt('Newer edits need saving');
        }
      } catch (error) {
        if (content) {
          downloadPoemFile(openedSource?.fileName || handle.name, content, format);
          const editorUnchanged = editorRef.current?.innerHTML === currentHtml;
          const titleUnchanged = titleRef.current?.value === currentTitle;
          if (editorUnchanged && titleUnchanged) persistNow(currentHtml);
          else setSavedAt('Newer edits need saving');
          setToast(format === 'rtf' || format === 'docx' || format === 'odt'
            ? 'Could not update the original; an updated copy was downloaded with supported styling'
            : 'Could not update the original file; an updated copy was downloaded');
        } else {
          setToast(error instanceof Error ? error.message : 'Could not save to this file.');
        }
      }
      return;
    }
    if (openedSource && format) {
      downloadPoemFile(openedSource.fileName, content!, format);
      persistNow(currentHtml);
      setToast(format === 'rtf' || format === 'docx' || format === 'odt'
        ? 'Updated copy downloaded with supported styling; browser draft also saved'
        : 'Updated copy downloaded; browser draft also saved');
      return;
    }
    const savedDraftId = persistNow(currentHtml);
    setToast(savedDraftId !== activeDraftId
      ? 'Your edits conflicted with a newer version and were saved as a separate copy.'
      : 'Draft saved in this browser');
  }, [html, openedSource, persistNow, title]);

  const onEditorInput = useCallback(() => {
    const next = editorRef.current?.innerHTML || '';
    setFocusedProofRange(null);
    setHtml(next); setDirty(true); setSavedAt('Saving…');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const currentTitle = titleRef.current?.value || title;
      const savedDraftId = updateDraft(activeDraftId, {
        title: currentTitle,
        editorHtml: next,
        source: openedSource,
      });
      saveRevision(savedDraftId, titleRef.current?.value || currentTitle, next);
      savedHtml.current = next; setDirty(false);
      setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }, 550);
  }, [activeDraftId, openedSource, saveRevision, title, updateDraft]);

  const focusProofSuggestion = useCallback((item: GrammarSuggestion) => {
    const editor = editorRef.current;
    const range = editor ? createEditorTextRange(editor, item.start, item.end) : null;
    if (!editor || !range) {
      setToast('That suggestion no longer matches the poem text.');
      return;
    }
    const target = range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.parentElement
      : range.startContainer as Element;
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFocusedProofRange({ start: item.start, end: item.end });
  }, []);

  const applyProofSuggestion = useCallback((item: GrammarSuggestion) => {
    const editor = editorRef.current;
    const range = editor ? createEditorTextRange(editor, item.start, item.end) : null;
    if (!editor || !range) {
      setToast('That suggestion no longer matches the poem text.');
      return;
    }

    range.deleteContents();
    const replacement = document.createTextNode(item.fix);
    range.insertNode(replacement);
    const caret = document.createRange();
    caret.setStartAfter(replacement);
    caret.collapse(true);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(caret);
    editor.focus({ preventScroll: true });
    setFocusedProofRange(null);
    setDismissed((current) => current.includes(item.id) ? current : [...current, item.id]);
    onEditorInput();
  }, [onEditorInput]);

  const onTitleChange = useCallback((nextTitle: string) => {
    setTitle(nextTitle);
    setDirty(true);
    setSavedAt('Saving…');
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => {
      const currentHtml = editorRef.current?.innerHTML ?? html;
      const savedDraftId = updateDraft(activeDraftId, { title: nextTitle, editorHtml: currentHtml, source: openedSource });
      saveRevision(savedDraftId, titleRef.current?.value || nextTitle, currentHtml);
      setDirty(false);
      setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }, 550);
  }, [activeDraftId, html, openedSource, saveRevision, updateDraft]);

  const captureSelection = useCallback(() => {
    const editor = editorRef.current;
    const browserSelection = window.getSelection();
    const range = browserSelection?.rangeCount ? browserSelection.getRangeAt(0) : null;
    if (editor && range && editor.contains(range.commonAncestorContainer)) {
      savedEditorRange.current = range.cloneRange();
      const focusNode = browserSelection?.focusNode;
      if (focusNode && editor.contains(focusNode)) {
        let focusElement: Element | null = focusNode.nodeType === Node.ELEMENT_NODE
          ? focusNode as Element
          : focusNode.parentElement;
        if (focusNode.nodeType === Node.ELEMENT_NODE) {
          const children = focusNode.childNodes;
          const childIndex = Math.max(0, Math.min(browserSelection?.focusOffset ?? 0, children.length - 1));
          const child = children[childIndex];
          if (child?.nodeType === Node.ELEMENT_NODE) focusElement = child as Element;
        }
        if (focusElement && editor.contains(focusElement)) {
          const computed = window.getComputedStyle(focusElement);
          const currentSize = Number.parseFloat(computed.fontSize) * 0.75;
          if (Number.isFinite(currentSize)) {
            const nearestSize = fontSizeOptions.reduce((nearest, candidate) =>
              Math.abs(candidate - currentSize) < Math.abs(nearest - currentSize) ? candidate : nearest,
            fontSizeOptions[0]);
            setToolbarFontSize(nearestSize);
          }
          const normalizeFamily = (family: string) =>
            family.split(',')[0].trim().replace(/["']/g, '').toLowerCase();
          const currentFamily = normalizeFamily(computed.fontFamily);
          const matchingFont = fontFamilies.find((font) => normalizeFamily(font.value) === currentFamily);
          if (matchingFont) setToolbarFontFamily(matchingFont.value);
        }
      }
    }
    const selected = browserSelection?.toString().trim() || '';
    if (selected) { setSelection(selected); setRhymeQuery(selected.split(/\s+/).pop()?.replace(/[^\p{L}'-]/gu, '') || ''); }
  }, []);
  const format = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    onEditorInput();
  }, [onEditorInput]);
  const applyTextStyle = useCallback((property: 'fontSize' | 'fontFamily', value: string) => {
    const editor = editorRef.current;
    const previousRange = savedEditorRange.current;
    const hasEditorRange = Boolean(editor && previousRange && editor.contains(previousRange.commonAncestorContainer));
    const range = hasEditorRange ? previousRange! : null;
    const selectedFontFamily = property === 'fontFamily'
      ? fontFamilies.find((font) => font.value === value)?.value
      : undefined;
    if (property === 'fontFamily' && !selectedFontFamily) return;
    const styleValue = selectedFontFamily ?? value;

    if (editor) {
      editor.focus({ preventScroll: true });
      if (range) {
        const browserSelection = window.getSelection();
        browserSelection?.removeAllRanges();
        browserSelection?.addRange(range.cloneRange());
      }
    }

    if (!editor || !range || range.collapsed) {
      if (property === 'fontSize') {
        const nextSize = Number.parseFloat(styleValue);
        setFontSize(nextSize);
        setToolbarFontSize(nextSize);
      } else {
        setFontFamily(selectedFontFamily!);
        setToolbarFontFamily(selectedFontFamily!);
      }
      return;
    }

    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (node.nodeType === Node.TEXT_NODE && range.intersectsNode(node)) textNodes.push(node as Text);
    }

    const formattedSpans: HTMLSpanElement[] = [];
    for (const textNode of textNodes) {
      const start = range.startContainer === textNode ? range.startOffset : 0;
      const end = range.endContainer === textNode ? range.endOffset : textNode.length;
      if (end <= start) continue;
      const selectedLength = end - start;
      const selectedNode = start > 0 ? textNode.splitText(start) : textNode;
      if (selectedLength < selectedNode.length) selectedNode.splitText(selectedLength);
      const span = document.createElement('span');
      span.style[property] = styleValue;
      selectedNode.parentNode?.insertBefore(span, selectedNode);
      span.appendChild(selectedNode);
      formattedSpans.push(span);
    }

    const firstText = formattedSpans[0]?.firstChild;
    const lastText = formattedSpans.at(-1)?.firstChild;
    if (firstText?.nodeType === Node.TEXT_NODE && lastText?.nodeType === Node.TEXT_NODE) {
      const nextRange = document.createRange();
      nextRange.setStart(firstText, 0);
      nextRange.setEnd(lastText, lastText.textContent?.length ?? 0);
      const browserSelection = window.getSelection();
      browserSelection?.removeAllRanges();
      browserSelection?.addRange(nextRange);
      savedEditorRange.current = nextRange.cloneRange();
    }

    if (property === 'fontSize') setToolbarFontSize(Number.parseFloat(styleValue));
    else setToolbarFontFamily(selectedFontFamily!);
    onEditorInput();
  }, [onEditorInput]);
  const chooseTool = (tool: Tool) => {
    setActiveTool(tool);
  };
  const addToDictionary = (word: string) => {
    const normalized = word.trim().toLowerCase().replace(/[^\p{L}'-]/gu, '');
    if (normalized && !customWords.includes(normalized)) { setCustomWords((old) => [...old, normalized]); setToast(`“${normalized}” added to your dictionary`); }
  };
  const cycleScansionMark = (item: Extract<ScansionOverlayItem, { kind: 'syllable' }>) => {
    setScanEdits((previous) => {
      const current = previous[item.lineKey] ?? { marks: {}, feet: [] };
      const symbol = current.marks[item.syllableIndex] ?? item.symbol;
      const symbols: ScanSymbol[] = ['u', '/', '\\'];
      const next = symbols[(symbols.indexOf(symbol) + 1) % symbols.length];
      return {
        ...previous,
        [item.lineKey]: {
          ...current,
          marks: { ...current.marks, [item.syllableIndex]: next },
        },
      };
    });
  };
  const toggleFootBoundary = (item: Extract<ScansionOverlayItem, { kind: 'foot' }>) => {
    setScanEdits((previous) => {
      const current = previous[item.lineKey] ?? { marks: {}, feet: [] };
      const feet = current.feet.includes(item.boundaryIndex)
        ? current.feet.filter((boundary) => boundary !== item.boundaryIndex)
        : [...current.feet, item.boundaryIndex].sort((a, b) => a - b);
      return { ...previous, [item.lineKey]: { ...current, feet } };
    });
  };
  const exportPoem = (kind: WritablePoemFileFormat | 'pdf') => {
    const content = kind === 'pdf' ? serializePoemPdf(title, text, html, pdfExportOptions) : serializePoem(title, text, kind, html);
    const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'poem'}.${kind}`;
    downloadPoemFile(fileName, content, kind);
    setModal(null); setToast(`Poem exported as ${kind.toUpperCase()}`);
  };
  const exportBookAsPdf = () => {
    if (!bookToExport) return;
    try {
      const poems = drafts
        .filter((draft) => draft.bookId === bookToExport.id)
        .map((draft) => ({
          title: draft.title,
          text: cleanText(draft.editorHtml),
          editorHtml: draft.editorHtml,
        }));
      const content = serializeBookPdf(bookToExport.title, poems, pdfExportOptions, bookToExport.pages);
      const slug = bookToExport.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poetry-book';
      downloadPoemFile(`${slug}.pdf`, content, 'pdf');
      setModal(null);
      setToast(`Downloaded ${bookToExport.title} as a paginated PDF`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not download this book.');
    }
  };
  const exportBookArchive = () => {
    if (!bookToExport) return;
    try {
      const poems = drafts.filter((draft) => draft.bookId === bookToExport.id);
      downloadBookBundle(bookToExport.title, serializeBookBundle(bookToExport.title, poems, bookToExport.pages));
      setModal(null);
      setToast(`Exported ${bookToExport.title} book file`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'Could not export this book.');
    }
  };
  const checkPoemAgainstForm = async (form: FormEntry) => {
    const currentDraft = draftsRef.current.find((draft) => draft.id === activeDraftId);
    if (!currentDraft) return;
    updatePoemMetadata(currentDraft.id, {
      ...normalizePoemMetadata(currentDraft.metadata),
      form: form.name,
    });
    setIsCheckingForm(true);
    setFormCheckError('');
    try {
      const poemText = editorRef.current?.innerText ?? cleanText(currentDraft.editorHtml);
      const result = await analyzePoemForm(poemText, form);
      setFormCheckState({ draftId: currentDraft.id, result });
    } catch (error) {
      setFormCheckError(error instanceof Error ? error.message : 'Could not check this poem against the form.');
    } finally {
      setIsCheckingForm(false);
    }
  };
  const applyForm = (form: FormEntry) => {
    const currentDraft = draftsRef.current.find((draft) => draft.id === activeDraftId);
    if (currentDraft) {
      updatePoemMetadata(currentDraft.id, {
        ...normalizePoemMetadata(currentDraft.metadata),
        form: form.name,
      });
    }
    setModal(null);
    setToast(`${form.name} reference loaded`);
  };
  const renderPdfExportOptions = () => <div className="form-grid" style={{ margin: '0 0 12px' }}>
    <label>
      <span className="field-label">Paper size</span>
      <select
        className="text-field"
        value={pdfExportOptions.pageSize}
        onChange={(event) => setPdfExportOptions((previous) => ({ ...previous, pageSize: event.target.value as PdfExportOptions['pageSize'] }))}
        data-testid="select-pdf-page-size"
      >
        <option value="letter">Letter · 8.5 × 11 in</option>
        <option value="a4">A4 · 210 × 297 mm</option>
        <option value="a5">A5 · 148 × 210 mm</option>
        <option value="custom">Custom size</option>
      </select>
    </label>
    {pdfExportOptions.pageSize === 'custom' && <>
      <label>
        <span className="field-label">Custom width (inches)</span>
        <input
          className="text-field"
          type="number"
          min="3"
          max="36"
          step="0.01"
          value={pdfExportOptions.customWidthInches ?? defaultPdfExportOptions.customWidthInches}
          onChange={(event) => setPdfExportOptions((previous) => ({ ...previous, customWidthInches: Number(event.target.value) }))}
          data-testid="input-pdf-custom-width"
        />
      </label>
      <label>
        <span className="field-label">Custom height (inches)</span>
        <input
          className="text-field"
          type="number"
          min="3"
          max="36"
          step="0.01"
          value={pdfExportOptions.customHeightInches ?? defaultPdfExportOptions.customHeightInches}
          onChange={(event) => setPdfExportOptions((previous) => ({ ...previous, customHeightInches: Number(event.target.value) }))}
          data-testid="input-pdf-custom-height"
        />
      </label>
    </>}
    <label>
      <span className="field-label">Orientation</span>
      <select
        className="text-field"
        value={pdfExportOptions.orientation ?? 'portrait'}
        onChange={(event) => setPdfExportOptions((previous) => ({ ...previous, orientation: event.target.value as NonNullable<PdfExportOptions['orientation']> }))}
        data-testid="select-pdf-orientation"
      >
        <option value="portrait">Portrait</option>
        <option value="landscape">Landscape</option>
      </select>
    </label>
    <label>
      <span className="field-label">Margins</span>
      <select
        className="text-field"
        value={pdfExportOptions.margins}
        onChange={(event) => setPdfExportOptions((previous) => ({ ...previous, margins: event.target.value as PdfExportOptions['margins'] }))}
        data-testid="select-pdf-margins"
      >
        <option value="narrow">Narrow · 0.5 in</option>
        <option value="standard">Standard · 1 in</option>
        <option value="wide">Wide · 1.25 in</option>
      </select>
    </label>
    <button
      className="button small"
      type="button"
      style={{ justifySelf: 'start' }}
      onClick={() => setPdfExportOptions({ ...defaultPdfExportOptions })}
      data-testid="button-reset-pdf-options"
    >
      <RotateCcw/>Reset to standard
    </button>
    {pdfExportOptionsSaveFailed && <div className="notice" role="status" data-testid="pdf-options-save-warning" style={{ gridColumn: '1 / -1', margin: 0 }}>
      <CircleHelp/>PDF print choices could not be saved in this browser. Your current selections will still be used for exports during this session.
    </div>}
  </div>;
  const insertTab = () => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, tabStops === '2 spaces' ? '  ' : tabStops === '8 spaces' ? '        ' : '    ');
    onEditorInput();
  };

  const toolbarButton = (label: string, icon: ReactNode, action: () => void, selected = false) => (
    <button className={`tool ${selected ? 'selected' : ''}`} title={label} aria-label={label} data-testid={`tool-${label.toLowerCase().replace(/\s+/g, '-')}`} onMouseDown={(event) => event.preventDefault()} onClick={action}>{icon}</button>
  );
  const selectedRevision = revisionHistory.find((revision) => revision.id === selectedRevisionId) ?? revisionHistory[0];
  const comparisonRevisions = comparisonRevisionIds.map((id) => revisionHistory.find((revision) => revision.id === id) ?? null);
  const comparisonTexts = comparisonRevisions.map((revision) => revision ? cleanText(revision.editorHtml) : '');
  const comparisonLines = comparisonTexts.map((text) => text.split('\n'));
  const alignedComparisonLines = alignComparisonLines(comparisonLines[0], comparisonLines[1]);
  const comparisonWordDiffs = alignedComparisonLines.map((lines) => lines.map((line) =>
    diffWords(line.text, line.peerText ?? '').left));
  const comparisonChangedWordCounts = comparisonWordDiffs.map((lines) =>
    lines.reduce((total, segments) => total + segments.filter((segment) => segment.isWord && segment.changed).length, 0));
  const comparisonChangedLineIndices = alignedComparisonLines.map((lines) =>
    lines.flatMap((line, index) => line.changed ? [index] : []));
  const comparisonTitlesMatch = Boolean(comparisonRevisions[0] && comparisonRevisions[1]
    && comparisonRevisions[0].title === comparisonRevisions[1].title);
  const comparisonManuscriptsMatch = Boolean(comparisonRevisions[0] && comparisonRevisions[1]
    && comparisonTexts[0] === comparisonTexts[1]);
  const navigateComparisonChange = (slot: number, direction: -1 | 1) => {
    const changedLineIndices = comparisonChangedLineIndices[slot];
    if (!changedLineIndices.length) return;
    const activePosition = changedLineIndices.indexOf(activeComparisonChangeIndices[slot] ?? -1);
    const nextPosition = activePosition < 0
      ? (direction > 0 ? 0 : changedLineIndices.length - 1)
      : (activePosition + direction + changedLineIndices.length) % changedLineIndices.length;
    const nextLineIndex = changedLineIndices[nextPosition];
    setActiveComparisonChangeIndices((previous) => {
      const next: [number | null, number | null] = [...previous];
      next[slot] = nextLineIndex;
      return next;
    });
    comparisonManuscriptRefs.current[slot]
      ?.querySelector<HTMLElement>(`[data-change-index="${nextLineIndex}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  };

  return (
    <div className={`studio ${isDark ? 'dark' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">p</div><div><div className="brand-name">Poetry Studio</div><div className="brand-kicker">a room for the line</div></div></div>
        <div className="side-label">Your desk</div>
        <nav aria-label="Studio tools">
          <button className={`side-button ${activeTool === 'rhymes' ? 'active' : ''}`} onClick={() => chooseTool('rhymes')} data-testid="nav-rhymes"><Feather/><span>Rhyme room</span></button>
          <button className={`side-button ${activeTool === 'forms' ? 'active' : ''}`} onClick={() => chooseTool('forms')} data-testid="nav-forms"><BookOpen/><span>Forms library</span></button>
          <button className={`side-button ${activeTool === 'metadata' ? 'active' : ''}`} onClick={() => chooseTool('metadata')} data-testid="nav-metadata"><FileText/><span>Poem metadata</span></button>
          <button className={`side-button ${activeTool === 'proof' ? 'active' : ''}`} onClick={() => chooseTool('proof')} data-testid="nav-proof"><SpellCheck/><span>Proofing</span></button>
          <button className={`side-button ${activeTool === 'scansion' ? 'active' : ''}`} onClick={() => chooseTool('scansion')} data-testid="nav-scansion"><Type/><span>Scansion</span></button>
        </nav>
        <BookShelf
          books={shelfBooks}
          poems={shelfPoems}
          activeBookId={activeBookId}
          activePoemId={activeDraftId}
          onSelectPoem={switchDraft}
          onCreateBook={createBook}
          onCreatePoem={createBrowserDraft}
          onRenameBook={renameBook}
          onMovePoem={movePoem}
          onReorderPoem={reorderPoem}
          onExportBook={openBookExport}
          onEditBookPages={openBookPages}
          onImportBook={beginBookImport}
        />
        <div className="side-foot"><div className="side-note">A quiet place for unfinished things.<br/>Your work stays on this device.</div></div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb"><span>Manuscripts</span><span>/</span><strong>{title || 'Untitled poem'}</strong></div>
          <div className="top-actions">
            <div className="save-state" data-testid="status-save"><span className="save-dot" style={{ background: dirty ? '#c49b64' : undefined }}/>{savedAt}</div>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.html,.htm,.rtf,.docx,.odt,text/plain,text/markdown,text/html,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text" hidden onChange={onFallbackFileChange} data-testid="input-open-poem"/>
            <input ref={bookInputRef} type="file" accept=".poetrybook,application/json,.json" hidden onChange={onBookImportFileChange} data-testid="input-import-book"/>
            <select className="draft-switcher" aria-label="Switch browser draft" value={activeDraftId} onChange={(event) => switchDraft(event.target.value)} data-testid="select-browser-draft">
              {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || 'Untitled poem'}</option>)}
            </select>
            <button className="button ghost" onClick={() => { setDraftToRemoveId(activeDraftId); setModal('remove-draft'); }} title="Remove the selected browser draft" aria-label="Remove selected poem" data-testid="button-remove-draft"><Trash2/><span>Remove</span></button>
            <button className="button ghost" onClick={openHistory} title="View earlier saved versions" data-testid="button-version-history"><History/><span>History</span></button>
            <button className="button ghost" onClick={() => createBrowserDraft()} title="Create a new poem in the current book" aria-label="Create a new poem" data-testid="button-new-draft"><Plus/><span>New poem</span></button>
            <button className="button" onClick={openPoem} title={openedSource ? fileHandleRef.current ? `Currently open: ${openedSource.fileName}` : `Saved source: ${openedSource.fileName}; reopen it to save directly` : 'Open a poem from your device'} data-testid="button-open-poem"><FolderOpen/><span>Open</span></button>
            <button className="button ghost" aria-label="Toggle theme" title="Toggle theme" onClick={() => setIsDark((old) => !old)} data-testid="toggle-theme">{isDark ? <Sun/> : <Moon/>}</button>
            <button className="button" onClick={() => setModal('settings')} data-testid="button-settings"><Settings2/><span>Settings</span></button>
            <button className="button primary" onClick={() => setModal('export')} data-testid="button-export"><Download/><span>Export</span></button>
          </div>
        </header>
        <div className="workspace">
          <section className="editor-column">
            <div className="doc-head">
              <div className="doc-meta">WORKING DRAFT <span style={{ color: '#b5a79a' }}> / </span>{formLabel.toUpperCase()}</div>
              <input ref={titleRef} className="title-input" aria-label="Poem title" value={title} onChange={(event) => onTitleChange(event.target.value)} onBlur={() => persistNow()} data-testid="input-poem-title"/>
            </div>
            <div className="toolbar" role="toolbar" aria-label="Writing tools">
              <div className="tool-group">
                <select className="select-tool" aria-label="Paragraph style" defaultValue="p" onChange={(event) => format('formatBlock', event.target.value)} data-testid="select-paragraph">
                  <option value="p">Paragraph</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="blockquote">Quote</option>
                </select>
                <select className="select-tool font-family-tool" aria-label="Font family" value={toolbarFontFamily} onChange={(event) => applyTextStyle('fontFamily', event.target.value)} data-testid="select-font-family">
                  {fontFamilies.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}
                </select>
                <select className="select-tool" aria-label="Font size" value={toolbarFontSize} onChange={(event) => applyTextStyle('fontSize', `${event.target.value}pt`)} data-testid="select-font-size">
                  {fontSizeOptions.map((size) => <option key={size} value={size}>{size} pt</option>)}
                </select>
              </div>
              <div className="tool-group">
                {toolbarButton('Bold', <b style={{ fontSize: 13 }}>B</b>, () => format('bold'))}
                {toolbarButton('Italic', <Italic/>, () => format('italic'))}
                {toolbarButton('Underline', <Underline/>, () => format('underline'))}
                {toolbarButton('Strikethrough', <Strikethrough/>, () => format('strikeThrough'))}
              </div>
              <div className="tool-group">
                {toolbarButton('Align left', <AlignLeft/>, () => format('justifyLeft'))}
                {toolbarButton('Align center', <AlignCenter/>, () => format('justifyCenter'))}
                {toolbarButton('Align right', <AlignRight/>, () => format('justifyRight'))}
              </div>
              <div className="tool-group">
                {toolbarButton('Bulleted list', <List/>, () => format('insertUnorderedList'))}
                {toolbarButton('Numbered list', <ListOrdered/>, () => format('insertOrderedList'))}
                {toolbarButton('Indent', <Indent/>, () => format('indent'))}
                {toolbarButton('Outdent', <Minus/>, () => format('outdent'))}
                <button className="tool" title="Insert tab stop" aria-label="Insert tab stop" onClick={insertTab} data-testid="tool-tab-stop"><span style={{ font: '10px var(--app-font-mono)' }}>⇥</span></button>
              </div>
              <div className="tool-group">
                {toolbarButton('Undo', <Undo2/>, () => format('undo'))}
                {toolbarButton('Redo', <Redo2/>, () => format('redo'))}
              </div>
            </div>
            <div className="editor-wrap">
              <div ref={paperRef} className="paper">
                {settings.scansion && <div className="scansion-overlay" aria-label="Scansion marks above poem lines">
                  {scansionOverlayItems.map((item) => item.kind === 'syllable'
                    ? <button key={item.id} type="button" className={`scan-syllable scan-${item.symbol === '\\' ? 'partial' : item.symbol === '/' ? 'stressed' : 'light'}`} style={{ left: item.left, top: item.top }} title="Click to cycle: u, /, or \\." aria-label={`Syllable ${item.syllableIndex + 1}: ${item.symbol}. Click to change mark.`} onMouseDown={(event) => event.preventDefault()} onClick={() => cycleScansionMark(item)}>{item.symbol}</button>
                    : <button key={item.id} type="button" className={`scan-foot ${item.active ? 'active' : ''}`} style={{ left: item.left, top: item.top }} title={item.active ? 'Remove foot boundary' : 'Add foot boundary'} aria-label={item.active ? 'Remove foot boundary' : 'Add foot boundary'} onMouseDown={(event) => event.preventDefault()} onClick={() => toggleFootBoundary(item)}>{item.active ? '|' : '·'}</button>)}
                </div>}
                <div
                  ref={editorRef}
                  className={`poem-editor ${settings.scansion ? 'scansion-on' : ''}`}
                  contentEditable
                  suppressContentEditableWarning
                  spellCheck={false}
                  autoCapitalize="off"
                  lang="en"
                  role="textbox"
                  aria-label="Poem manuscript"
                  aria-multiline="true"
                  data-placeholder="Begin with a line…"
                  onInput={onEditorInput}
                  onKeyUp={captureSelection}
                  onMouseUp={captureSelection}
                  onBlur={captureSelection}
                  onKeyDown={(event) => { if (event.key === 'Tab') { event.preventDefault(); insertTab(); } }}
                  style={{ fontSize: `${fontSize}pt`, fontFamily, tabSize: tabStops === '2 spaces' ? 2 : tabStops === '8 spaces' ? 8 : 4 }}
                  data-testid="editor-manuscript"
                />
              </div>
            </div>
            <footer className="editor-footer">
              <div className="count-set"><span><b>{wordCount}</b> words</span><span><b>{lineCount}</b> lines</span></div>
              <span>{settings.scansion ? 'Marks above lines · click to edit' : 'Line breaks preserved'} · local draft</span>
              <button className="button small" onClick={() => void savePoem()} data-testid="button-save"><Save/>{openedSource && !fileHandleRef.current ? 'Download updated copy' : 'Save now'}</button>
            </footer>
          </section>
          <aside className="right-panel">
            <div className="panel-head">
              <div><div className="panel-title">{activeTool === 'rhymes' ? 'Rhyme room' : activeTool === 'forms' ? 'Forms library' : activeTool === 'proof' ? 'Proofing' : activeTool === 'metadata' ? 'Poem metadata' : 'Scansion'}</div><div className="panel-sub">{activeTool === 'rhymes' ? 'Listen for an ending.' : activeTool === 'forms' ? 'Forms, patterns, and example poems.' : activeTool === 'proof' ? 'Suggestions, not rules.' : activeTool === 'metadata' ? 'Notes and submission history.' : 'A light touch on the beat.'}</div></div>
              <button className="button ghost small" title="Panel options" aria-label="Panel options" onClick={() => setModal('settings')}><PanelRight/></button>
            </div>
            {activeTool === 'metadata' && <PoemMetadataPanel
              key={activeDraftId}
              metadata={activePoemMetadata}
              onChange={(metadata) => updatePoemMetadata(activeDraftId, metadata)}
            />}
            {activeTool === 'rhymes' && <div className="panel-card">
              <label className="field-label" htmlFor="rhyme-query">Find a sound</label>
              <div className="search-wrap"><Search/><input id="rhyme-query" className="search-field" placeholder="Type a word or select a line" value={rhymeQuery} onChange={(event) => setRhymeQuery(event.target.value)} data-testid="input-rhyme-search"/></div>
              {query ? <>
                <div className="word-chip">{query}</div>
                {dictionaryError && <div className="notice" role="alert" style={{ margin: '8px 0' }}><CircleHelp/>{dictionaryError}</div>}
                <div className="field-label">Full rhyme</div>
                {rhymeLoading ? <div className="empty-hint">Opening the pronunciation dictionary…</div> : rhymeResults.perfect.length ? rhymeResults.perfect.map((match) => <div className="rhyme-row" key={match.word}><span>{match.word}</span><span className="rhyme-kind">perfect</span></div>) : <div className="empty-hint">No perfect-rhyme match found. Try another word or browse near rhymes.</div>}
                <div className="field-label" style={{ marginTop: 14 }}>Near rhyme</div>
                {rhymeResults.near.length ? rhymeResults.near.slice(0, 7).map((match) => <div className="rhyme-row" key={match.word}><span>{match.word}</span><span className="rhyme-kind">half-rhyme</span></div>) : <div className="empty-hint">No half-rhyme matches found.</div>}
              </> : <div className="empty-hint" style={{ marginTop: 8 }}>Select a word in your poem or enter one above. Rhymes are matched by pronunciation.</div>}
              {selection && <div className="notice" style={{ marginTop: 12 }}><Feather/>Using your selection: “{selection.slice(0, 38)}{selection.length > 38 ? '…' : ''}”</div>}
            </div>}
            {activeTool === 'forms' && <div className="panel-card">
              <div className="form-check-controls">
                <div>
                  <span className="field-label">Intended form</span>
                  <strong>{activePoemMetadata.form || 'Not selected'}</strong>
                </div>
                <button
                  className="button small"
                  type="button"
                  disabled={!intendedForm || isCheckingForm}
                  onClick={() => { if (intendedForm) void checkPoemAgainstForm(intendedForm); }}
                  data-testid="button-check-intended-form"
                >{isCheckingForm ? 'Checking…' : 'Check poem'}</button>
              </div>
              {formCheckError && <div className="notice form-check-error" role="alert">{formCheckError}</div>}
              {activeFormCheck && <FormCheckPanel
                result={activeFormCheck}
                checking={isCheckingForm}
                onRecheck={() => {
                  const form = findPoetryForm(activeFormCheck.formName);
                  if (form) void checkPoemAgainstForm(form);
                }}
              />}
              <label className="field-label" htmlFor="form-search">Browse forms</label>
              <div className="search-wrap"><Search/><input id="form-search" className="search-field" placeholder="Search forms" value={formQuery} onChange={(event) => setFormQuery(event.target.value)} data-testid="input-form-search"/></div>
              <div style={{ marginTop: 8 }}>{filteredForms.map((form) => <div className="form-item" key={form.name}>
                <strong>{form.name}</strong>
                <div className="rhyme-kind" style={{ marginTop: 4 }}>{form.structure}</div>
                <p>{form.description}</p>
                <div className="form-pattern"><b>Pattern:</b> {form.example}</div>
                <a className="form-example-link" href={form.exampleUrl} target="_blank" rel="noreferrer" aria-label={`Read example: ${form.exampleTitle}`}>
                  Example: {form.exampleTitle}
                </a>
                <div className="form-item-actions">
                  <button className="button small" onClick={() => applyForm(form)} data-testid={`button-form-${form.name.toLowerCase().replace(/\s+/g, '-')}`}>Use as reference</button>
                  <button className="button small secondary" type="button" disabled={isCheckingForm} onClick={() => void checkPoemAgainstForm(form)} data-testid={`button-check-form-${form.name.toLowerCase().replace(/\s+/g, '-')}`}>Check poem</button>
                </div>
              </div>)}</div>
            </div>}
            {activeTool === 'proof' && <div className="panel-card">
              <div className="switch-row"><div><div className="switch-title">Proofing suggestions</div><div className="switch-desc">Local checks + browser spellcheck</div></div><button className={`switch ${proofOn ? 'on' : ''}`} role="switch" aria-checked={proofOn} aria-label="Toggle proofing" onClick={() => setProofOn((value) => !value)} data-testid="toggle-proofing"/></div>
              <div className="notice" style={{ margin: '12px 0' }}><CircleHelp/>Red marks come from the built-in English dictionary; poetry, names, and invented words can be added to your personal dictionary. Green marks are suggestions you can ignore.</div>
              {proofOn && <div className="proof-list">
                {grammars.map((item) => <div className="proof-item grammar" key={item.id}>
                  <button className="proof-target" type="button" onClick={() => focusProofSuggestion(item)} aria-label={`Find “${item.match}” in the poem`} data-testid={`button-proof-target-${item.id}`}>
                    <strong>{item.match}</strong><span>Find in poem</span>
                  </button>
                  <p>{item.reason}</p>
                  <div className="proof-actions">
                    {item.fix && <button className="button small" onClick={() => applyProofSuggestion(item)} data-testid="button-grammar-apply">Apply {item.fix}</button>}
                    <button className="button small" onClick={() => { setIgnoredGrammar((current) => current.includes(item.id) ? current : [...current, item.id]); setFocusedProofRange(null); }} data-testid="button-grammar-ignore">Ignore</button>
                  </div>
                </div>)}
                {!grammars.length && <div className="empty-hint">No local grammar suggestions right now. Keep listening to the line.</div>}
                <div className="proof-item"><strong>Add a word to your dictionary</strong><p>Selected word: {selection.split(/\s+/).pop() || 'select a word in the poem'}</p><button className="button small" style={{ marginTop: 7 }} disabled={!selection} onClick={() => addToDictionary(selection.split(/\s+/).pop() || '')} data-testid="button-add-word"><Plus/>Add selected word</button></div>
                {customWords.length > 0 && <div className="proof-item"><strong>Your words · {customWords.length}</strong><p>{customWords.join(' · ')}</p><button className="button small" onClick={() => { setCustomWords([]); setToast('Personal dictionary cleared'); }}>Clear dictionary</button></div>}
              </div>}
              {!proofOn && <div className="empty-hint">Proofing is paused. Browser spellcheck is also off for the workspace.</div>}
            </div>}
            {activeTool === 'scansion' && <div className="panel-card">
              <div className="switch-row"><div><div className="switch-title">Show marks above each line</div><div className="switch-desc">Overlay the stress guide on the poem</div></div><button className={`switch ${settings.scansion ? 'on' : ''}`} role="switch" aria-checked={settings.scansion} aria-label="Toggle scansion guide" onClick={() => setSettings((old) => ({ ...old, scansion: !old.scansion }))} data-testid="toggle-scansion"/></div>
              <div className="notice" style={{ marginTop: 12 }}><Type/>u = weak, \ = possible or secondary stress, / = strong. Click a mark to edit it; click between marks to add or remove a foot boundary.</div>
              <div className="field-label" style={{ marginTop: 16 }}>Line syllable estimates</div>
              {countedLineEntries.slice(0, 9).map(({ line, index }) => {
                const syllableCount = scansionRows[index]?.reduce((total, word) => total + word.marks.length, 0) || lineSyllables(line);
                return <div className="rhyme-row" key={`${index}-${line}`} style={{ alignItems: 'flex-start', gap: 8 }}><span style={{ font: '12px var(--app-font-serif)', flex: 1 }}>{line.slice(0, 34)}{line.length > 34 ? '…' : ''}</span><span className="rhyme-kind">{syllableCount} syl.</span></div>;
              })}
              <div className="field-label" style={{ marginTop: 18 }}>English meter estimates · Calliope-inspired</div>
              <div className="meter-estimate-note" data-testid="meter-estimate-note">
                <a href="https://github.com/AlekseyCalvin/Calliope-TS" target="_blank" rel="noreferrer">Calliope-TS</a>-inspired, browser-only prototype. It compares dictionary stress with common feet, but does not yet analyze syntax or full phrase stress. Fit and confidence are rough guides, not probabilities.
              </div>
              {countedLineEntries.slice(0, 9).map(({ line, index }) => {
                const analysis = meterAnalyses[index];
                const best = analysis?.best;
                return <div className="meter-estimate-card" key={`meter-${index}-${line}`} data-testid={`meter-estimate-line-${index + 1}`}>
                  <div className="meter-estimate-title">
                    <span>Line {index + 1}</span>
                    <strong>{best?.name ?? 'No clear regular meter'}</strong>
                  </div>
                  {best
                    ? <div className="meter-estimate-detail"><span>{best.fit}% fit</span><span>{best.confidence}% rough confidence</span></div>
                    : analysis?.alternatives[0] && <div className="meter-estimate-detail"><span>Closest fit: {analysis.alternatives[0].name}</span><span>{analysis.alternatives[0].fit}%</span></div>}
                  {best?.scansion && <div className="meter-estimate-pattern" aria-label={`Stress pattern ${best.scansion}`}>{best.scansion}</div>}
                  {analysis?.estimated && <div className="meter-estimate-caveat">Some word stresses are estimated.</div>}
                  {best && analysis?.alternatives.length > 0 && <div className="meter-estimate-caveat">Also possible: {analysis.alternatives.slice(0, 2).map((candidate) => candidate.name).join(' · ')}</div>}
                  {!analysis && <div className="meter-estimate-caveat">Analyzing locally…</div>}
                </div>;
              })}
            </div>}
            <div className="panel-card">
              <div className="field-label">Studio switches</div>
              <div className="switch-row"><div><div className="switch-title">Show scansion marks</div><div className="switch-desc">A loose reading guide beneath the poem</div></div><button className={`switch ${settings.scansion ? 'on' : ''}`} role="switch" aria-checked={settings.scansion} aria-label="Show scansion marks" onClick={() => setSettings((old) => ({ ...old, scansion: !old.scansion }))} data-testid="toggle-inline-scansion"/></div>
              <div className="switch-row"><div><div className="switch-title">Proofing layer</div><div className="switch-desc">Green notes are optional suggestions</div></div><button className={`switch ${proofOn ? 'on' : ''}`} role="switch" aria-checked={proofOn} aria-label="Show proofing layer" onClick={() => setProofOn((old) => !old)} data-testid="toggle-inline-proof"/></div>
            </div>
            <div className="panel-sub" style={{ padding: '0 3px', display: 'flex', justifyContent: 'space-between' }}><span>CMU PRONUNCIATION DICTIONARY</span><a href={`${import.meta.env.BASE_URL}cmudict-LICENSE.txt`} target="_blank" rel="noreferrer">135k entries · license</a></div>
          </aside>
        </div>
      </main>
      {modal && <div className="overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}>
          <div className={`dialog ${modal === 'history' ? 'history-dialog' : ''} ${modal === 'book-pages' ? 'book-pages-dialog' : ''}`} role={modal === 'remove-draft' ? 'alertdialog' : 'dialog'} aria-modal="true" aria-labelledby="dialog-title">
          <div className="dialog-head"><div><h2 id="dialog-title">{modal === 'export' ? 'Take the poem with you' : modal === 'history' ? 'Earlier versions' : modal === 'book-export' ? `Export ${bookToExport?.title || 'book'}` : modal === 'book-pages' ? `Pages in ${bookToEditPages?.title || 'book'}` : modal === 'remove-draft' ? 'Remove this poem?' : 'Studio settings'}</h2><p>{modal === 'export' ? 'Choose a simple, portable format.' : modal === 'history' ? 'Preview and restore a saved title and manuscript.' : modal === 'book-export' ? 'Download a reading copy or a reusable Poetry Studio book file.' : modal === 'book-pages' ? 'Add and edit front matter, optional pages, and back matter for the printed book.' : modal === 'remove-draft' ? 'This removes the browser draft and its saved versions from this device.' : 'Tune the page to your way of working.'}</p></div><button className="modal-x" onClick={() => setModal(null)} aria-label="Close dialog"><X/></button></div>
          {modal === 'remove-draft' ? <><div className="panel-card"><p style={{ margin: 0 }}>Remove <strong>{drafts.find((draft) => draft.id === draftToRemoveId)?.title || 'Untitled poem'}</strong>? This cannot be undone.</p></div><div className="dialog-foot"><button className="button" onClick={() => { setDraftToRemoveId(''); setModal(null); }} data-testid="button-cancel-remove-draft">Keep poem</button><button className="button primary" onClick={removeDraft} data-testid="button-confirm-remove-draft"><Trash2/>Remove poem</button></div></> :
          modal === 'book-pages' ? <>{bookToEditPages ? <BookPagesEditor
              book={bookToEditPages}
              onAddPage={(type) => addBookPage(bookToEditPages.id, type)}
              onUpdatePage={(pageId, changes) => updateBookPage(bookToEditPages.id, pageId, changes)}
              onMovePage={(pageId, direction) => moveBookPage(bookToEditPages.id, pageId, direction)}
              onRemovePage={(pageId) => removeBookPage(bookToEditPages.id, pageId)}
            /> : <div className="panel-card"><p>This book is no longer available.</p></div>}<div className="dialog-foot"><button className="button primary" onClick={() => setModal(null)}>Done</button></div></> :
          modal === 'book-export' ? <><div className="panel-card">
              <div className="form-item" style={{ border: 0, paddingTop: 0 }}><strong>Download as PDF</strong><p>Includes a contents page, your added book pages, and blank pages where needed to place recto or verso sections correctly. The first poem begins on a right-hand page; each poem starts on a fresh page.</p>{renderPdfExportOptions()}<button className="button primary" style={{ marginTop: 10 }} onClick={exportBookAsPdf} data-testid="button-download-book-pdf"><Download/>Download book PDF</button></div>
              <div className="form-item"><strong>Export book file</strong><p>Save a .poetrybook copy you can import later, including poems, book pages, and supported styling.</p><button className="button" style={{ marginTop: 10 }} onClick={exportBookArchive} data-testid="button-export-book-file"><Download/>Export .poetrybook</button></div>
            </div><div className="dialog-foot"><button className="button" onClick={() => setModal(null)}>Done</button></div></> :
          modal === 'history' ? <><div className="history-layout">
              <div className="history-list" aria-label="Saved versions">
                {revisionHistory.length ? revisionHistory.map((revision) => <button
                  key={revision.id}
                  type="button"
                  className={`history-item ${selectedRevision?.id === revision.id ? 'selected' : ''}`}
                  onClick={() => setSelectedRevisionId(revision.id)}
                  aria-pressed={selectedRevision?.id === revision.id}
                  data-testid={`button-version-${revision.id}`}
                ><strong>{revision.title || 'Untitled poem'}</strong><span>{new Date(revision.createdAt).toLocaleString()}</span></button>) : <div className="empty-hint">No saved versions yet.</div>}
              </div>
              <div className="history-details">
                <section className="history-comparison" aria-label="Compare saved versions">
                  <div className="field-label">Compare two versions</div>
                  {revisionHistory.length > 1 ? <>
                    <div className="history-compare-selects">
                      {[0, 1].map((slot) => <label className="history-compare-select" key={slot}>
                        <span className="field-label">Version {slot + 1}</span>
                        <select
                          className="text-field"
                          value={comparisonRevisionIds[slot]}
                          onChange={(event) => setComparisonRevisionIds((previous) => {
                            const next: [string, string] = [...previous];
                            next[slot] = event.target.value;
                            return next;
                          })}
                          aria-label={`Compare version ${slot + 1}`}
                          data-testid={`select-version-compare-${slot + 1}`}
                        >
                          {revisionHistory.map((revision) => <option
                            key={revision.id}
                            value={revision.id}
                            disabled={revision.id === comparisonRevisionIds[1 - slot]}
                          >{revision.title || 'Untitled poem'} · {new Date(revision.createdAt).toLocaleString()}</option>)}
                        </select>
                      </label>)}
                    </div>
                    {comparisonRevisions[0] && comparisonRevisions[1] ? <>
                      <p className="history-diff-summary" role="status" data-testid="version-comparison-summary">
                        {comparisonTitlesMatch ? 'Titles match' : 'Titles differ'} · {comparisonManuscriptsMatch ? 'Manuscripts match' : 'Manuscripts differ'}
                      </p>
                      <div className="history-compare-panes">
                        {comparisonRevisions.map((revision, slot) => <section className="history-compare-pane" key={revision!.id} aria-label={`Version ${slot + 1} comparison`}>
                          <div className="field-label">Version {slot + 1} · {new Date(revision!.createdAt).toLocaleString()}</div>
                          <h3 className={!comparisonTitlesMatch ? 'changed' : ''}>{revision!.title || 'Untitled poem'}</h3>
                          <div className="history-manuscript-label field-label">Manuscript</div>
                          <p className="history-word-change-count" data-testid={`version-comparison-word-count-${slot + 1}`}>
                            {comparisonChangedWordCounts[slot]} {comparisonChangedWordCounts[slot] === 1 ? 'word' : 'words'} changed
                          </p>
                          <div className="history-change-navigation" role="group" aria-label={`Changed lines in version ${slot + 1}`}>
                            <button
                              className="button"
                              type="button"
                              onClick={() => navigateComparisonChange(slot, -1)}
                              disabled={!comparisonChangedLineIndices[slot].length}
                              aria-label={`Previous change in version ${slot + 1}`}
                              aria-controls={`version-comparison-manuscript-${slot + 1}`}
                              data-testid={`button-previous-change-${slot + 1}`}
                            >Previous</button>
                            <span aria-live="polite" data-testid={`version-comparison-change-position-${slot + 1}`}>
                              {activeComparisonChangeIndices[slot] === null
                                ? `${comparisonChangedLineIndices[slot].length} ${comparisonChangedLineIndices[slot].length === 1 ? 'change' : 'changes'}`
                                : `Change ${comparisonChangedLineIndices[slot].indexOf(activeComparisonChangeIndices[slot]) + 1} of ${comparisonChangedLineIndices[slot].length}`}
                            </span>
                            <button
                              className="button"
                              type="button"
                              onClick={() => navigateComparisonChange(slot, 1)}
                              disabled={!comparisonChangedLineIndices[slot].length}
                              aria-label={`Next change in version ${slot + 1}`}
                              aria-controls={`version-comparison-manuscript-${slot + 1}`}
                              data-testid={`button-next-change-${slot + 1}`}
                            >Next</button>
                          </div>
                          <pre
                            className="history-diff-lines"
                            id={`version-comparison-manuscript-${slot + 1}`}
                            ref={(element) => { comparisonManuscriptRefs.current[slot] = element; }}
                            data-testid={`version-comparison-manuscript-${slot + 1}`}
                          >
                            {alignedComparisonLines[slot].map((line, lineIndex) => <span
                              className={`history-diff-line ${line.changed ? 'changed' : ''} ${activeComparisonChangeIndices[slot] === lineIndex ? 'active-change' : ''}`}
                              key={`${line.lineNumber}-${lineIndex}`}
                              data-change-index={line.changed ? lineIndex : undefined}
                              aria-current={activeComparisonChangeIndices[slot] === lineIndex ? 'location' : undefined}
                            ><span className="history-line-number">{line.lineNumber}</span><span>{line.text
                              ? comparisonWordDiffs[slot][lineIndex].map((segment, segmentIndex) => segment.isWord
                                ? <mark className={`history-diff-word ${segment.changed ? 'changed' : ''}`} key={segmentIndex}>{segment.text}</mark>
                                : <span key={segmentIndex}>{segment.text}</span>)
                              : '\u00a0'}</span></span>)}
                            {!comparisonTexts[slot] && <span className="history-empty">This version has no manuscript text.</span>}
                          </pre>
                        </section>)}
                      </div>
                    </> : <div className="empty-hint">Choose two different saved versions to compare.</div>}
                  </> : <div className="empty-hint">Save at least two versions to compare their titles and manuscripts.</div>}
                </section>
                {selectedRevision && <section className="history-preview" aria-label="Selected version preview">
                  <div className="field-label">Selected for restore · {new Date(selectedRevision.createdAt).toLocaleString()}</div>
                  <h3>{selectedRevision.title || 'Untitled poem'}</h3>
                  <pre>{cleanText(selectedRevision.editorHtml) || 'This version has no manuscript text.'}</pre>
                </section>}
              </div>
            </div><div className="dialog-foot"><button className="button" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!selectedRevision} onClick={restoreRevision} data-testid="button-restore-version"><History/>Restore this version</button></div></> :
          modal === 'export' ? <><div className="panel-card"><div className="form-item" style={{ border: 0, paddingTop: 0 }}><strong>Plain text</strong><p>Preserves the line breaks, ready for any text editor.</p><button className="button primary" style={{ marginTop: 10 }} onClick={() => exportPoem('txt')} data-testid="button-export-txt"><Download/>Export .txt</button></div><div className="form-item"><strong>PDF</strong><p>Choose a paper size and margins for a fixed-layout copy.</p>{renderPdfExportOptions()}<button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('pdf')} data-testid="button-export-pdf"><Download/>Export .pdf</button></div><div className="form-item"><strong>HTML document</strong><p>A clean document with your title and stanza breaks.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('html')} data-testid="button-export-html"><Download/>Export .html</button></div><div className="form-item"><strong>Word document</strong><p>A formatted document you can open in Microsoft Word and other word processors.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('docx')} data-testid="button-export-docx"><Download/>Export .docx</button></div><div className="form-item"><strong>Rich text</strong><p>A widely compatible document format for word processors.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('rtf')} data-testid="button-export-rtf"><Download/>Export .rtf</button></div><div className="form-item"><strong>OpenDocument text</strong><p>An editable document format for LibreOffice and other compatible apps.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('odt')} data-testid="button-export-odt"><Download/>Export .odt</button></div></div><div className="panel-sub">Your manuscript is stored locally in this browser. Export a copy before clearing browser data.</div></> :
            <><div className="form-grid">
              <label><span className="field-label">Tab stop</span><select className="text-field" value={tabStops} onChange={(event) => setTabStops(event.target.value)} data-testid="select-tab-stops"><option>2 spaces</option><option>4 spaces</option><option>8 spaces</option></select></label>
              <label><span className="field-label">Default text size</span><select className="text-field" value={fontSize} onChange={(event) => { const nextSize = Number(event.target.value); setFontSize(nextSize); setToolbarFontSize(nextSize); }} data-testid="settings-font-size">{fontSizeOptions.map((size) => <option key={size} value={size}>{size} pt</option>)}</select></label>
              <label><span className="field-label">Default font</span><select className="text-field" value={fontFamily} onChange={(event) => { const nextFont = fontFamilies.find((font) => font.value === event.target.value)?.value; if (nextFont) { setFontFamily(nextFont); setToolbarFontFamily(nextFont); } }} data-testid="settings-font-family">{fontFamilies.map((font) => <option key={font.value} value={font.value}>{font.label}</option>)}</select></label>
              <label><span className="field-label">Theme</span><button className="button" onClick={() => setIsDark((old) => !old)}>{isDark ? <Sun/> : <Moon/>}{isDark ? 'Paper light' : 'Deep green'}</button></label>
              <label><span className="field-label">Personal dictionary</span><button className="button" onClick={() => { setCustomWords([]); setToast('Personal dictionary cleared'); }}>{customWords.length} words · clear</button></label>
            </div><div className="dialog-foot"><button className="button primary" onClick={() => setModal(null)} data-testid="button-settings-done"><Check/>Done</button></div></>}
        </div>
      </div>}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

export default App;
