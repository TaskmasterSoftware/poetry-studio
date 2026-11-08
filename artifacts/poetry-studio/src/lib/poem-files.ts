import {
  getEditorParagraphs, markdownIndentColumns, readDocx, readOdt, readRtf, serializeDocx, serializeOdt, serializeRtf,
  type ExportInlineStyle, type ExportRun,
} from './document-import';
import type { BookMatterPage, BookPageSide } from './book-pages';

export type WritablePoemFileFormat = 'txt' | 'md' | 'html' | 'rtf' | 'docx' | 'odt';
export type PoemFileFormat = WritablePoemFileFormat;
export type DownloadablePoemFileFormat = WritablePoemFileFormat | 'pdf';

export interface WritablePoemFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{
    write(data: Blob | string): Promise<void>;
    close(): Promise<void>;
  }>;
  queryPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (options: { mode: 'readwrite' }) => Promise<PermissionState>;
}

export interface OpenedPoemFile {
  title: string;
  text: string;
  editorHtml?: string;
  fileName: string;
  format: PoemFileFormat;
}

export interface SavedPoemSource {
  fileName: string;
  format: WritablePoemFileFormat;
}

export type PoemSubmissionStatus = 'pending' | 'published' | 'rejected';

export interface PoemSubmission {
  id: string;
  publisher: string;
  websiteUrl: string;
  submittedAt: string;
  status: PoemSubmissionStatus;
  responseDate: string;
  notes: string;
}

export interface PoemMetadata {
  dateWritten: string;
  form: string;
  tags: string[];
  notes: string;
  submissions: PoemSubmission[];
}

export interface BrowserPoemDraft {
  id: string;
  title: string;
  editorHtml: string;
  source: SavedPoemSource | null;
  bookId?: string;
  metadata?: PoemMetadata;
}

export function emptyPoemMetadata(): PoemMetadata {
  return { dateWritten: '', form: '', tags: [], notes: '', submissions: [] };
}

function metadataText(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function metadataDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : '';
}

export function normalizePoemMetadata(value: unknown): PoemMetadata {
  if (!value || typeof value !== 'object') return emptyPoemMetadata();
  const metadata = value as Partial<PoemMetadata>;
  const tags = Array.isArray(metadata.tags)
    ? [...new Map(metadata.tags
      .filter((tag): tag is string => typeof tag === 'string')
      .map((tag) => tag.trim().slice(0, 80))
      .filter(Boolean)
      .map((tag) => [tag.toLocaleLowerCase(), tag] as const)).values()].slice(0, 100)
    : [];
  const submissions = Array.isArray(metadata.submissions)
    ? metadata.submissions.slice(0, 500).filter((entry) => entry && typeof entry === 'object').map((entry, index) => {
      const submission = entry as Partial<PoemSubmission>;
      const status: PoemSubmissionStatus = submission.status === 'published' || submission.status === 'rejected'
        ? submission.status
        : 'pending';
      return {
        id: metadataText(submission.id, 128) || `submission-${index + 1}`,
        publisher: metadataText(submission.publisher, 200),
        websiteUrl: metadataText(submission.websiteUrl, 1000),
        submittedAt: metadataDate(submission.submittedAt),
        status,
        responseDate: metadataDate(submission.responseDate),
        notes: metadataText(submission.notes, 10000),
      };
    })
    : [];
  return {
    dateWritten: metadataDate(metadata.dateWritten),
    form: metadataText(metadata.form, 120),
    tags,
    notes: metadataText(metadata.notes, 20000),
    submissions,
  };
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

export function matchesPoemMetadataSearch(
  poem: Pick<BrowserPoemDraft, 'title' | 'metadata'>,
  query: string,
) {
  const terms = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const metadata = normalizePoemMetadata(poem.metadata);
  const searchableText = normalizeSearchText([
    poem.title,
    metadata.dateWritten,
    metadata.form,
    metadata.tags.join(' '),
    metadata.notes,
    ...metadata.submissions.flatMap((submission) => [
      submission.publisher,
      submission.websiteUrl,
      submission.submittedAt,
      submission.status === 'pending' ? 'pending awaiting reply' : submission.status,
      submission.responseDate,
      submission.notes,
    ]),
  ].join(' '));
  return terms.every((term) => searchableText.includes(term));
}

export interface BrowserPoemRevision {
  id: string;
  title: string;
  editorHtml: string;
  createdAt: string;
}

export function isBrowserPoemRevision(value: unknown): value is BrowserPoemRevision {
  if (!value || typeof value !== 'object') return false;
  const revision = value as Partial<BrowserPoemRevision>;
  return typeof revision.id === 'string'
    && revision.id.length > 0
    && typeof revision.title === 'string'
    && typeof revision.editorHtml === 'string'
    && typeof revision.createdAt === 'string'
    && Number.isFinite(Date.parse(revision.createdAt));
}

export function appendBrowserPoemRevision(
  revisions: BrowserPoemRevision[],
  revision: BrowserPoemRevision,
  limit = 20,
): BrowserPoemRevision[] {
  const ordered = [...revisions].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  const latest = ordered[0];
  if (latest?.title === revision.title && latest.editorHtml === revision.editorHtml) return ordered;
  return [revision, ...ordered].slice(0, Math.max(1, limit));
}

export function restoreBrowserPoemDraft(draft: BrowserPoemDraft, revision: BrowserPoemRevision): BrowserPoemDraft {
  return { ...draft, title: revision.title, editorHtml: revision.editorHtml };
}

export function removeBrowserPoemDraft(drafts: BrowserPoemDraft[], draftId: string): BrowserPoemDraft[] {
  return drafts.filter((draft) => draft.id !== draftId);
}

export function isBrowserPoemDraft(value: unknown): value is BrowserPoemDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<BrowserPoemDraft>;
  return typeof draft.id === 'string'
    && draft.id.length > 0
    && typeof draft.title === 'string'
    && typeof draft.editorHtml === 'string'
    && (draft.bookId === undefined || (typeof draft.bookId === 'string' && draft.bookId.length > 0))
    && (draft.source === null || isSavedPoemSource(draft.source));
}

const supportedFormats: Record<string, PoemFileFormat> = {
  txt: 'txt',
  md: 'md',
  markdown: 'md',
  html: 'html',
  htm: 'html',
  rtf: 'rtf',
  docx: 'docx',
  odt: 'odt',
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  })[character] || character);
}

const safeEditorTags = new Set([
  'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4',
  'H5', 'H6', 'I', 'INS', 'LI', 'MARK', 'OL', 'P', 'PRE', 'S', 'SPAN', 'STRIKE',
  'STRONG', 'SUB', 'SUP', 'U', 'UL',
]);
const safeEditorFontFamilies = new Set([
  'georgia, serif',
  '"palatino linotype", palatino, serif',
  '"times new roman", times, serif',
  'arial, helvetica, sans-serif',
  'verdana, geneva, sans-serif',
  '"courier new", courier, monospace',
  '"trebuchet ms", sans-serif',
]);
const droppedHtmlTags = new Set([
  'IFRAME', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE',
]);

function safeEditorInlineStyle(value: string) {
  const declarations: string[] = [];
  const emphasis = { bold: false, italic: false, underline: false };
  for (const declaration of value.split(';')) {
    const separator = declaration.indexOf(':');
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const rawValue = declaration.slice(separator + 1).trim().toLowerCase().replace(/\s*!important$/, '').trim();
    if (property === 'font-family' && safeEditorFontFamilies.has(rawValue)) {
      declarations.push(`font-family:${rawValue}`);
    } else if (property === 'font-size') {
      const match = rawValue.match(/^(\d+(?:\.\d+)?)(pt|px|em|rem|%)$/);
      if (match && Number(match[1]) > 0 && Number(match[1]) <= 144) {
        declarations.push(`font-size:${Number(match[1])}${match[2]}`);
      }
    } else if (property === 'font-weight') {
      emphasis.bold ||= rawValue === 'bold' || rawValue === 'bolder' || (/^\d+$/.test(rawValue) && Number(rawValue) >= 600);
    } else if (property === 'font-style') {
      emphasis.italic ||= rawValue === 'italic' || rawValue === 'oblique';
    } else if (property === 'text-decoration' || property === 'text-decoration-line') {
      emphasis.underline ||= rawValue.split(/\s+/).includes('underline');
    }
  }
  return { style: declarations.join(';'), ...emphasis };
}

function safeEditorNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as HTMLElement;
  const tagName = element.tagName.toUpperCase();
  if (droppedHtmlTags.has(tagName)) return '';
  const children = Array.from(element.childNodes).map(safeEditorNode).join('');
  if (!safeEditorTags.has(tagName)) return children;
  const tag = tagName.toLowerCase();
  if (tag === 'br') return '<br>';
  const inlineStyle = tagName === 'SPAN' ? safeEditorInlineStyle(element.getAttribute('style') || '') : null;
  let safeHtml = `<${tag}${inlineStyle?.style ? ` style="${escapeHtml(inlineStyle.style)}"` : ''}>${children}</${tag}>`;
  if (inlineStyle?.underline) safeHtml = `<u>${safeHtml}</u>`;
  if (inlineStyle?.italic) safeHtml = `<em>${safeHtml}</em>`;
  if (inlineStyle?.bold) safeHtml = `<strong>${safeHtml}</strong>`;
  return safeHtml;
}

function sanitizeEditorHtml(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const body = parsed.body || parsed.getElementsByTagName('body')[0] || parsed.documentElement;
  return body ? Array.from(body.childNodes).map(safeEditorNode).join('') : escapeHtml(source);
}

function fileFormat(fileName: string): PoemFileFormat {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const format = supportedFormats[extension];
  if (!format) throw new Error('Choose a .txt, .md, .html, .rtf, .docx, or .odt poem file.');
  return format;
}

export function isWritablePoemFileFormat(format: PoemFileFormat): format is WritablePoemFileFormat {
  return ['txt', 'md', 'html', 'rtf', 'docx', 'odt'].includes(format);
}

export function isSavedPoemSource(value: unknown): value is SavedPoemSource {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<SavedPoemSource>;
  return typeof source.fileName === 'string'
    && source.fileName.trim().length > 0
    && typeof source.format === 'string'
    && isWritablePoemFileFormat(source.format as PoemFileFormat);
}

function textFromHtmlNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as HTMLElement;
  if (/^(SCRIPT|STYLE|NOSCRIPT|NAV|FOOTER)$/.test(element.tagName)) return '';
  if (element.tagName === 'BR') return '\n';
  const content = Array.from(element.childNodes).map(textFromHtmlNode).join('');
  return /^(P|DIV|LI|H[1-6]|BLOCKQUOTE|PRE|SECTION)$/.test(element.tagName)
    ? `${content}\n`
    : content;
}

function firstHtmlDescendant(node: Node, tagNames: ReadonlySet<string>): HTMLElement | null {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const element = child as HTMLElement;
    if (tagNames.has(element.tagName.toUpperCase())) return element;
    const descendant = firstHtmlDescendant(element, tagNames);
    if (descendant) return descendant;
  }
  return null;
}

function htmlToEditorContent(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const body = parsed.body || firstHtmlDescendant(parsed, new Set(['BODY'])) || parsed.documentElement;
  const root = firstHtmlDescendant(parsed, new Set(['ARTICLE', 'MAIN'])) || body;
  const contentRoot = root.cloneNode(true) as HTMLElement;
  const heading = firstHtmlDescendant(contentRoot, new Set(['H1', 'H2']));
  const documentTitle = parsed.title || firstHtmlDescendant(parsed, new Set(['TITLE']))?.textContent || '';
  const title = (heading ? textFromHtmlNode(heading) : '').trim() || documentTitle.trim();
  if (heading?.parentNode) heading.parentNode.removeChild(heading);
  const editorHtml = Array.from(contentRoot.childNodes).map(safeEditorNode).join('');
  const safeDocument = new DOMParser().parseFromString(editorHtml, 'text/html');
  const safeContent = safeDocument.body || safeDocument.documentElement;
  if (!safeContent) return { title, text: '', editorHtml };
  const text = Array.from(safeContent.childNodes)
    .map(textFromHtmlNode)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\n+$/, '');
  return { title, text, editorHtml };
}

function markdownToText(source: string) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let title = '';
  if (lines[0]?.startsWith('# ')) title = lines.shift()!.slice(2).trim();
  const text = lines.join('\n')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/([*_`~])/g, '');
  return { title, text };
}

export async function readPoemFile(file: File): Promise<OpenedPoemFile> {
  const format = fileFormat(file.name);
  let extracted: { title: string; text: string; editorHtml?: string };
  let editorHtml: string | undefined;

  if (format === 'docx') {
    extracted = await readDocx(file);
    editorHtml = extracted.editorHtml;
  } else if (format === 'odt') {
    extracted = await readOdt(file);
    editorHtml = extracted.editorHtml;
  } else {
    const source = await file.text();
    if (format === 'rtf') {
      extracted = readRtf(source);
      editorHtml = extracted.editorHtml;
    } else if (format === 'html') {
      const htmlContent = htmlToEditorContent(source);
      extracted = htmlContent;
      editorHtml = htmlContent.editorHtml;
    } else if (format === 'md') {
      extracted = markdownToText(source);
    } else {
      const normalized = source.replace(/\r\n?/g, '\n');
      const titleBlock = normalized.match(/^([^\n]+)\n[ \t]*\n/);
      extracted = titleBlock
        ? { title: titleBlock[1].trim(), text: normalized.slice(titleBlock[0].length) }
        : { title: '', text: normalized };
    }
  }

  const fallbackTitle = file.name.replace(/\.(txt|md|markdown|html?|rtf|docx|odt)$/i, '').replace(/[_-]+/g, ' ').trim();
  return {
    title: extracted.title || fallbackTitle || 'Untitled poem',
    text: extracted.text.replace(/\u0000/g, ''),
    editorHtml,
    fileName: file.name,
    format,
  };
}

export function poemTextToEditorHtml(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
    .join('');
}

function markdownPoemText(text: string, editorHtml?: string) {
  if (!editorHtml) return text;
  const paragraphs = getEditorParagraphs(editorHtml, text);
  if (!paragraphs.some((paragraph) => paragraph.left || paragraph.firstLine)) return text;

  const paragraphText = paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join(''));
  const normalizedText = text.replace(/\r\n?/g, '\n');
  if (paragraphText.join('\n') !== normalizedText) return text;

  return paragraphs.map((paragraph, index) => {
    const content = paragraphText[index];
    if (!content) return content;
    const leftIndent = markdownIndentColumns(paragraph.left);
    const firstLineIndent = markdownIndentColumns(paragraph.firstLine);
    return content.split('\n').map((line, lineIndex) => {
      if (!line) return line;
      const indent = Math.max(0, leftIndent + (lineIndex === 0 ? firstLineIndent : 0));
      return `${'\u00a0'.repeat(indent)}${line}`;
    }).join('\n');
  }).join('\n');
}

export function serializePoem(title: string, text: string, format: WritablePoemFileFormat, editorHtml?: string): string | Blob {
  if (format === 'txt') return `${title}\n\n${text}`;
  if (format === 'md') return `# ${title}\n\n${markdownPoemText(text, editorHtml)}`;
  if (format === 'rtf') return serializeRtf(title, text, editorHtml);
  if (format === 'docx') return serializeDocx(title, text, editorHtml);
  if (format === 'odt') return serializeOdt(title, text, editorHtml);
  const content = sanitizeEditorHtml(editorHtml ?? poemTextToEditorHtml(text));
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><article><h1>${escapeHtml(title)}</h1>${content}</article></body></html>`;
}

const winAnsiSpecialCharacters = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

function winAnsiHex(value: string) {
  return Array.from(value, (character) => {
    const codePoint = character.codePointAt(0)!;
    const byte = winAnsiSpecialCharacters.get(codePoint)
      ?? (codePoint <= 0x7f || (codePoint >= 0xa0 && codePoint <= 0xff) ? codePoint : 0x3f);
    return byte.toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

function pdfUnicodeHex(value: string) {
  const bytes = [0xfe, 0xff];
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    bytes.push(codeUnit >> 8, codeUnit & 0xff);
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function wrapPdfLine(value: string, maxCharacters: number) {
  let remaining = Array.from(value);
  const wrapped: string[] = [];
  while (remaining.length > maxCharacters) {
    let splitAt = remaining.slice(0, maxCharacters + 1).lastIndexOf(' ');
    if (splitAt < 1) splitAt = maxCharacters;
    wrapped.push(remaining.slice(0, splitAt).join('').trimEnd());
    remaining = remaining.slice(splitAt);
    while (remaining[0] === ' ') remaining.shift();
  }
  wrapped.push(remaining.join(''));
  return wrapped;
}

function assemblePdf(title: string, pages: string[][], options: PdfExportOptions) {
  const { width, height } = pdfDimensions(options);
  const pdfVersion = options.outputProfile === 'pdfx-1a-2003'
    ? '1.4'
    : options.outputProfile.replace('standard-', '');
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${7 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
  objects[5] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>';
  objects[6] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>';

  pages.forEach((commands, index) => {
    const pageNumber = 7 + index * 2;
    const contentNumber = pageNumber + 1;
    const stream = `${commands.join('\n')}\n`;
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  const infoNumber = objects.length;
  objects[infoNumber] = `<< /Title <${pdfUnicodeHex(title.trim() || 'Untitled poem')}> /Producer (Poetry Studio) >>`;
  let pdf = `%PDF-${pdfVersion}\n%Poetry Studio\n`;
  const offsets = [0];
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    offsets[objectNumber] = pdf.length;
    pdf += `${objectNumber} 0 obj\n${objects[objectNumber]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber < objects.length; objectNumber += 1) {
    pdf += `${String(offsets[objectNumber]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info ${infoNumber} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

export type PdfPageSize = 'letter' | 'a4' | 'a5' | 'custom';
export type PdfMarginPreset = 'narrow' | 'standard' | 'wide';
export type PdfOrientation = 'portrait' | 'landscape';
export type PdfOutputProfile =
  | 'standard-1.3'
  | 'standard-1.4'
  | 'standard-1.5'
  | 'standard-1.6'
  | 'standard-1.7'
  | 'standard-2.0'
  | 'pdfx-1a-2003';
export interface PdfExportOptions {
  pageSize: PdfPageSize;
  margins: PdfMarginPreset;
  outputProfile: PdfOutputProfile;
  orientation?: PdfOrientation;
  customWidthInches?: number;
  customHeightInches?: number;
}

export const defaultPdfExportOptions: PdfExportOptions = {
  pageSize: 'letter',
  margins: 'standard',
  outputProfile: 'standard-1.4',
  orientation: 'portrait',
  customWidthInches: 8.5,
  customHeightInches: 11,
};
const defaultCustomPdfWidthInches = 8.5;
const defaultCustomPdfHeightInches = 11;
const pdfOutputProfiles: PdfOutputProfile[] = [
  'standard-1.3',
  'standard-1.4',
  'standard-1.5',
  'standard-1.6',
  'standard-1.7',
  'standard-2.0',
  'pdfx-1a-2003',
];

export function normalizePdfExportOptions(value: unknown): PdfExportOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...defaultPdfExportOptions };
  }

  const saved = value as Record<string, unknown>;
  const validDimension = (dimension: unknown, fallback: number) =>
    typeof dimension === 'number' && Number.isFinite(dimension) && dimension >= 3 && dimension <= 36
      ? dimension
      : fallback;
  return {
    pageSize: saved.pageSize === 'letter' || saved.pageSize === 'a4' || saved.pageSize === 'a5' || saved.pageSize === 'custom'
      ? saved.pageSize
      : defaultPdfExportOptions.pageSize,
    margins: saved.margins === 'narrow' || saved.margins === 'standard' || saved.margins === 'wide'
      ? saved.margins
      : defaultPdfExportOptions.margins,
    outputProfile: pdfOutputProfiles.includes(saved.outputProfile as PdfOutputProfile)
      ? saved.outputProfile as PdfOutputProfile
      : defaultPdfExportOptions.outputProfile,
    orientation: saved.orientation === 'portrait' || saved.orientation === 'landscape'
      ? saved.orientation
      : defaultPdfExportOptions.orientation,
    customWidthInches: validDimension(saved.customWidthInches, defaultCustomPdfWidthInches),
    customHeightInches: validDimension(saved.customHeightInches, defaultCustomPdfHeightInches),
  };
}

const pdfPageDimensions: Record<Exclude<PdfPageSize, 'custom'>, { width: number; height: number }> = {
  letter: { width: 612, height: 792 },
  a4: { width: 595.28, height: 841.89 },
  a5: { width: 419.53, height: 595.28 },
};
const pdfMarginPoints: Record<PdfMarginPreset, number> = { narrow: 36, standard: 72, wide: 90 };

function pdfDimensions(options: PdfExportOptions) {
  const dimensions = options.pageSize === 'custom'
    ? {
      width: (options.customWidthInches && options.customWidthInches >= 3 && options.customWidthInches <= 36
        ? options.customWidthInches
        : defaultCustomPdfWidthInches) * 72,
      height: (options.customHeightInches && options.customHeightInches >= 3 && options.customHeightInches <= 36
        ? options.customHeightInches
        : defaultCustomPdfHeightInches) * 72,
    }
    : pdfPageDimensions[options.pageSize];
  return options.orientation === 'landscape'
    ? { width: dimensions.height, height: dimensions.width }
    : dimensions;
}

function cssMeasureToPdfPoints(value: string | undefined) {
  const match = value?.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(pt|in|cm|mm|px|pc)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const pointsPerUnit: Record<string, number> = {
    pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75, pc: 12,
  };
  return amount * pointsPerUnit[match[2].toLowerCase()];
}

function pdfLayout(options: PdfExportOptions) {
  const { width, height } = pdfDimensions(options);
  const margin = pdfMarginPoints[options.margins];
  const contentWidth = width - margin * 2;
  return {
    width,
    height,
    margin,
    contentWidth,
    bodyCharacters: Math.max(1, Math.floor(contentWidth / 5.5)),
    titleCharacters: Math.max(1, Math.floor(contentWidth / 10)),
  };
}

type PdfCharacter = { value: string; style: ExportInlineStyle };

function mergePdfCharacters(characters: PdfCharacter[]): ExportRun[] {
  const runs: ExportRun[] = [];
  for (const character of characters) {
    const previous = runs[runs.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(character.style)) {
      previous.text += character.value;
    } else {
      runs.push({ text: character.value, style: character.style });
    }
  }
  return runs;
}

function wrapPdfRuns(runs: ExportRun[], maxCharacters: number) {
  let remaining = runs.flatMap((run) =>
    Array.from(run.text, (value) => ({ value, style: run.style })),
  );
  const wrapped: ExportRun[][] = [];
  while (remaining.length > maxCharacters) {
    let splitAt = remaining.slice(0, maxCharacters + 1).findLastIndex((character) => character.value === ' ');
    if (splitAt < 1) splitAt = maxCharacters;
    const line = remaining.slice(0, splitAt);
    while (line[line.length - 1]?.value === ' ') line.pop();
    wrapped.push(mergePdfCharacters(line));
    remaining = remaining.slice(splitAt);
    while (remaining[0]?.value === ' ') remaining.shift();
  }
  wrapped.push(mergePdfCharacters(remaining));
  return wrapped;
}

function splitPdfParagraphLines(runs: ExportRun[]) {
  const lines: ExportRun[][] = [[]];
  for (const run of runs) {
    const pieces = run.text.split('\n');
    pieces.forEach((piece, index) => {
      if (piece) lines[lines.length - 1].push({ text: piece, style: run.style });
      if (index < pieces.length - 1) lines.push([]);
    });
  }
  return lines;
}

function pdfFont(style: ExportInlineStyle): 'F1' | 'F2' | 'F3' | 'F4' {
  if (style.bold && style.italic) return 'F4';
  if (style.bold) return 'F2';
  if (style.italic) return 'F3';
  return 'F1';
}

function approximatePdfTextWidth(value: string, size: number) {
  return Array.from(value).length * size * 0.5;
}

function appendStyledPdfLine(
  commands: string[],
  runs: ExportRun[],
  y: number,
  layout: ReturnType<typeof pdfLayout>,
  align: 'left' | 'center' | 'right' | 'justify' | undefined,
  justify: boolean,
  lineLeft: number,
  lineRight: number,
) {
  const totalText = runs.map((run) => run.text).join('');
  const lineWidth = approximatePdfTextWidth(totalText, 11);
  const availableWidth = lineRight - lineLeft;
  const wordSpaces = (totalText.match(/ /g) || []).length;
  const wordSpacing = justify && wordSpaces > 0
    ? Math.max(0, (availableWidth - lineWidth) / wordSpaces)
    : 0;
  let x = align === 'center'
    ? lineLeft + availableWidth / 2 - lineWidth / 2
    : align === 'right'
      ? lineRight - lineWidth
      : lineLeft;

  for (const run of runs) {
    const font = pdfFont(run.style);
    const runWidth = approximatePdfTextWidth(run.text, 11) + (run.text.match(/ /g) || []).length * wordSpacing;
    commands.push(`BT /${font} 11 Tf ${wordSpacing} Tw ${x} ${y} Td <${winAnsiHex(run.text)}> Tj 0 Tw ET`);
    if (run.style.underline && runWidth > 0) {
      commands.push(`0.6 w ${x} ${y - 2} m ${x + runWidth} ${y - 2} l S`);
    }
    x += runWidth;
  }
}

function buildPdf(title: string, text: string, editorHtml: string | undefined, options: PdfExportOptions) {
  const layout = pdfLayout(options);
  const pages: string[][] = [[]];
  let y = layout.height - layout.margin;
  const addPage = () => {
    pages.push([]);
    y = layout.height - layout.margin;
  };
  const addText = (value: string, font: 'F1' | 'F2', size: number) => {
    pages[pages.length - 1].push(`BT /${font} ${size} Tf ${layout.margin} ${y} Td <${winAnsiHex(value)}> Tj ET`);
  };

  const titleLines = wrapPdfLine(title.trim() || 'Untitled poem', layout.titleCharacters);
  for (const line of titleLines) {
    if (y < layout.margin + 20) addPage();
    addText(line, 'F2', 20);
    y -= 25;
  }
  y -= 12;

  const paragraphs = getEditorParagraphs(editorHtml, text);
  for (const paragraph of paragraphs) {
    const paragraphLines = splitPdfParagraphLines(paragraph.runs);
    if (paragraphLines.every((line) => !line.length)) {
      if (y - 12 < layout.margin) addPage();
      y -= 12;
      continue;
    }
    const leftIndent = cssMeasureToPdfPoints(paragraph.left);
    const rightIndent = cssMeasureToPdfPoints(paragraph.right);
    const firstLineIndent = cssMeasureToPdfPoints(paragraph.firstLine);
    for (const [paragraphLineIndex, paragraphLine] of paragraphLines.entries()) {
      const isFirstParagraphLine = paragraphLineIndex === 0;
      const firstLineOffset = isFirstParagraphLine ? firstLineIndent : 0;
      const availableWidth = layout.contentWidth - leftIndent - rightIndent - firstLineOffset;
      const maxCharacters = Math.max(1, Math.floor(availableWidth / 5.5));
      const wrappedLines = wrapPdfRuns(paragraphLine, maxCharacters);
      for (const [wrappedLineIndex, lineRuns] of wrappedLines.entries()) {
        if (y < layout.margin) addPage();
        const lineLeft = layout.margin + leftIndent
          + (isFirstParagraphLine && wrappedLineIndex === 0 ? firstLineIndent : 0);
        const lineRight = layout.width - layout.margin - rightIndent;
        appendStyledPdfLine(
          pages[pages.length - 1],
          lineRuns,
          y,
          layout,
          paragraph.align,
          paragraph.align === 'justify' && wrappedLineIndex < wrappedLines.length - 1,
          lineLeft,
          lineRight,
        );
        y -= 15;
      }
    }
  }

  return assemblePdf(title, pages, options);
}

function buildBookPdf(
  bookTitle: string,
  poems: { title: string; text: string; editorHtml?: string }[],
  options: PdfExportOptions,
  bookPages: BookMatterPage[] = [],
) {
  const layout = pdfLayout(options);
  const pages: string[][] = [];
  const poemStartPages: number[] = [];
  const appendPage = (side: BookPageSide = 'either') => {
    const nextPageNumber = pages.length + 1;
    if ((side === 'recto' && nextPageNumber % 2 === 0)
      || (side === 'verso' && nextPageNumber % 2 === 1)) pages.push([]);
    pages.push([]);
    return pages.length - 1;
  };
  const appendContinuationPage = () => pages.push([]);
  const textX = (value: string, size: number, alignment: BookMatterPage['alignment']) => {
    const textWidth = approximatePdfTextWidth(value, size);
    if (alignment === 'center') return layout.margin + Math.max(0, (layout.contentWidth - textWidth) / 2);
    if (alignment === 'right') return layout.width - layout.margin - textWidth;
    return layout.margin;
  };
  const appendMatterPage = (page: BookMatterPage) => {
    appendPage(page.side);
    const centeredOpening = ['half-title', 'frontispiece', 'title-page', 'dedication', 'epigraph'].includes(page.type);
    const isHalfTitle = page.type === 'half-title';
    const isTitlePage = page.type === 'title-page';
    const titleY = isHalfTitle
      ? layout.height * 0.58
      : isTitlePage
        ? layout.height * 0.64
        : centeredOpening
          ? layout.height * 0.65
          : layout.height - layout.margin - 24;
    const title = page.title.trim();
    let y = title ? titleY : centeredOpening ? layout.height * 0.56 : layout.height - layout.margin;
    if (title) {
      const titleSize = isHalfTitle ? 20 : isTitlePage ? 24 : 16;
      for (const line of wrapPdfLine(title, layout.titleCharacters)) {
        pages[pages.length - 1].push(
          `BT /F2 ${titleSize} Tf ${textX(line, titleSize, page.alignment)} ${y} Td <${winAnsiHex(line)}> Tj ET`,
        );
        y -= titleSize + 8;
      }
      y -= isTitlePage ? 28 : 14;
    }

    const bodyFont = page.type === 'epigraph' ? 'F3' : 'F1';
    const bodySize = page.type === 'copyright' || page.type === 'colophon' ? 9 : 11;
    const bodyLines = page.content.replace(/\r\n?/g, '\n').split('\n')
      .flatMap((line) => line ? wrapPdfLine(line, layout.bodyCharacters) : ['']);
    for (const line of bodyLines) {
      if (!line) {
        y -= 12;
        continue;
      }
      if (y < layout.margin) {
        appendContinuationPage();
        y = layout.height - layout.margin;
      }
      pages[pages.length - 1].push(
        `BT /${bodyFont} ${bodySize} Tf ${textX(line, bodySize, page.alignment)} ${y} Td <${winAnsiHex(line)}> Tj ET`,
      );
      y -= 15;
    }
  };

  const frontBeforeContents = bookPages.filter((page) => page.section === 'before-contents');
  const frontAfterContents = bookPages.filter((page) => page.section === 'after-contents');
  const backMatter = bookPages.filter((page) => page.section === 'back-matter');
  frontBeforeContents.forEach(appendMatterPage);

  const contentsLineItems: { poemIndex: number; line: string; pageIndex: number; y: number; lastLine: boolean }[] = [];
  let contentsPageIndex = 0;
  let contentsY = layout.height - layout.margin - 35;
  const startContentsPage = () => {
    contentsPageIndex += 1;
    contentsY = layout.height - layout.margin - 35;
  };

  poems.forEach((poem, poemIndex) => {
    const title = poem.title.trim() || 'Untitled poem';
    const titleLines = wrapPdfLine(title, Math.max(1, layout.bodyCharacters - 8));
    titleLines.forEach((line, lineIndex) => {
      if (contentsY < layout.margin) startContentsPage();
      contentsLineItems.push({
        poemIndex,
        line,
        pageIndex: contentsPageIndex,
        y: contentsY,
        lastLine: lineIndex === titleLines.length - 1,
      });
      contentsY -= 15;
    });
    contentsY -= 8;
  });

  const contentsPageCount = contentsPageIndex + 1;
  const contentsPageIndexes: number[] = [];
  for (let pageIndex = 0; pageIndex < contentsPageCount; pageIndex += 1) {
    const pageNumber = appendPage(pageIndex === 0 ? 'recto' : 'either');
    contentsPageIndexes.push(pageNumber);
    const commands = pages[pageNumber];
    const heading = pageIndex === 0 ? 'Contents' : 'Contents (continued)';
    commands.push(`BT /F2 20 Tf ${layout.margin} ${layout.height - layout.margin} Td <${winAnsiHex(heading)}> Tj ET`);
  }

  frontAfterContents.forEach(appendMatterPage);

  poems.forEach((poem, poemIndex) => {
    appendPage(poemIndex === 0 ? 'recto' : 'either');
    poemStartPages.push(pages.length - 1);
    let y = layout.height - layout.margin;
    const addPage = () => {
      appendContinuationPage();
      y = layout.height - layout.margin;
    };
    const addText = (value: string, font: 'F1' | 'F2', size: number) => {
      pages[pages.length - 1].push(`BT /${font} ${size} Tf ${layout.margin} ${y} Td <${winAnsiHex(value)}> Tj ET`);
    };
    for (const line of wrapPdfLine(bookTitle.trim() || 'Untitled book', layout.bodyCharacters)) {
      if (y < layout.margin + 12) addPage();
      addText(line, 'F1', 9);
      y -= 12;
    }
    if (y - 12 < layout.margin) addPage();
    y -= 12;
    for (const line of wrapPdfLine(poem.title.trim() || 'Untitled poem', layout.titleCharacters)) {
      if (y < layout.margin + 20) addPage();
      addText(line, 'F2', 20);
      y -= 25;
    }
    if (y - 12 < layout.margin) addPage();
    y -= 12;
    const paragraphs = getEditorParagraphs(poem.editorHtml, poem.text);
    for (const paragraph of paragraphs) {
      const paragraphLines = splitPdfParagraphLines(paragraph.runs);
      if (paragraphLines.every((line) => !line.length)) {
        if (y - 12 < layout.margin) addPage();
        y -= 12;
        continue;
      }
      const leftIndent = cssMeasureToPdfPoints(paragraph.left);
      const rightIndent = cssMeasureToPdfPoints(paragraph.right);
      const firstLineIndent = cssMeasureToPdfPoints(paragraph.firstLine);
      for (const [paragraphLineIndex, paragraphLine] of paragraphLines.entries()) {
        const isFirstParagraphLine = paragraphLineIndex === 0;
        const firstLineOffset = isFirstParagraphLine ? firstLineIndent : 0;
        const availableWidth = layout.contentWidth - leftIndent - rightIndent - firstLineOffset;
        const maxCharacters = Math.max(1, Math.floor(availableWidth / 5.5));
        const wrappedLines = wrapPdfRuns(paragraphLine, maxCharacters);
        for (const [wrappedLineIndex, lineRuns] of wrappedLines.entries()) {
          if (y < layout.margin) addPage();
          const lineLeft = layout.margin + leftIndent
            + (isFirstParagraphLine && wrappedLineIndex === 0 ? firstLineIndent : 0);
          const lineRight = layout.width - layout.margin - rightIndent;
          appendStyledPdfLine(
            pages[pages.length - 1],
            lineRuns,
            y,
            layout,
            paragraph.align,
            paragraph.align === 'justify' && wrappedLineIndex < wrappedLines.length - 1,
            lineLeft,
            lineRight,
          );
          y -= 15;
        }
      }
    }
  });

  backMatter.forEach(appendMatterPage);

  contentsLineItems.forEach((item) => {
    const commands = pages[contentsPageIndexes[item.pageIndex]];
    commands.push(`BT /F1 11 Tf ${layout.margin} ${item.y} Td <${winAnsiHex(item.line)}> Tj ET`);
    if (item.lastLine) {
      const pageNumber = poemStartPages[item.poemIndex] + 1;
      const pageNumberX = layout.width - layout.margin - approximatePdfTextWidth(String(pageNumber), 11);
      commands.push(
        `BT /F1 11 Tf ${pageNumberX} ${item.y} Td <${winAnsiHex(String(pageNumber))}> Tj ET`,
      );
    }
  });

  return assemblePdf(bookTitle, pages, options);
}

export function serializePoemPdf(
  title: string,
  text: string,
  editorHtml?: string,
  options: PdfExportOptions = defaultPdfExportOptions,
) {
  return new Blob([buildPdf(title, text, editorHtml, options)], { type: 'application/pdf' });
}

export function serializeBookPdf(
  bookTitle: string,
  poems: { title: string; text: string; editorHtml?: string }[],
  options: PdfExportOptions = defaultPdfExportOptions,
  bookPages: BookMatterPage[] = [],
) {
  if (!poems.length) throw new Error('Add at least one poem before downloading this book.');
  return new Blob([buildBookPdf(bookTitle, poems, options, bookPages)], { type: 'application/pdf' });
}

export function downloadPoemFile(fileName: string, content: string | Blob, format: DownloadablePoemFileFormat) {
  const mimeTypes: Record<DownloadablePoemFileFormat, string> = {
    txt: 'text/plain;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    html: 'text/html;charset=utf-8',
    rtf: 'application/rtf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text',
    pdf: 'application/pdf',
  };
  const blob = content instanceof Blob ? content : new Blob([content], { type: mimeTypes[format] });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function writePoemFile(
  handle: WritablePoemFileHandle,
  content: Blob | string,
): Promise<void> {
  const permissionOptions = { mode: 'readwrite' as const };
  let permission = await handle.queryPermission?.(permissionOptions);
  if (permission !== 'granted' && handle.requestPermission) {
    permission = await handle.requestPermission(permissionOptions);
  }
  if (permission && permission !== 'granted') {
    throw new Error('Allow file access in your browser to save changes to this file.');
  }

  const writable = await handle.createWritable();
  try {
    await writable.write(content);
  } finally {
    await writable.close();
  }
}

export async function choosePoemFile(): Promise<WritablePoemFileHandle | null> {
  const pickerWindow = window as Window & {
    showOpenFilePicker?: (options: {
      multiple: boolean;
      types: { description: string; accept: Record<string, string[]> }[];
    }) => Promise<WritablePoemFileHandle[]>;
  };
  if (!pickerWindow.showOpenFilePicker) return null;
  const handles = await pickerWindow.showOpenFilePicker({
    multiple: false,
    types: [{
      description: 'Poem files',
      accept: {
        'text/plain': ['.txt'],
        'text/markdown': ['.md', '.markdown'],
        'text/html': ['.html', '.htm'],
        'application/rtf': ['.rtf'],
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        'application/vnd.oasis.opendocument.text': ['.odt'],
      },
    }],
  });
  return handles[0] || null;
}
