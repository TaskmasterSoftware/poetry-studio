import { readDocx, readOdt, readRtf } from './document-import';

export type WritablePoemFileFormat = 'txt' | 'md' | 'html';
export type PoemFileFormat = WritablePoemFileFormat | 'rtf' | 'docx' | 'odt';

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
  fileName: string;
  format: PoemFileFormat;
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

function fileFormat(fileName: string): PoemFileFormat {
  const extension = fileName.split('.').pop()?.toLowerCase() || '';
  const format = supportedFormats[extension];
  if (!format) throw new Error('Choose a .txt, .md, .html, .rtf, .docx, or .odt poem file.');
  return format;
}

export function isWritablePoemFileFormat(format: PoemFileFormat): format is WritablePoemFileFormat {
  return format === 'txt' || format === 'md' || format === 'html';
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

function htmlToText(source: string) {
  const parsed = new DOMParser().parseFromString(source, 'text/html');
  const root = parsed.querySelector('article, main') || parsed.body;
  const heading = root.querySelector('h1, h2');
  const title = heading?.textContent?.trim() || parsed.title.trim();
  const content = Array.from(root.childNodes)
    .filter((node) => node !== heading)
    .map(textFromHtmlNode)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\n+$/, '');
  return { title, text: content };
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
  let extracted: { title: string; text: string };

  if (format === 'docx') {
    extracted = await readDocx(file);
  } else if (format === 'odt') {
    extracted = await readOdt(file);
  } else {
    const source = await file.text();
    if (format === 'rtf') {
      extracted = readRtf(source);
    } else if (format === 'html') {
      extracted = htmlToText(source);
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
    fileName: file.name,
    format,
  };
}

export function poemTextToEditorHtml(text: string) {
  return text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
    .join('');
}

export function serializePoem(title: string, text: string, format: WritablePoemFileFormat) {
  if (format === 'txt') return `${title}\n\n${text}`;
  if (format === 'md') return `# ${title}\n\n${text}`;
  const paragraphs = text.replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>')
    .join('');
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><article><h1>${escapeHtml(title)}</h1>${paragraphs}</article></body></html>`;
}

export function downloadPoemFile(fileName: string, content: string, format: WritablePoemFileFormat) {
  const mimeType = format === 'html' ? 'text/html' : format === 'md' ? 'text/markdown' : 'text/plain';
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function writePoemFile(
  handle: WritablePoemFileHandle,
  content: string,
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
