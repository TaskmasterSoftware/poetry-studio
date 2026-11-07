import {
  readDocx, readOdt, readRtf, serializeDocx, serializeOdt, serializeRtf,
} from './document-import';

export type WritablePoemFileFormat = 'txt' | 'md' | 'html' | 'rtf' | 'docx' | 'odt';
export type PoemFileFormat = WritablePoemFileFormat;

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

export function downloadPoemFile(fileName: string, content: string | Blob, format: WritablePoemFileFormat) {
  const mimeTypes: Record<WritablePoemFileFormat, string> = {
    txt: 'text/plain;charset=utf-8',
    md: 'text/markdown;charset=utf-8',
    html: 'text/html;charset=utf-8',
    rtf: 'application/rtf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    odt: 'application/vnd.oasis.opendocument.text',
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
