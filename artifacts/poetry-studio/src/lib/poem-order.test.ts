import assert from "node:assert/strict";
import { test } from "node:test";
import { reorderPoemsInBook } from "./poem-order";
import type { BrowserPoemDraft } from "./poem-files";
import { serializeBookPdf } from "./poem-files";

const interleavedDrafts: BrowserPoemDraft[] = [
  { id: "a1", title: "A one", editorHtml: "<p>A1</p>", source: null, bookId: "book-a" },
  { id: "b1", title: "B one", editorHtml: "<p>B1</p>", source: null, bookId: "book-b" },
  { id: "a2", title: "A two", editorHtml: "<p>A2</p>", source: null, bookId: "book-a" },
  { id: "b2", title: "B two", editorHtml: "<p>B2</p>", source: null, bookId: "book-b" },
  { id: "a3", title: "A three", editorHtml: "<p>A3</p>", source: null, bookId: "book-a" },
];

test("reorders poems inside one book without changing other books or poem data", () => {
  const reordered = reorderPoemsInBook(interleavedDrafts, "a3", "up");

  assert.deepEqual(
    reordered.filter((draft) => draft.bookId === "book-a").map((draft) => draft.id),
    ["a1", "a3", "a2"],
  );
  assert.deepEqual(
    reordered.filter((draft) => draft.bookId === "book-b").map((draft) => draft.id),
    ["b1", "b2"],
  );
  assert.equal(reordered.find((draft) => draft.id === "a3")?.editorHtml, "<p>A3</p>");
});

test("book PDF follows the reordered poem sequence", async () => {
  const reordered = reorderPoemsInBook(interleavedDrafts, "a3", "up");
  const bookPoems = reordered
    .filter((draft) => draft.bookId === "book-a")
    .map((draft) => ({ title: draft.title, text: draft.title }));
  const pdf = await serializeBookPdf("Book A", bookPoems).text();
  const firstTitle = `<${Buffer.from("A three", "latin1").toString("hex").toUpperCase()}> Tj`;
  const secondTitle = `<${Buffer.from("A two", "latin1").toString("hex").toUpperCase()}> Tj`;

  assert.ok(pdf.indexOf(firstTitle) >= 0);
  assert.ok(pdf.indexOf(firstTitle) < pdf.indexOf(secondTitle));
});

test("returns the original list when a poem is already at that edge", () => {
  assert.equal(reorderPoemsInBook(interleavedDrafts, "a1", "up"), interleavedDrafts);
  assert.equal(reorderPoemsInBook(interleavedDrafts, "a3", "down"), interleavedDrafts);
  assert.equal(reorderPoemsInBook(interleavedDrafts, "missing", "up"), interleavedDrafts);
});
