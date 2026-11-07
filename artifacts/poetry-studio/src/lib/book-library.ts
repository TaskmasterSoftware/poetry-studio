import { isSavedPoemSource, type BrowserPoemDraft, type SavedPoemSource } from "./poem-files";

export interface BrowserPoemBook {
  id: string;
  title: string;
  createdAt: string;
}

export interface BookShelfPoem {
  title: string;
  editorHtml: string;
  source: SavedPoemSource | null;
}

export interface ImportedPoemBook {
  title: string;
  poems: BookShelfPoem[];
}

const bookBundleFormat = "poetry-studio-book";
const bookBundleVersion = 1;
const maxBookBundleBytes = 25 * 1024 * 1024;
const allowedTags = new Set([
  "B", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3",
  "H4", "H5", "H6", "I", "INS", "LI", "MARK", "OL", "P", "PRE", "S",
  "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "U", "UL",
]);
const droppedTags = new Set(["IFRAME", "OBJECT", "SCRIPT", "STYLE", "SVG", "TEMPLATE"]);

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] || character);
}

function safeMeasure(value: string) {
  const match = value.trim().match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(px|pt|em|rem|ch|%)$/i);
  if (!match || Math.abs(Number(match[1])) > 2000) return "";
  return `${Number(match[1])}${match[2].toLowerCase()}`;
}

const safeFontFamilies = new Set([
  "georgia, serif",
  "\"palatino linotype\", palatino, serif",
  "\"times new roman\", times, serif",
  "arial, helvetica, sans-serif",
  "verdana, geneva, sans-serif",
  "\"courier new\", courier, monospace",
  "\"trebuchet ms\", sans-serif",
]);

function safeStyle(value: string) {
  const declarations: string[] = [];
  for (const declaration of value.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 1) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const rawValue = declaration.slice(separator + 1).trim().toLowerCase();
    let normalized = "";
    if (property === "text-align" && ["left", "right", "center", "justify", "start", "end"].includes(rawValue)) {
      normalized = rawValue;
    } else if (["margin-left", "margin-right", "text-indent"].includes(property)) {
      normalized = safeMeasure(rawValue);
    } else if (property === "font-weight" && /^(normal|bold|[1-9]00)$/.test(rawValue)) {
      normalized = rawValue;
    } else if (property === "font-style" && /^(normal|italic|oblique)$/.test(rawValue)) {
      normalized = rawValue;
    } else if (property === "text-decoration" && /^(none|underline|line-through|underline line-through)$/.test(rawValue)) {
      normalized = rawValue;
    } else if (property === "vertical-align" && /^(baseline|super|sub)$/.test(rawValue)) {
      normalized = rawValue;
    } else if (property === "font-size" && safeMeasure(rawValue)) {
      normalized = safeMeasure(rawValue);
    } else if (property === "font-family" && safeFontFamilies.has(rawValue)) {
      normalized = rawValue;
    }
    if (normalized) declarations.push(`${property}:${normalized}`);
  }
  return declarations.join(";");
}

function safeBookNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent || "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  const tagName = element.tagName.toUpperCase();
  if (droppedTags.has(tagName)) return "";
  const children = Array.from(element.childNodes).map(safeBookNode).join("");
  if (!allowedTags.has(tagName)) return children;

  const attributes: string[] = [];
  const style = safeStyle(element.getAttribute("style") || "");
  if (style) attributes.push(`style="${escapeHtml(style)}"`);
  if (tagName === "OL") {
    const start = element.getAttribute("start") || "";
    if (/^\d{1,6}$/.test(start)) attributes.push(`start="${start}"`);
  }
  if (tagName === "LI") {
    const value = element.getAttribute("value") || "";
    if (/^\d{1,6}$/.test(value)) attributes.push(`value="${value}"`);
  }
  const tag = tagName.toLowerCase();
  if (tag === "br") return "<br>";
  return `<${tag}${attributes.length ? ` ${attributes.join(" ")}` : ""}>${children}</${tag}>`;
}

export function sanitizeBookEditorHtml(source: string) {
  const parsed = new DOMParser().parseFromString(source, "text/html");
  if (parsed.body) return Array.from(parsed.body.childNodes).map(safeBookNode).join("");
  if (parsed.documentElement) return safeBookNode(parsed.documentElement);
  return escapeHtml(source);
}

export function isBrowserPoemBook(value: unknown): value is BrowserPoemBook {
  if (!value || typeof value !== "object") return false;
  const book = value as Partial<BrowserPoemBook>;
  return typeof book.id === "string"
    && book.id.length > 0
    && typeof book.title === "string"
    && typeof book.createdAt === "string"
    && Number.isFinite(Date.parse(book.createdAt));
}

export function normalizeBookLibrary(
  savedBooks: unknown,
  drafts: BrowserPoemDraft[],
  activeDraftId: string,
  createId: () => string,
): { books: BrowserPoemBook[]; drafts: BrowserPoemDraft[]; activeBookId: string } {
  const uniqueBooks = new Map<string, BrowserPoemBook>();
  if (Array.isArray(savedBooks)) {
    for (const value of savedBooks) {
      if (isBrowserPoemBook(value) && !uniqueBooks.has(value.id)) uniqueBooks.set(value.id, value);
    }
  }
  if (!uniqueBooks.size) {
    const book = { id: createId(), title: "My Poems", createdAt: new Date().toISOString() };
    uniqueBooks.set(book.id, book);
  }
  const books = Array.from(uniqueBooks.values());
  const bookIds = new Set(books.map((book) => book.id));
  const defaultBookId = books[0].id;
  const normalizedDrafts = drafts.map((draft) => ({
    ...draft,
    bookId: draft.bookId && bookIds.has(draft.bookId) ? draft.bookId : defaultBookId,
  }));
  const activeBookId = normalizedDrafts.find((draft) => draft.id === activeDraftId)?.bookId ?? defaultBookId;
  return { books, drafts: normalizedDrafts, activeBookId };
}

export function serializeBookBundle(bookTitle: string, drafts: BrowserPoemDraft[]) {
  if (!drafts.length) throw new Error("Add at least one poem before exporting this book.");
  const bundle = {
    format: bookBundleFormat,
    version: bookBundleVersion,
    book: { title: bookTitle.trim() || "Untitled book" },
    poems: drafts.map((draft) => ({
      title: draft.title,
      editorHtml: sanitizeBookEditorHtml(draft.editorHtml),
      source: isSavedPoemSource(draft.source) ? draft.source : null,
    })),
  };
  return JSON.stringify(bundle, null, 2);
}

export async function readBookBundle(file: File): Promise<ImportedPoemBook> {
  if (file.size > maxBookBundleBytes) {
    throw new Error("This book file is larger than 25 MB. Export a smaller book and try again.");
  }

  let bundle: unknown;
  try {
    bundle = JSON.parse((await file.text()).replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("This is not a valid Poetry Studio book file.");
  }
  if (!bundle || typeof bundle !== "object") throw new Error("This is not a valid Poetry Studio book file.");
  const value = bundle as {
    format?: unknown;
    version?: unknown;
    book?: { title?: unknown };
    poems?: unknown;
  };
  if (value.format !== bookBundleFormat || value.version !== bookBundleVersion) {
    throw new Error("This book file was created by an unsupported version of Poetry Studio.");
  }
  if (typeof value.book?.title !== "string" || !Array.isArray(value.poems)) {
    throw new Error("This Poetry Studio book file is missing its title or poem list.");
  }
  if (value.poems.length === 0) throw new Error("This book file does not contain any poems.");
  if (value.poems.length > 1000) throw new Error("This book contains too many poems to import at once.");

  const poems = value.poems.map((entry): BookShelfPoem => {
    if (!entry || typeof entry !== "object") throw new Error("This book contains a poem with invalid data.");
    const poem = entry as { title?: unknown; editorHtml?: unknown; source?: unknown };
    if (typeof poem.title !== "string" || typeof poem.editorHtml !== "string") {
      throw new Error("This book contains a poem without a title or manuscript.");
    }
    return {
      title: poem.title,
      editorHtml: sanitizeBookEditorHtml(poem.editorHtml),
      source: isSavedPoemSource(poem.source) ? poem.source : null,
    };
  });

  return { title: value.book.title.trim() || "Untitled book", poems };
}

export function downloadBookBundle(bookTitle: string, content: string) {
  const slug = bookTitle.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const url = URL.createObjectURL(new Blob([content], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slug || "poetry-book"}.poetrybook`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
