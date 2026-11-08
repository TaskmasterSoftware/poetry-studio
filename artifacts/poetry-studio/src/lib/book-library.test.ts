import assert from "node:assert/strict";
import { test } from "node:test";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import {
  normalizeBookLibrary,
  readBookBundle,
  sanitizeBookEditorHtml,
  serializeBookBundle,
} from "./book-library";
import { serializeBookPdf } from "./poem-files";
import { emptyPoemMetadata } from "./poem-files";
import type { BrowserPoemDraft } from "./poem-files";
import type { BookMatterPage } from "./book-pages";

Object.defineProperty(globalThis, "DOMParser", { value: XmlDomParser, configurable: true });
Object.defineProperty(globalThis, "Node", {
  value: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  configurable: true,
});

function pdfPageText(pdf: string) {
  const contentByObject = new Map<number, string>();
  for (const match of pdf.matchAll(/(\d+) 0 obj\n<< \/Length \d+ >>\nstream\n([\s\S]*?)endstream\nendobj/g)) {
    contentByObject.set(Number(match[1]), match[2]);
  }
  return Array.from(pdf.matchAll(/\/Type \/Page \/Parent 2 0 R [\s\S]*?\/Contents (\d+) 0 R >>/g), (match) => {
    const stream = contentByObject.get(Number(match[1])) || "";
    return Array.from(stream.matchAll(/<([0-9A-F]+)> Tj/g), (text) => Buffer.from(text[1], "hex").toString("latin1")).join("|");
  });
}

test("migrates existing drafts into a default book and keeps valid book assignments", () => {
  const drafts: BrowserPoemDraft[] = [
    { id: "poem-1", title: "First", editorHtml: "<p>One</p>", source: null },
    { id: "poem-2", title: "Second", editorHtml: "<p>Two</p>", source: null, bookId: "book-2" },
  ];
  const library = normalizeBookLibrary(
    [{ id: "book-2", title: "Harbor poems", createdAt: "2026-11-07T12:00:00.000Z" }],
    drafts,
    "poem-2",
    () => "unused-book-id",
  );

  assert.equal(library.books[0].title, "Harbor poems");
  assert.equal(library.drafts[0].bookId, "book-2");
  assert.equal(library.drafts[1].bookId, "book-2");
  assert.equal(library.activeBookId, "book-2");
});

test("creates a default book when no saved books exist", () => {
  const library = normalizeBookLibrary(
    [],
    [{ id: "poem-1", title: "First", editorHtml: "<p>One</p>", source: null }],
    "poem-1",
    () => "new-book",
  );

  assert.deepEqual(library.books.map((book) => book.title), ["My Poems"]);
  assert.equal(library.drafts[0].bookId, "new-book");
  assert.equal(library.activeBookId, "new-book");
});

test("book bundle keeps poem order and safe formatting while removing unsafe HTML", async () => {
  const poems: BrowserPoemDraft[] = [
    {
      id: "poem-1",
      title: "First",
      editorHtml: '<p style="text-align: center; color: red" onclick="bad()"><strong>Bright</strong><script>bad()</script></p>',
      source: null,
      metadata: {
        ...emptyPoemMetadata(),
        dateWritten: "2025-03-10",
        form: "Ghazal",
        tags: ["winter"],
        notes: "A private note",
        submissions: [
          { id: "sub-1", publisher: "North Review", websiteUrl: "https://north.example", submittedAt: "2025-04-01", status: "rejected", responseDate: "2025-05-01", notes: "Try again later." },
          { id: "sub-2", publisher: "North Review", websiteUrl: "https://north.example", submittedAt: "2025-06-01", status: "pending", responseDate: "", notes: "" },
        ],
      },
    },
    { id: "poem-2", title: "Second", editorHtml: "<p>Quiet</p>", source: null },
  ];
  const pages: BookMatterPage[] = [{
    id: "title-page",
    type: "title-page",
    section: "before-contents",
    side: "recto",
    title: "Night poems",
    content: "By Example Poet",
    alignment: "center",
  }];
  const serialized = serializeBookBundle("Night poems", poems, pages);
  const imported = await readBookBundle(new File([serialized], "night.poetrybook"));

  assert.equal(imported.title, "Night poems");
  assert.deepEqual(imported.pages, pages);
  assert.equal(JSON.parse(serialized).version, 2);
  assert.deepEqual(imported.poems.map((poem) => poem.title), ["First", "Second"]);
  assert.match(imported.poems[0].editorHtml, /style="text-align:center"/);
  assert.match(imported.poems[0].editorHtml, /<strong>Bright<\/strong>/);
  assert.deepEqual(imported.poems[0].metadata, poems[0].metadata);
  assert.doesNotMatch(imported.poems[0].editorHtml, /onclick|script|color:red/i);
});

test("imports older book files with empty poem metadata", async () => {
  const file = new File([JSON.stringify({
    format: "poetry-studio-book",
    version: 1,
    book: { title: "Older book" },
    poems: [{ title: "First", editorHtml: "<p>One</p>", source: null }],
  })], "older.poetrybook");
  const imported = await readBookBundle(file);

  assert.deepEqual(imported.poems[0].metadata, emptyPoemMetadata());
  assert.deepEqual(imported.pages, []);
});

test("book file import rejects incompatible versions and empty books", async () => {
  const unsupported = new File([JSON.stringify({
    format: "poetry-studio-book",
    version: 3,
    book: { title: "Test" },
    poems: [{ title: "Line", editorHtml: "<p>Line</p>" }],
  })], "future.poetrybook");
  const empty = new File([JSON.stringify({
    format: "poetry-studio-book",
    version: 1,
    book: { title: "Empty" },
    poems: [],
  })], "empty.poetrybook");

  await assert.rejects(readBookBundle(unsupported), /unsupported version/i);
  await assert.rejects(readBookBundle(empty), /does not contain any poems/i);
});

test("book PDF starts each poem on a separate page", async () => {
  const pdf = await serializeBookPdf("Night poems", [
    { title: "First", text: "One line" },
    { title: "Second", text: "Another line" },
  ]).text();
  const pages = pdfPageText(pdf);

  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 4);
  assert.match(pdf, /\/Count 4/);
  assert.match(pages[0], /Contents\|First\|3\|Second\|4/);
  assert.equal(pages[1], "");
  assert.match(pages[2], /First/);
  assert.match(pages[3], /Second/);
});

test("book contents page numbers account for poems that span multiple pages", async () => {
  const longPoem = Array.from({ length: 70 }, (_, index) => `Line ${index + 1}`).join("\n");
  const pdf = await serializeBookPdf("Night poems", [
    { title: "Long poem", text: longPoem },
    { title: "Short poem", text: "A brief ending" },
  ]).text();
  const pages = pdfPageText(pdf);

  assert.match(pages[0], /Contents\|Long poem\|3\|Short poem\|5/);
  assert.equal(pages[1], "");
  assert.match(pages[2], /Long poem/);
  assert.match(pages[3], /Line 70/);
  assert.match(pages[4], /Short poem/);
});

test("book contents page numbers include every contents page", async () => {
  const poems = Array.from({ length: 50 }, (_, index) => ({
    title: `Poem ${index + 1}`,
    text: `Line ${index + 1}`,
  }));
  const pdf = await serializeBookPdf("Night poems", poems).text();
  const pages = pdfPageText(pdf);

  assert.match(pages[0], /Contents/);
  assert.match(pages[1], /Contents \(continued\)/);
  assert.match(pages[0], /Poem 1\|3/);
  assert.match(pages[1], /Poem 50\|52/);
  assert.match(pages[2], /Poem 1/);
  assert.match(pages[51], /Poem 50/);
});

test("book PDF preserves saved emphasis and alignment without styling plain entries", async () => {
  const pdf = await serializeBookPdf("Night poems", [
    {
      title: "Styled",
      text: "Bold Italic\nRight",
      editorHtml: '<p style="text-align:center"><strong>Bold</strong> <em>Italic</em></p><p style="text-align:right">Right</p>',
    },
    { title: "Unstyled", text: "Plain\nline" },
  ]).text();

  assert.match(pdf, /BT \/F2 11 Tf/);
  assert.match(pdf, /BT \/F3 11 Tf/);
  assert.match(pdf, /BT \/F1 11 Tf 0 Tw 512\.5 644 Td <5269676874>/);
  assert.match(pdf, /BT \/F1 11 Tf 0 Tw 72 659 Td <506C61696E>/);
  assert.equal(Number(pdf.match(/\/Count (\d+)/)?.[1]), 4);
});

test("book pages honor recto and verso placement and count inserted blanks in the contents", async () => {
  const pages: BookMatterPage[] = [
    {
      id: "title-page",
      type: "title-page",
      section: "before-contents",
      side: "recto",
      title: "A Small Book",
      content: "By Example Poet",
      alignment: "center",
    },
    {
      id: "copyright",
      type: "copyright",
      section: "before-contents",
      side: "verso",
      title: "Copyright",
      content: "Copyright 2026",
      alignment: "left",
    },
  ];
  const pdf = await serializeBookPdf("A Small Book", [{ title: "First poem", text: "First line" }], undefined, pages).text();
  const physicalPages = pdfPageText(pdf);

  assert.equal(physicalPages.length, 5);
  assert.match(physicalPages[0], /A Small Book/);
  assert.match(physicalPages[1], /Copyright/);
  assert.match(physicalPages[2], /Contents\|First poem\|5/);
  assert.equal(physicalPages[3], "");
  assert.match(physicalPages[4], /First poem/);
});

test("book HTML sanitizer removes active content and preserves supported style", () => {
  const sanitized = sanitizeBookEditorHtml(
    '<p style="text-align:center; font-family:Georgia, serif; font-size:12pt; background-image:url(javascript:bad())" onmouseover="bad()"><span style=\'font-family:"Palatino Linotype", Palatino, serif; font-size:14pt\'><em>Line</em></span><iframe src="evil"></iframe></p>',
  );
  assert.match(sanitized, /style="text-align:center;font-family:georgia, serif;font-size:12pt"/);
  assert.match(sanitized, /font-family:&quot;palatino linotype&quot;, palatino, serif;font-size:14pt/);
  assert.match(sanitized, /<em>Line<\/em>/);
  assert.doesNotMatch(sanitized, /javascript|onmouseover|iframe/i);
});
