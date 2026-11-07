import { type ChangeEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlignCenter, AlignLeft, AlignRight, BookOpen, Check, CircleHelp,
  Download, Feather, FileText, FolderOpen, History, Indent, Italic, List, ListOrdered,
  Minus, Moon, PanelRight, Plus, Redo2, Search,
  Save, Settings2, SpellCheck, Strikethrough, Sun, Type, Underline, Undo2, X,
} from 'lucide-react';
import { findRhymes, findSpellingErrors, scanLineWords, type RhymeMatch, type ScannedWord } from './lib/phonetics';
import { layoutScansionOverlay, type ScanLineEdit, type ScanSymbol, type ScansionOverlayItem } from './lib/scansion-layout';
import {
  choosePoemFile, downloadPoemFile, isWritablePoemFileFormat, poemTextToEditorHtml, readPoemFile, serializePoemPdf,
  appendBrowserPoemRevision, isBrowserPoemDraft, isBrowserPoemRevision, isSavedPoemSource, restoreBrowserPoemDraft, serializePoem, writePoemFile,
  type BrowserPoemDraft, type BrowserPoemRevision, type PoemFileFormat, type WritablePoemFileFormat, type WritablePoemFileHandle,
} from './lib/poem-files';

type Tool = 'rhymes' | 'forms' | 'proof' | 'scansion';
type FormEntry = { name: string; structure: string; description: string; example: string };

const starter = `<p>At first light, the harbor keeps its blue</p><p>like a secret folded into glass.</p><p>The gulls unthread the quiet, one by one;</p><p>the tide turns over what the night let pass.</p><p><br></p><p>I write the names of rain along the sill,</p><p>then watch the letters loosen into air.</p><p>Some things are held by learning to be still.</p><p>Some things are gone, and still are everywhere.</p>`;
const forms: FormEntry[] = [
  { name: 'Sonnet', structure: '14 lines · iambic pentameter', description: 'A tightly turned lyric argument. Shakespearean sonnets close with a rhyming couplet; Petrarchan sonnets pivot at the octave.', example: 'ABAB CDCD EFEF GG' },
  { name: 'Haiku', structure: '3 lines · 5 / 7 / 5 syllables', description: 'A brief image or moment, traditionally attentive to season and the natural world. English syllable counts are an approximation.', example: 'short / long / short' },
  { name: 'Villanelle', structure: '19 lines · 5 tercets + quatrain', description: 'Two refrains circle through five tercets before meeting in a final quatrain.', example: 'ABA · ABA · ABA · ABA · ABA · ABAA' },
  { name: 'Sestina', structure: '39 lines · 6 stanzas + envoy', description: 'Six end-words rotate through six six-line stanzas, then gather in a three-line envoy.', example: 'six repeating end-words' },
  { name: 'Ghazal', structure: 'couplets · refrain + rhyme', description: 'Self-contained couplets linked by a repeating refrain and a shared rhyme before it.', example: 'AA · BA · CA · DA …' },
  { name: 'Ode', structure: 'variable · elevated address', description: 'A sustained meditation addressed to a person, object, or idea. Shape the stanzas to the movement of thought.', example: 'stanza pattern of your choosing' },
  { name: 'Blank verse', structure: 'unrhymed iambic pentameter', description: 'Five-beat lines without end rhyme; the steady pulse leaves room for speech-like variation.', example: '10-ish syllables per line' },
  { name: 'Limerick', structure: '5 lines · AABBA', description: 'A compact, often comic form with longer first, second, and fifth lines and shorter third and fourth.', example: 'AABBA' },
  { name: 'Tanka', structure: '5 lines · 5 / 7 / 5 / 7 / 7 syllables', description: 'A short lyric that extends the haiku shape with two longer lines; English syllable counts are approximate.', example: 'short / long / short / long / long' },
  { name: 'Pantoum', structure: 'interlocking quatrains', description: 'Lines two and four of each stanza return as lines one and three of the next, creating a recursive movement.', example: 'ABAB · BCBC · CDCD …' },
  { name: 'Terza rima', structure: 'three-line stanzas · ABA BCB CDC', description: 'Interlocking tercets carry one rhyme into the next stanza, often ending with a closing couplet.', example: 'ABA · BCB · CDC · D' },
  { name: 'Ballad', structure: 'quatrains · alternating 4 / 3 stresses', description: 'A song-like narrative form, often using alternating four- and three-beat lines and an ABCB rhyme scheme.', example: 'ABCB · DEFE' },
  { name: 'Rondeau', structure: '15 lines · two rhymes + refrain', description: 'Three stanzas share two rhymes, with the opening phrase returning as a refrain at the ends of the final stanzas.', example: 'AABBA · AABR · AABBAR' },
  { name: 'Triolet', structure: '8 lines · two rhymes + repeated lines', description: 'An eight-line form built from two rhymes and a pair of lines that return in a fixed pattern.', example: 'ABaAabAB' },
  { name: 'Cinquain', structure: '5 lines · syllabic or word-count patterns', description: 'A concise five-line form with several modern patterns; one common American version counts 2 / 4 / 6 / 8 / 2 syllables.', example: '2 · 4 · 6 · 8 · 2' },
  { name: 'Elegy', structure: 'variable · lament and remembrance', description: 'A poem of loss that may move through grief, praise, and consolation without requiring a fixed meter or rhyme scheme.', example: 'lament · remembrance · turn' },
  { name: 'Epigram', structure: 'brief · pointed turn', description: 'A compact poem that resolves in a witty, surprising, or sharply compressed final thought.', example: 'setup · turn' },
  { name: 'Acrostic', structure: 'lines spell a word or phrase', description: 'The first, middle, or last letters of successive lines form a name, message, or key word.', example: 'initial letters read downward' },
  { name: 'Free verse', structure: 'open form · no fixed scheme', description: 'Line, breath, image, and sound make the architecture. Repetition can supply a pulse without a meter.', example: 'follow the music of the sentence' },
];
const initialSettings = { proof: true, scansion: false, forms: false, dark: false, fontSize: 19, tab: '4 spaces' };

function readStorage<T>(key: string, fallback: T): T {
  try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; }
}
function readSavedPoemSource() {
  const source = readStorage<unknown>('poetry-studio-source', null);
  return isSavedPoemSource(source) ? source : null;
}
const draftsStorageKey = 'poetry-studio-drafts';
const activeDraftStorageKey = 'poetry-studio-active-draft';
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
function loadBrowserDraftStore() {
  const savedDrafts = readStorage<unknown>(draftsStorageKey, null);
  const drafts = Array.isArray(savedDrafts) ? savedDrafts.filter(isBrowserPoemDraft) : [];
  if (drafts.length) {
    const savedActiveId = readStorage<string>(activeDraftStorageKey, '');
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
  };
  return { drafts: [migratedDraft], activeDraftId: migratedDraft.id };
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
function wordsOf(text: string): string[] { return text.trim().match(/\b[\w’'-]+\b/g) ?? []; }
function lineSyllables(text: string) { return wordsOf(text).reduce((total, word) => total + syllables(word), 0); }
function syllables(word: string) {
  const clean = word.toLowerCase().replace(/[^a-z]/g, '');
  if (!clean) return 0;
  if (clean.length <= 3) return 1;
  const groups = clean.replace(/(?:[^laeiouy]e|ed|es)$/i, '').match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length || 1);
}
function findGrammar(text: string) {
  const suggestions: { match: string; fix: string; reason: string }[] = [];
  for (const match of text.matchAll(/\b(the|a|an)\s+\1\b/gi)) {
    suggestions.push({ match: match[0], fix: match[0].split(/\s+/)[0], reason: 'A repeated article may be accidental.' });
  }
  for (const match of text.matchAll(/\byour welcome\b/gi)) {
    suggestions.push({ match: match[0], fix: match[0].replace(/^your/i, 'You’re'), reason: '“You’re welcome” uses the contraction for “you are.”' });
  }
  for (const match of text.matchAll(/\b(it|that|there) is\b/gi)) {
    const contraction = match[0].replace(/\s+is$/i, '’s');
    suggestions.push({ match: match[0], fix: contraction, reason: `Consider the contraction ${contraction}.` });
  }
  for (const match of text.matchAll(/\b(could|should|would|might|must) of\b/gi)) {
    suggestions.push({ match: match[0], fix: match[0].replace(/\s+of$/i, ' have'), reason: 'After a modal verb, use “have” rather than “of.”' });
  }
  for (const match of text.matchAll(/\b(\w+)\s+\1\b/gi)) {
    suggestions.push({ match: match[0], fix: match[1], reason: 'A repeated word may be accidental.' });
  }
  return suggestions;
}

function App() {
  const [initialDraftStore] = useState(loadBrowserDraftStore);
  const [drafts, setDrafts] = useState(initialDraftStore.drafts);
  const draftsRef = useRef(drafts);
  const [activeDraftId, setActiveDraftId] = useState(initialDraftStore.activeDraftId);
  const [revisionHistory, setRevisionHistory] = useState(() => readPoemRevisions(initialDraftStore.activeDraftId));
  const [selectedRevisionId, setSelectedRevisionId] = useState('');
  const [openedSource, setOpenedSource] = useState(() => initialDraftStore.drafts.find((draft) => draft.id === initialDraftStore.activeDraftId)?.source ?? null);
  const editorRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileHandleRef = useRef<WritablePoemFileHandle | null>(null);
  const fileHandlesRef = useRef(new Map<string, WritablePoemFileHandle>());
  const savedHtml = useRef('');
  const saveTimer = useRef<number | undefined>(undefined);
  const titleTimer = useRef<number | undefined>(undefined);
  const [title, setTitle] = useState(() => initialDraftStore.drafts.find((draft) => draft.id === initialDraftStore.activeDraftId)?.title ?? 'The harbor at first light');
  const [html, setHtml] = useState(() => initialDraftStore.drafts.find((draft) => draft.id === initialDraftStore.activeDraftId)?.editorHtml ?? starter);
  const [settings, setSettings] = useState(() => readStorage('poetry-studio-settings', initialSettings));
  const [customWords, setCustomWords] = useState<string[]>(() => readStorage('poetry-studio-dictionary', []));
  const [activeTool, setActiveTool] = useState<Tool>('rhymes');
  const [selection, setSelection] = useState('');
  const [rhymeQuery, setRhymeQuery] = useState('');
  const [rhymeResults, setRhymeResults] = useState<{ perfect: RhymeMatch[]; near: RhymeMatch[] }>({ perfect: [], near: [] });
  const [rhymeLoading, setRhymeLoading] = useState(false);
  const [dictionaryError, setDictionaryError] = useState('');
  const [formQuery, setFormQuery] = useState('');
  const [proofOn, setProofOn] = useState(settings.proof);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [modal, setModal] = useState<'export' | 'settings' | 'history' | null>(null);
  const [toast, setToast] = useState('');
  const [savedAt, setSavedAt] = useState(() => openedSource ? 'Draft restored · updated copy available' : 'All changes saved');
  const [dirty, setDirty] = useState(false);
  const [isDark, setIsDark] = useState(settings.dark);
  const [tabStops, setTabStops] = useState(settings.tab);
  const [fontSize, setFontSize] = useState(settings.fontSize);
  const [formLabel, setFormLabel] = useState('Free verse');
  const [ignoredGrammar, setIgnoredGrammar] = useState<string[]>([]);
  const [scansionRows, setScansionRows] = useState<ScannedWord[][]>([]);
  const [scansionOverlayItems, setScansionOverlayItems] = useState<ScansionOverlayItem[]>([]);
  const [scanEdits, setScanEdits] = useState<Record<string, ScanLineEdit>>(() => readStorage('poetry-studio-scansion', {}));
  const [spellingErrors, setSpellingErrors] = useState<string[]>([]);

  useEffect(() => {
    if (editorRef.current) { editorRef.current.innerHTML = html; savedHtml.current = html; }
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    localStorage.setItem('poetry-studio-settings', JSON.stringify({ ...settings, dark: isDark, proof: proofOn, tab: tabStops, fontSize }));
  }, [isDark, proofOn, settings, tabStops, fontSize]);
  useEffect(() => { localStorage.setItem('poetry-studio-dictionary', JSON.stringify(customWords)); }, [customWords]);
  useEffect(() => {
    localStorage.setItem(draftsStorageKey, JSON.stringify(drafts));
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(() => { localStorage.setItem(activeDraftStorageKey, JSON.stringify(activeDraftId)); }, [activeDraftId]);
  useEffect(() => {
    if (toast) { const timeout = window.setTimeout(() => setToast(''), 2600); return () => window.clearTimeout(timeout); }
    return undefined;
  }, [toast]);

  const text = useMemo(() => cleanText(html), [html]);
  const wordCount = wordsOf(text).length;
  const lines = text.split(/\n/).filter((line) => line.trim());
  const lineCount = lines.length;
  const scanTextLines = text.split('\n');
  const countedLineEntries = scanTextLines.map((line, index) => ({ line, index })).filter(({ line }) => line.trim());
  const query = (rhymeQuery || selection.split(/\s+/).filter(Boolean).pop() || '').replace(/[^\p{L}'-]/gu, '');
  const grammars = useMemo(() => findGrammar(text).filter((item) => !dismissed.includes(item.match) && !ignoredGrammar.includes(item.match)), [text, dismissed, ignoredGrammar]);
  const filteredForms = forms.filter((form) => `${form.name} ${form.structure} ${form.description}`.toLowerCase().includes(formQuery.toLowerCase()));

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
      return () => { current = false; };
    }
    Promise.all(text.split('\n').map((line) => scanLineWords(line)))
      .then((rows) => {
        if (current) setScansionRows(rows);
      })
      .catch(() => {
        if (current) setScansionRows([]);
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

  const rangesForPattern = (pattern: RegExp) => {
      const ranges: Range[] = [];
      const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        if (!node.textContent) continue;
        pattern.lastIndex = 0;
        for (const match of node.textContent.matchAll(pattern)) {
          if (match.index === undefined || !match[0]) continue;
          const range = document.createRange();
          range.setStart(node, match.index);
          range.setEnd(node, match.index + match[0].length);
          ranges.push(range);
        }
      }
      return ranges;
    };

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
    const grammarMatches = grammars.map((item) => item.match).filter((match) => match.length > 1);
    const grammarRanges = grammarMatches.length
      ? rangesForPattern(new RegExp(`(?:${grammarMatches.map((match) => match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi'))
      : [];

    registry.set('poetry-spelling', new HighlightConstructor(...spellingRanges));
    registry.set('poetry-grammar', new HighlightConstructor(...grammarRanges));
    return () => {
      registry.delete('poetry-spelling');
      registry.delete('poetry-grammar');
    };
  }, [html, spellingErrors, grammars, proofOn]);

  const persistDraftList = useCallback((nextDrafts: BrowserPoemDraft[]) => {
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    localStorage.setItem(draftsStorageKey, JSON.stringify(nextDrafts));
  }, []);

  const updateDraft = useCallback((draftId: string, changes: Partial<Omit<BrowserPoemDraft, 'id'>>) => {
    const nextDrafts = draftsRef.current.map((draft) => draft.id === draftId ? { ...draft, ...changes } : draft);
    persistDraftList(nextDrafts);
  }, [persistDraftList]);

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
    fileHandleRef.current = fileHandlesRef.current.get(draft.id) ?? null;
    setActiveDraftId(draft.id);
    localStorage.setItem(activeDraftStorageKey, JSON.stringify(draft.id));
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
  }, []);

  const persistNow = useCallback((nextHtml = editorRef.current?.innerHTML ?? html) => {
    window.clearTimeout(saveTimer.current);
    window.clearTimeout(titleTimer.current);
    const currentTitle = titleRef.current?.value || title;
    updateDraft(activeDraftId, {
      title: currentTitle,
      editorHtml: nextHtml,
      source: openedSource,
    });
    saveRevision(activeDraftId, currentTitle, nextHtml);
    savedHtml.current = nextHtml;
    setHtml(nextHtml);
    setDirty(false);
    setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  }, [activeDraftId, html, openedSource, saveRevision, title, updateDraft]);

  const openHistory = useCallback(() => {
    persistNow();
    const history = readPoemRevisions(activeDraftId);
    setRevisionHistory(history);
    setSelectedRevisionId(history[0]?.id ?? '');
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

  const createBrowserDraft = useCallback(() => {
    persistNow();
    const draft: BrowserPoemDraft = {
      id: createDraftId(),
      title: 'Untitled poem',
      editorHtml: '<p><br></p>',
      source: null,
    };
    persistDraftList([...draftsRef.current, draft]);
    activateDraft(draft);
    setSavedAt('New browser draft');
    setToast('New browser draft created');
  }, [activateDraft, persistDraftList, persistNow]);

  const applyOpenedPoem = useCallback((poem: { title: string; text: string; editorHtml?: string; fileName: string; format: PoemFileFormat }, handle: WritablePoemFileHandle | null) => {
    persistNow();
    const nextHtml = poem.editorHtml ?? poemTextToEditorHtml(poem.text);
    const writableFormat = isWritablePoemFileFormat(poem.format) ? poem.format : null;
    const source = writableFormat ? { fileName: poem.fileName, format: writableFormat } : null;
    const draft: BrowserPoemDraft = { id: createDraftId(), title: poem.title, editorHtml: nextHtml, source };
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
  }, [activateDraft, persistDraftList, persistNow]);

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
    persistNow(currentHtml);
    setToast('Draft saved in this browser');
  }, [html, openedSource, persistNow, title]);

  const onEditorInput = useCallback(() => {
    const next = editorRef.current?.innerHTML || '';
    setHtml(next); setDirty(true); setSavedAt('Saving…');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const currentTitle = titleRef.current?.value || title;
      updateDraft(activeDraftId, {
        title: currentTitle,
        editorHtml: next,
        source: openedSource,
      });
      saveRevision(activeDraftId, currentTitle, next);
      savedHtml.current = next; setDirty(false);
      setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }, 550);
  }, [activeDraftId, openedSource, saveRevision, title, updateDraft]);

  const onTitleChange = useCallback((nextTitle: string) => {
    setTitle(nextTitle);
    setDirty(true);
    setSavedAt('Saving…');
    window.clearTimeout(titleTimer.current);
    titleTimer.current = window.setTimeout(() => {
      const currentHtml = editorRef.current?.innerHTML ?? html;
      updateDraft(activeDraftId, { title: nextTitle, editorHtml: currentHtml, source: openedSource });
      saveRevision(activeDraftId, nextTitle, currentHtml);
      setDirty(false);
      setSavedAt(`Saved ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
    }, 550);
  }, [activeDraftId, html, openedSource, saveRevision, updateDraft]);

  const captureSelection = useCallback(() => {
    const selected = window.getSelection()?.toString().trim() || '';
    if (selected) { setSelection(selected); setRhymeQuery(selected.split(/\s+/).pop()?.replace(/[^\p{L}'-]/gu, '') || ''); }
  }, []);
  const format = useCallback((command: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
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
    const content = kind === 'pdf' ? serializePoemPdf(title, text) : serializePoem(title, text, kind, html);
    const fileName = `${title.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'poem'}.${kind}`;
    downloadPoemFile(fileName, content, kind);
    setModal(null); setToast(`Poem exported as ${kind.toUpperCase()}`);
  };
  const applyForm = (form: FormEntry) => {
    setFormLabel(form.name); setModal(null); setToast(`${form.name} reference loaded`);
  };
  const insertTab = () => {
    editorRef.current?.focus();
    document.execCommand('insertText', false, tabStops === '2 spaces' ? '  ' : tabStops === '8 spaces' ? '        ' : '    ');
    onEditorInput();
  };

  const toolbarButton = (label: string, icon: ReactNode, action: () => void, selected = false) => (
    <button className={`tool ${selected ? 'selected' : ''}`} title={label} aria-label={label} data-testid={`tool-${label.toLowerCase().replace(/\s+/g, '-')}`} onMouseDown={(event) => event.preventDefault()} onClick={action}>{icon}</button>
  );
  const selectedRevision = revisionHistory.find((revision) => revision.id === selectedRevisionId) ?? revisionHistory[0];

  return (
    <div className={`studio ${isDark ? 'dark' : ''}`}>
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">p</div><div><div className="brand-name">Poetry Studio</div><div className="brand-kicker">a room for the line</div></div></div>
        <div className="side-label">Your desk</div>
        <nav aria-label="Studio tools">
          <button className={`side-button ${activeTool === 'rhymes' ? 'active' : ''}`} onClick={() => chooseTool('rhymes')} data-testid="nav-rhymes"><Feather/><span>Rhyme room</span></button>
          <button className={`side-button ${activeTool === 'forms' ? 'active' : ''}`} onClick={() => chooseTool('forms')} data-testid="nav-forms"><BookOpen/><span>Forms library</span></button>
          <button className={`side-button ${activeTool === 'proof' ? 'active' : ''}`} onClick={() => chooseTool('proof')} data-testid="nav-proof"><SpellCheck/><span>Proofing</span></button>
          <button className={`side-button ${activeTool === 'scansion' ? 'active' : ''}`} onClick={() => chooseTool('scansion')} data-testid="nav-scansion"><Type/><span>Scansion</span></button>
        </nav>
        <div className="side-label">Drafts · {drafts.length}</div>
        <div className="draft-list" aria-label="Browser drafts">
          {drafts.map((draft) => <button
            key={draft.id}
            className={`side-button side-poem ${draft.id === activeDraftId ? 'active' : ''}`}
            title={draft.source ? `${draft.title} · ${draft.source.fileName} (${draft.source.format.toUpperCase()})` : draft.title}
            aria-current={draft.id === activeDraftId ? 'page' : undefined}
            onClick={() => switchDraft(draft.id)}
            data-testid={`button-draft-${draft.id}`}
          ><FileText/><span>{draft.title || 'Untitled poem'}</span></button>)}
        </div>
        <div className="side-foot"><div className="side-note">A quiet place for unfinished things.<br/>Your work stays on this device.</div></div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb"><span>Manuscripts</span><span>/</span><strong>{title || 'Untitled poem'}</strong></div>
          <div className="top-actions">
            <div className="save-state" data-testid="status-save"><span className="save-dot" style={{ background: dirty ? '#c49b64' : undefined }}/>{savedAt}</div>
            <input ref={fileInputRef} type="file" accept=".txt,.md,.markdown,.html,.htm,.rtf,.docx,.odt,text/plain,text/markdown,text/html,application/rtf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.oasis.opendocument.text" hidden onChange={onFallbackFileChange} data-testid="input-open-poem"/>
            <select className="draft-switcher" aria-label="Switch browser draft" value={activeDraftId} onChange={(event) => switchDraft(event.target.value)} data-testid="select-browser-draft">
              {drafts.map((draft) => <option key={draft.id} value={draft.id}>{draft.title || 'Untitled poem'}</option>)}
            </select>
            <button className="button ghost" onClick={openHistory} title="View earlier saved versions" data-testid="button-version-history"><History/><span>History</span></button>
            <button className="button ghost" onClick={createBrowserDraft} title="Create a new browser draft" aria-label="Create a new browser draft" data-testid="button-new-draft"><Plus/><span>New</span></button>
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
                <select className="select-tool" aria-label="Font size" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} data-testid="select-font-size">
                  {[16, 17, 18, 19, 20, 22, 24, 28].map((size) => <option key={size} value={size}>{size}px</option>)}
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
                  style={{ fontSize, tabSize: tabStops === '2 spaces' ? 2 : tabStops === '8 spaces' ? 8 : 4 }}
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
              <div><div className="panel-title">{activeTool === 'rhymes' ? 'Rhyme room' : activeTool === 'forms' ? 'Forms library' : activeTool === 'proof' ? 'Proofing' : 'Scansion'}</div><div className="panel-sub">{activeTool === 'rhymes' ? 'Listen for an ending.' : activeTool === 'forms' ? 'A small shelf of structures.' : activeTool === 'proof' ? 'Suggestions, not rules.' : 'A light touch on the beat.'}</div></div>
              <button className="button ghost small" title="Panel options" aria-label="Panel options" onClick={() => setModal('settings')}><PanelRight/></button>
            </div>
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
              <label className="field-label" htmlFor="form-search">Browse forms</label>
              <div className="search-wrap"><Search/><input id="form-search" className="search-field" placeholder="Search forms" value={formQuery} onChange={(event) => setFormQuery(event.target.value)} data-testid="input-form-search"/></div>
              <div style={{ marginTop: 8 }}>{filteredForms.map((form) => <div className="form-item" key={form.name}><strong>{form.name}</strong><div className="rhyme-kind" style={{ marginTop: 4 }}>{form.structure}</div><p>{form.description}</p><button className="button small" style={{ marginTop: 8 }} onClick={() => applyForm(form)} data-testid={`button-form-${form.name.toLowerCase().replace(/\s+/g, '-')}`}>Use as reference</button></div>)}</div>
            </div>}
            {activeTool === 'proof' && <div className="panel-card">
              <div className="switch-row"><div><div className="switch-title">Proofing suggestions</div><div className="switch-desc">Local checks + browser spellcheck</div></div><button className={`switch ${proofOn ? 'on' : ''}`} role="switch" aria-checked={proofOn} aria-label="Toggle proofing" onClick={() => setProofOn((value) => !value)} data-testid="toggle-proofing"/></div>
              <div className="notice" style={{ margin: '12px 0' }}><CircleHelp/>Red marks come from the built-in English dictionary; poetry, names, and invented words can be added to your personal dictionary. Green marks are suggestions you can ignore.</div>
              {proofOn && <div className="proof-list">
                {grammars.map((item) => <div className="proof-item grammar" key={item.match}><strong>{item.match}</strong><p>{item.reason}</p><div className="proof-actions">{item.fix && <button className="button small" onClick={() => { const updated = text.replace(item.match, item.fix); if (editorRef.current) editorRef.current.innerText = updated; onEditorInput(); setDismissed((old) => [...old, item.match]); }} data-testid="button-grammar-apply">Apply {item.fix}</button>}<button className="button small" onClick={() => setDismissed((old) => [...old, item.match])} data-testid="button-grammar-ignore">Ignore</button></div></div>)}
                {!grammars.length && <div className="empty-hint">No local grammar suggestions right now. Keep listening to the line.</div>}
                <div className="proof-item"><strong>Add a word to your dictionary</strong><p>Selected word: {selection.split(/\s+/).pop() || 'select a word in the poem'}</p><button className="button small" style={{ marginTop: 7 }} disabled={!selection} onClick={() => addToDictionary(selection.split(/\s+/).pop() || '')} data-testid="button-add-word"><Plus/>Add selected word</button></div>
                {customWords.length > 0 && <div className="proof-item"><strong>Your words · {customWords.length}</strong><p>{customWords.join(' · ')}</p><button className="button small" onClick={() => { setCustomWords([]); setToast('Personal dictionary cleared'); }}>Clear dictionary</button></div>}
              </div>}
              {!proofOn && <div className="empty-hint">Proofing is paused. Browser spellcheck is also off for the workspace.</div>}
            </div>}
            {activeTool === 'scansion' && <div className="panel-card">
              <div className="switch-row"><div><div className="switch-title">Show marks above each line</div><div className="switch-desc">Overlay the stress guide on the poem</div></div><button className={`switch ${settings.scansion ? 'on' : ''}`} role="switch" aria-checked={settings.scansion} aria-label="Toggle scansion guide" onClick={() => setSettings((old) => ({ ...old, scansion: !old.scansion }))} data-testid="toggle-scansion"/></div>
              <div className="notice" style={{ marginTop: 12 }}><Type/>Click a mark to cycle through u, /, and \\. Click between marks to add or remove a foot boundary. The pronunciation-based marks are a starting point—your ear has the final say.</div>
              <div className="field-label" style={{ marginTop: 16 }}>Line syllable estimates</div>
              {countedLineEntries.slice(0, 9).map(({ line, index }) => {
                const syllableCount = scansionRows[index]?.reduce((total, word) => total + word.marks.length, 0) || lineSyllables(line);
                return <div className="rhyme-row" key={`${index}-${line}`} style={{ alignItems: 'flex-start', gap: 8 }}><span style={{ font: '12px var(--app-font-serif)', flex: 1 }}>{line.slice(0, 34)}{line.length > 34 ? '…' : ''}</span><span className="rhyme-kind">{syllableCount} syl.</span></div>;
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
        <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
          <div className="dialog-head"><div><h2 id="dialog-title">{modal === 'export' ? 'Take the poem with you' : modal === 'history' ? 'Earlier versions' : 'Studio settings'}</h2><p>{modal === 'export' ? 'Choose a simple, portable format.' : modal === 'history' ? 'Preview and restore a saved title and manuscript.' : 'Tune the page to your way of working.'}</p></div><button className="modal-x" onClick={() => setModal(null)} aria-label="Close dialog"><X/></button></div>
          {modal === 'history' ? <><div className="history-layout">
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
              {selectedRevision && <section className="history-preview" aria-label="Version preview">
                <div className="field-label">Preview · {new Date(selectedRevision.createdAt).toLocaleString()}</div>
                <h3>{selectedRevision.title || 'Untitled poem'}</h3>
                <pre>{cleanText(selectedRevision.editorHtml) || 'This version has no manuscript text.'}</pre>
              </section>}
            </div><div className="dialog-foot"><button className="button" onClick={() => setModal(null)}>Cancel</button><button className="button primary" disabled={!selectedRevision} onClick={restoreRevision} data-testid="button-restore-version"><History/>Restore this version</button></div></> :
          modal === 'export' ? <><div className="panel-card"><div className="form-item" style={{ border: 0, paddingTop: 0 }}><strong>Plain text</strong><p>Preserves the line breaks, ready for any text editor.</p><button className="button primary" style={{ marginTop: 10 }} onClick={() => exportPoem('txt')} data-testid="button-export-txt"><Download/>Export .txt</button></div><div className="form-item"><strong>PDF</strong><p>A fixed-layout copy with your title, lines, and stanza breaks.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('pdf')} data-testid="button-export-pdf"><Download/>Export .pdf</button></div><div className="form-item"><strong>HTML document</strong><p>A clean document with your title and stanza breaks.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('html')} data-testid="button-export-html"><Download/>Export .html</button></div><div className="form-item"><strong>Word document</strong><p>A formatted document you can open in Microsoft Word and other word processors.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('docx')} data-testid="button-export-docx"><Download/>Export .docx</button></div><div className="form-item"><strong>Rich text</strong><p>A widely compatible document format for word processors.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('rtf')} data-testid="button-export-rtf"><Download/>Export .rtf</button></div><div className="form-item"><strong>OpenDocument text</strong><p>An editable document format for LibreOffice and other compatible apps.</p><button className="button" style={{ marginTop: 10 }} onClick={() => exportPoem('odt')} data-testid="button-export-odt"><Download/>Export .odt</button></div></div><div className="panel-sub">Your manuscript is stored locally in this browser. Export a copy before clearing browser data.</div></> :
            <><div className="form-grid">
              <label><span className="field-label">Tab stop</span><select className="text-field" value={tabStops} onChange={(event) => setTabStops(event.target.value)} data-testid="select-tab-stops"><option>2 spaces</option><option>4 spaces</option><option>8 spaces</option></select></label>
              <label><span className="field-label">Editor size</span><select className="text-field" value={fontSize} onChange={(event) => setFontSize(Number(event.target.value))} data-testid="settings-font-size">{[16,17,18,19,20,22,24,28].map((size) => <option key={size} value={size}>{size}px</option>)}</select></label>
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
