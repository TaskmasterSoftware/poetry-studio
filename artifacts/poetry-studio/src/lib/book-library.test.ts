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
import type { BrowserPoemDraft } from "./poem-files";

Object.defineProperty(globalThis, "DOMParser", { value: XmlDomParser, configurable: true });
Object.defineProperty(globalThis, "Node", {
  value: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
  configurable: true,
});

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
    },
    { id: "poem-2", title: "Second", editorHtml: "<p>Quiet</p>", source: null },
  ];
  const serialized = serializeBookBundle("Night poems", poems);
  const imported = await readBookBundle(new File([serialized], "night.poetrybook"));

  assert.equal(imported.title, "Night poems");
  assert.deepEqual(imported.poems.map((poem) => poem.title), ["First", "Second"]);
  assert.match(imported.poems[0].editorHtml, /style="text-align:center"/);
  assert.match(imported.poems[0].editorHtml, /<strong>Bright<\/strong>/);
  assert.doesNotMatch(imported.poems[0].editorHtml, /onclick|script|color:red/i);
});

test("book file import rejects incompatible versions and empty books", async () => {
  const unsupported = new File([JSON.stringify({
    format: "poetry-studio-book",
    version: 2,
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

  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 2);
  assert.match(pdf, /\/Count 2/);
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
  assert.equal(Number(pdf.match(/\/Count (\d+)/)?.[1]), 2);
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
