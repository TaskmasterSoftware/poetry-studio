import {
  readDocx, readOdt, readRtf, serializeDocx, serializeOdt, serializeRtf,
} from './document-import';

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

export interface BrowserPoemDraft {
  id: string;
  title: string;
  editorHtml: string;
  source: SavedPoemSource | null;
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

export function isBrowserPoemDraft(value: unknown): value is BrowserPoemDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<BrowserPoemDraft>;
  return typeof draft.id === 'string'
    && draft.id.length > 0
    && typeof draft.title === 'string'
    && typeof draft.editorHtml === 'string'
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
  'H5', 'H6', 'I', 'INS', 'LI', 'MARK', 'OL', 'P', 'PRE', 'S', 'STRIKE',
  'STRONG', 'SUB', 'SUP', 'U', 'UL',
]);
const droppedHtmlTags = new Set([
  'IFRAME', 'NOSCRIPT', 'OBJECT', 'SCRIPT', 'STYLE', 'SVG', 'TEMPLATE',
]);

function safeEditorNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || '');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const element = node as HTMLElement;
  if (droppedHtmlTags.has(element.tagName)) return '';
  const children = Array.from(element.childNodes).map(safeEditorNode).join('');
  if (!safeEditorTags.has(element.tagName)) return children;
  const tag = element.tagName.toLowerCase();
  if (tag === 'br') return '<br>';
  return `<${tag}>${children}</${tag}>`;
}

function sanitizeEditorHtml(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  return Array.from(parsed.body.childNodes).map(safeEditorNode).join('');
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

function htmlToEditorContent(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const root = parsed.querySelector('article, main') || parsed.body;
  const contentRoot = root.cloneNode(true) as HTMLElement;
  const heading = contentRoot.querySelector('h1, h2');
  const title = (heading ? textFromHtmlNode(heading) : '').trim() || parsed.title.trim();
  heading?.remove();
  const editorHtml = Array.from(contentRoot.childNodes).map(safeEditorNode).join('');
  const safeContent = new DOMParser().parseFromString(editorHtml, 'text/html').body;
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

export function serializePoem(title: string, text: string, format: WritablePoemFileFormat, editorHtml?: string): string | Blob {
  if (format === 'txt') return `${title}\n\n${text}`;
  if (format === 'md') return `# ${title}\n\n${text}`;
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

function buildPdf(title: string, text: string) {
  const pages: string[][] = [[]];
  let y = 720;
  const addPage = () => {
    pages.push([]);
    y = 720;
  };
  const addText = (value: string, font: 'F1' | 'F2', size: number) => {
    pages[pages.length - 1].push(`BT /${font} ${size} Tf 72 ${y} Td <${winAnsiHex(value)}> Tj ET`);
  };

  const titleLines = wrapPdfLine(title.trim() || 'Untitled poem', 42);
  for (const line of titleLines) {
    addText(line, 'F2', 20);
    y -= 25;
  }
  y -= 12;

  for (const sourceLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!sourceLine) {
      y -= 12;
      continue;
    }
    for (const line of wrapPdfLine(sourceLine, 88)) {
      if (y < 72) addPage();
      addText(line, 'F1', 11);
      y -= 15;
    }
  }

  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  pages.forEach((commands, index) => {
    const pageNumber = 5 + index * 2;
    const contentNumber = pageNumber + 1;
    const stream = `${commands.join('\n')}\n`;
    objects[pageNumber] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`;
    objects[contentNumber] = `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
  });

  const infoNumber = objects.length;
  objects[infoNumber] = `<< /Title <${pdfUnicodeHex(title.trim() || 'Untitled poem')}> /Producer (Poetry Studio) >>`;
  let pdf = '%PDF-1.4\n%Poetry Studio\n';
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

export function serializePoemPdf(title: string, text: string) {
  return new Blob([buildPdf(title, text)], { type: 'application/pdf' });
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
