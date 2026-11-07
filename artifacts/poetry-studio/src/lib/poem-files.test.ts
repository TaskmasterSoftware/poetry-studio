import assert from "node:assert/strict";
import { after, test } from "node:test";
import { DOMParser as XmlDomParser } from "@xmldom/xmldom";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  appendBrowserPoemRevision, choosePoemFile, downloadPoemFile, isBrowserPoemDraft, isBrowserPoemRevision, isSavedPoemSource, readPoemFile, removeBrowserPoemDraft,
  restoreBrowserPoemDraft, serializeBookPdf, serializePoem, serializePoemPdf, writePoemFile,
  type WritablePoemFileHandle,
} from "./poem-files";
import { readRtf } from "./document-import";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalDomParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
const originalNode = Object.getOwnPropertyDescriptor(globalThis, "Node");
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (originalDomParser) Object.defineProperty(globalThis, "DOMParser", originalDomParser);
  else Reflect.deleteProperty(globalThis, "DOMParser");
  if (originalNode) Object.defineProperty(globalThis, "Node", originalNode);
  else Reflect.deleteProperty(globalThis, "Node");
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
});

function enableXmlDom() {
  Object.defineProperty(globalThis, "DOMParser", { configurable: true, value: XmlDomParser });
  Object.defineProperty(globalThis, "Node", {
    configurable: true,
    value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
  });
}

function poemCounts(text: string) {
  return {
    lines: text.split("\n").filter((line) => line.trim()).length,
    words: text.match(/\b[\w’'-]+\b/g)?.length || 0,
  };
}

test("validates saved filename and format metadata before restoring it", () => {
  assert.equal(isSavedPoemSource({ fileName: "night-poem.docx", format: "docx" }), true);
  assert.equal(isSavedPoemSource({ fileName: "   ", format: "docx" }), false);
  assert.equal(isSavedPoemSource({ fileName: "night-poem.docx", format: "exe" }), false);
  assert.equal(isSavedPoemSource(null), false);
});

test("validates browser drafts and keeps imported source metadata attached", () => {
  const importedDraft = {
    id: "draft-night",
    title: "Night poem",
    editorHtml: "<p>First line</p>",
    source: { fileName: "night-poem.docx", format: "docx" },
  };
  assert.equal(isBrowserPoemDraft(importedDraft), true);
  assert.equal(isBrowserPoemDraft({ ...importedDraft, source: { fileName: "notes.exe", format: "exe" } }), false);
  assert.equal(isBrowserPoemDraft({ ...importedDraft, source: null }), true);
  assert.equal(isBrowserPoemDraft({ ...importedDraft, editorHtml: 4 }), false);
});

test("removes only the selected browser draft", () => {
  const drafts = [
    { id: "draft-one", title: "First", editorHtml: "<p>First</p>", source: null },
    { id: "draft-two", title: "Second", editorHtml: "<p>Second</p>", source: null },
  ];

  assert.deepEqual(removeBrowserPoemDraft(drafts, "draft-one"), [drafts[1]]);
  assert.deepEqual(removeBrowserPoemDraft(drafts, "missing"), drafts);
});

test("validates and bounds local poem revision history", () => {
  const first = { id: "rev-1", title: "Before", editorHtml: "<p>First line</p>", createdAt: "2026-11-07T10:00:00.000Z" };
  const second = { id: "rev-2", title: "After", editorHtml: "<p>Second line</p>", createdAt: "2026-11-07T10:01:00.000Z" };

  assert.equal(isBrowserPoemRevision(first), true);
  assert.equal(isBrowserPoemRevision({ ...first, createdAt: "not a date" }), false);
  assert.deepEqual(appendBrowserPoemRevision([first], second, 1), [second]);
  assert.deepEqual(appendBrowserPoemRevision([second], { ...second, id: "rev-duplicate" }), [second]);
});

test("restoring a revision keeps the draft's original file format association", () => {
  const draft = {
    id: "draft-night",
    title: "Changed title",
    editorHtml: "<p>Changed manuscript</p>",
    source: { fileName: "night-poem.docx", format: "docx" as const },
  };
  const revision = {
    id: "rev-1",
    title: "Earlier title",
    editorHtml: "<p>Earlier manuscript</p>",
    createdAt: "2026-11-07T10:00:00.000Z",
  };

  assert.deepEqual(restoreBrowserPoemDraft(draft, revision), {
    ...draft,
    title: revision.title,
    editorHtml: revision.editorHtml,
  });
});

test("imports DOCX emphasis and paragraph layout without changing poem structure", async () => {
  enableXmlDom();
  const documentXml = `<?xml version="1.0"?>
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p><w:r><w:t>Night</w:t></w:r></w:p>
        <w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="360" w:firstLine="180"/></w:pPr>
          <w:r><w:t>First </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>bright</w:t></w:r>
          <w:r><w:br/></w:r><w:r><w:rPr><w:i/><w:u w:val="single"/></w:rPr><w:t>Second line</w:t></w:r>
        </w:p>
        <w:p/>
        <w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>Last line</w:t></w:r></w:p>
        <w:sectPr/>
      </w:body>
    </w:document>`;
  const archive = zipSync({
    "word/document.xml": strToU8(documentXml),
    "docProps/core.xml": strToU8('<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Night</dc:title></cp:coreProperties>'),
  });
  const poem = await readPoemFile(new File([archive], "night.docx"));

  assert.equal(poem.title, "Night");
  assert.equal(poem.text, "First bright\nSecond line\n\nLast line");
  assert.deepEqual(poemCounts(poem.text), { lines: 3, words: 6 });
  assert.match(poem.editorHtml || "", /text-align:center/);
  assert.match(poem.editorHtml || "", /margin-left:18pt/);
  assert.match(poem.editorHtml || "", /text-indent:9pt/);
  assert.match(poem.editorHtml || "", /<strong>bright<\/strong>/);
  assert.match(poem.editorHtml || "", /<em><u>Second line<\/u><\/em>/);
  assert.match(poem.editorHtml || "", /<p><br><\/p>/);
  assert.doesNotMatch(poem.editorHtml || "", /FF0000|<title/i);
});

test("imports ODT emphasis and styled paragraphs while keeping stanzas and line breaks", async () => {
  enableXmlDom();
  const contentXml = `<?xml version="1.0"?>
    <office:document-content
      xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
      xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
      xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
      xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"
      office:version="1.2">
      <office:automatic-styles>
        <style:style style:name="Pcenter" style:family="paragraph">
          <style:paragraph-properties fo:text-align="center" fo:margin-left="1in" fo:text-indent="12pt"/>
        </style:style>
        <style:style style:name="Tbold" style:family="text">
          <style:text-properties fo:font-weight="bold"/>
        </style:style>
        <style:style style:name="Titalic" style:family="text">
          <style:text-properties fo:font-style="italic"/>
        </style:style>
      </office:automatic-styles>
      <office:body><office:text>
        <text:p>Night</text:p>
        <text:p text:style-name="Pcenter"><text:span text:style-name="Tbold">First bright</text:span>
          <text:line-break/><text:span text:style-name="Titalic">Second line</text:span>
        </text:p>
        <text:p/>
        <text:p>Last line</text:p>
      </office:text></office:body>
    </office:document-content>`;
  const archive = zipSync({
    "content.xml": strToU8(contentXml),
    "meta.xml": strToU8('<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><office:meta><dc:title>Night</dc:title></office:meta></office:document-meta>'),
  });
  const poem = await readPoemFile(new File([archive], "night.odt"));

  assert.equal(poem.title, "Night");
  assert.equal(poem.text, "First bright\nSecond line\n\nLast line");
  assert.deepEqual(poemCounts(poem.text), { lines: 3, words: 6 });
  assert.match(poem.editorHtml || "", /text-align:center/);
  assert.match(poem.editorHtml || "", /margin-left:1in/);
  assert.match(poem.editorHtml || "", /text-indent:12pt/);
  assert.match(poem.editorHtml || "", /<strong>First bright<\/strong>/);
  assert.match(poem.editorHtml || "", /<em>Second line<\/em>/);
  assert.match(poem.editorHtml || "", /<p><br><\/p>/);
});

test("imports RTF emphasis, paragraph alignment, line breaks, and blank stanzas", async () => {
  const source = String.raw`{\rtf1\ansi{\info{\title Night}}\b Night\b0\par{\qc The {\b bold} and {\i italic} {\ul under} {\strike struck}\line second line}\par\pard\par{\qr Right}\par}`;
  const poem = await readPoemFile(new File([source], "night.rtf"));

  assert.equal(poem.title, "Night");
  assert.equal(poem.text, "The bold and italic under struck\nsecond line\n\nRight");
  assert.match(poem.editorHtml || "", /<p style="text-align:center">/);
  assert.match(poem.editorHtml || "", /<strong>bold<\/strong>/);
  assert.match(poem.editorHtml || "", /<em>italic<\/em>/);
  assert.match(poem.editorHtml || "", /<u>under<\/u>/);
  assert.match(poem.editorHtml || "", /<s>struck<\/s>/);
  assert.match(poem.editorHtml || "", /<br>second line/);
  assert.match(poem.editorHtml || "", /<p><br><\/p>/);
  assert.match(poem.editorHtml || "", /<p style="text-align:right">Right<\/p>/);
});

test("keeps plain RTF title, line breaks, and stanza spacing compatible", async () => {
  const source = String.raw`{\rtf1\ansi{\info{\title Plain}}\b Plain\b0\par First line\par\par Second line\line continued\par}`;
  const poem = await readPoemFile(new File([source], "plain.rtf"));

  assert.equal(poem.title, "Plain");
  assert.equal(poem.text, "First line\n\nSecond line\ncontinued");
  assert.match(poem.editorHtml || "", /<p>First line<\/p>/);
  assert.match(poem.editorHtml || "", /<p><br><\/p>/);
  assert.match(poem.editorHtml || "", /<p>Second line<br>continued<\/p>/);
});

test("uses the browser file picker and writes a valid DOCX Blob", async () => {
  let pickerOptions: unknown;
  const writes: (Blob | string)[] = [];
  let closeCount = 0;
  const handle: WritablePoemFileHandle = {
    name: "draft.docx",
    async getFile() { throw new Error("Not needed in this test"); },
    async createWritable() {
      return {
        async write(data) { writes.push(data); },
        async close() { closeCount += 1; },
      };
    },
  };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      async showOpenFilePicker(options: unknown) {
        pickerOptions = options;
        return [handle];
      },
    },
  });

  const selectedHandle = await choosePoemFile();
  assert.equal(selectedHandle, handle);
  assert.ok(pickerOptions);
  const docx = serializePoem("A <bright> day", "First line\nSecond line", "docx");
  assert.ok(docx instanceof Blob);
  await writePoemFile(selectedHandle!, docx);
  assert.equal(writes[0], docx);
  assert.equal(closeCount, 1);

  const entries = unzipSync(new Uint8Array(await (writes[0] as Blob).arrayBuffer()));
  const document = strFromU8(entries["word/document.xml"]);
  assert.match(document, /A &lt;bright&gt; day/);
  assert.match(document, /First line/);
  assert.match(document, /Second line/);
});

test("downloads an updated ODT copy when a file handle is unavailable", async () => {
  let downloadedBlob: Blob | undefined;
  let clickedAnchor: { href: string; download: string; click: () => void } | undefined;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value(blob: Blob) {
      downloadedBlob = blob;
      return "blob:poetry-test";
    },
  });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value() {} });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        clickedAnchor = { href: "", download: "", click() {} };
        return clickedAnchor;
      },
    },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { setTimeout(callback: () => void) { callback(); return 0; } },
  });

  const content = serializePoem("Night rain", "A line\n\nAnother line", "odt");
  assert.ok(content instanceof Blob);
  downloadPoemFile("night-rain.odt", content, "odt");
  assert.equal(clickedAnchor?.download, "night-rain.odt");
  assert.equal(clickedAnchor?.href, "blob:poetry-test");
  assert.equal(downloadedBlob?.type, "application/vnd.oasis.opendocument.text");

  const archive = unzipSync(new Uint8Array(await downloadedBlob!.arrayBuffer()));
  assert.equal(strFromU8(archive.mimetype), "application/vnd.oasis.opendocument.text");
  assert.match(strFromU8(archive["content.xml"]), /Another line/);

  const pdf = serializePoemPdf("Night rain", "A line\n\nAnother line");
  downloadPoemFile("night-rain.pdf", pdf, "pdf");
  assert.equal(clickedAnchor?.download, "night-rain.pdf");
  assert.equal(downloadedBlob?.type, "application/pdf");
});

test("serializes RTF with escaped structural characters and unicode", async () => {
  const rtf = serializePoem("Poem {title}", "A \\ line — 🌧", "rtf");
  assert.ok(rtf instanceof Blob);
  const text = await rtf.text();
  assert.match(text, /Poem \\\{title\\\}/);
  assert.ok(text.includes("A \\\\ line"));
  assert.ok(text.includes("\\u8212?"));
  assert.ok(text.includes("\\u-10180?\\u-8409?"));
  const imported = readRtf(text);
  assert.equal(imported.title, "Poem {title}");
  assert.equal(imported.text, "A \\ line — 🌧");
  assert.ok(imported.editorHtml.includes("A \\ line — 🌧"));
});

test("exports valid paginated PDF with poem title, line breaks, stanza gaps, and readable punctuation", async () => {
  const pdf = serializePoemPdf("Night rain — bright", "First bright line\nSecond line\n\nLast line");
  assert.equal(pdf.type, "application/pdf");
  const source = await pdf.text();
  assert.match(source, /^%PDF-1\.4/);
  assert.match(source, /\/Title <FEFF004E00690067006800740020007200610069006E002020140020006200720069006700680074>/);
  assert.match(source, /<466972737420627269676874206C696E65>/);
  assert.match(source, /<5365636F6E64206C696E65>/);
  assert.match(source, /<4C617374206C696E65>/);
  assert.match(source, /\/Count 1/);
  assert.match(source, /\/Kids \[7 0 R\]/);
  assert.match(source, /\/WinAnsiEncoding/);
  assert.match(source, /BT \/F1 11 Tf/);
  assert.doesNotMatch(source, /BT \/F3 11 Tf|BT \/F4 11 Tf|0\.6 w/);

  const xrefStart = Number(source.match(/startxref\n(\d+)/)?.[1]);
  assert.equal(source.slice(xrefStart, xrefStart + 5), "xref\n");
  const xrefEntries = source.slice(xrefStart).split("\n").slice(2);
  const objectCount = Number(source.slice(xrefStart).match(/^xref\n0 (\d+)/)?.[1]);
  for (let objectNumber = 1; objectNumber < objectCount; objectNumber += 1) {
    const offset = Number(xrefEntries[objectNumber].slice(0, 10));
    assert.equal(source.slice(offset, offset + `${objectNumber} 0 obj`.length), `${objectNumber} 0 obj`);
  }

  const multipagePdf = await serializePoemPdf("Long poem", Array.from({ length: 120 }, (_, index) => `Line ${index + 1}`).join("\n")).text();
  assert.match(multipagePdf, /\/Count [2-9]\d*/);
});

test("applies selected PDF page size and margins to every poem and book page", async () => {
  const longPoem = Array.from({ length: 100 }, (_, index) => `A line for page ${index + 1}`).join("\n");
  const poemPdf = await serializePoemPdf("Long poem", longPoem, undefined, {
    pageSize: "a5",
    margins: "wide",
  }).text();

  const a5PageCount = poemPdf.match(/\/MediaBox \[0 0 419\.53 595\.28\]/g)?.length || 0;
  assert.ok(a5PageCount > 1, "the long poem should continue onto multiple A5 pages");
  assert.equal(Number(poemPdf.match(/\/Count (\d+)/)?.[1]), a5PageCount);
  for (const [, x, y] of poemPdf.matchAll(/BT \/F[12] \d+ Tf ([\d.]+) ([\d.]+) Td/g)) {
    assert.ok(Number(x) >= 90, "wide left margins should be applied to all text");
    assert.ok(Number(y) >= 90, "text should remain above the bottom margin on every page");
  }

  const bookPdf = await serializeBookPdf("Collected poems", [
    { title: "First", text: longPoem },
    { title: "Second", text: "A short poem" },
  ], { pageSize: "a4", margins: "narrow" }).text();
  const a4PageCount = bookPdf.match(/\/MediaBox \[0 0 595\.28 841\.89\]/g)?.length || 0;
  assert.ok(a4PageCount > 1);
  assert.equal(Number(bookPdf.match(/\/Count (\d+)/)?.[1]), a4PageCount);
  for (const [, x, y] of bookPdf.matchAll(/BT \/F[12] \d+ Tf ([\d.]+) ([\d.]+) Td/g)) {
    assert.ok(Number(x) >= 36, "narrow left margins should be applied to all text");
    assert.ok(Number(y) >= 36, "book text should remain above the bottom margin on every page");
  }
});

test("exports PDF emphasis and paragraph alignment while keeping plain text styling unchanged", async () => {
  enableXmlDom();
  const editorHtml = '<p style="text-align:center"><strong>Bold</strong> <em>Italic</em> <u>Under</u></p><p style="text-align:right">Right</p>';
  const pdf = await serializePoemPdf("Styled poem", "Bold Italic Under\nRight", editorHtml).text();

  assert.match(pdf, /\/F3 5 0 R/);
  assert.match(pdf, /\/F4 6 0 R/);
  assert.match(pdf, /BT \/F2 11 Tf/);
  assert.match(pdf, /BT \/F3 11 Tf/);
  assert.match(pdf, /0\.6 w [\d.]+ [\d.]+ m [\d.]+ [\d.]+ l S/);
  assert.match(pdf, /BT \/F1 11 Tf 0 Tw 512\.5 668 Td/);
  assert.doesNotMatch(pdf, /BT \/F1 11 Tf 0 Tw 72 668 Td/);
});

test("exports emphasis and paragraph layout to DOCX, RTF, and ODT", async () => {
  enableXmlDom();
  const title = "Night rain";
  const text = "First bright\n\nLast";
  const editorHtml = '<p style="text-align:center;margin-left:18pt;text-indent:9pt"><strong>First</strong> <em><u>bright</u></em></p><p><br/></p><p><span style="font-weight:700;font-style:italic">Last</span></p>';

  const docx = serializePoem(title, text, "docx", editorHtml) as Blob;
  const docxArchive = unzipSync(new Uint8Array(await docx.arrayBuffer()));
  const docxXml = strFromU8(docxArchive["word/document.xml"]);
  assert.match(docxXml, /<w:jc w:val="center"\/>/);
  assert.match(docxXml, /w:left="360"/);
  assert.match(docxXml, /w:firstLine="180"/);
  assert.match(docxXml, /<w:b\/>/);
  assert.match(docxXml, /<w:i\/>/);
  assert.match(docxXml, /<w:u w:val="single"\/>/);
  const importedDocx = await readPoemFile(new File([docx], "night-rain.docx"));
  assert.equal(importedDocx.title, title);
  assert.equal(importedDocx.text, text);
  assert.match(importedDocx.editorHtml || "", /text-align:center/);
  assert.match(importedDocx.editorHtml || "", /<strong>First<\/strong>/);

  const rtf = serializePoem(title, text, "rtf", editorHtml) as Blob;
  const rtfText = await rtf.text();
  assert.match(rtfText, /\\qc/);
  assert.match(rtfText, /\\li360/);
  assert.match(rtfText, /\\fi180/);
  assert.match(rtfText, /\\b First/);
  assert.match(rtfText, /\\i\\ul bright/);
  const importedRtf = readRtf(rtfText);
  assert.equal(importedRtf.title, title);
  assert.equal(importedRtf.text, text);
  assert.match(importedRtf.editorHtml, /<strong>First<\/strong>/);

  const odt = serializePoem(title, text, "odt", editorHtml) as Blob;
  const odtArchive = unzipSync(new Uint8Array(await odt.arrayBuffer()));
  const odtXml = strFromU8(odtArchive["content.xml"]);
  assert.match(odtXml, /fo:text-align="center"/);
  assert.match(odtXml, /fo:margin-left="18pt"/);
  assert.match(odtXml, /fo:text-indent="9pt"/);
  assert.match(odtXml, /fo:font-weight="bold"/);
  assert.match(odtXml, /fo:font-style="italic"/);
  assert.match(odtXml, /style:text-underline-style="solid"/);
  const importedOdt = await readPoemFile(new File([odt], "night-rain.odt"));
  assert.equal(importedOdt.title, title);
  assert.equal(importedOdt.text, text);
  assert.match(importedOdt.editorHtml || "", /text-align:center/);
  assert.match(importedOdt.editorHtml || "", /<strong>First<\/strong>/);
});

test("exports editable numbered and bulleted lists with nesting to office formats", async () => {
  enableXmlDom();
  const title = "List poem";
  const editorHtml = '<p>Opening</p><ol><li>First numbered line<ul><li>Nested bullet line</li></ul></li><li>Second numbered line</li></ol><ul><li>Final bullet line</li></ul><p>Closing</p>';
  const text = "Opening\nFirst numbered line\nNested bullet line\nSecond numbered line\nFinal bullet line\nClosing";

  const docx = serializePoem(title, text, "docx", editorHtml) as Blob;
  const docxArchive = unzipSync(new Uint8Array(await docx.arrayBuffer()));
  const documentXml = strFromU8(docxArchive["word/document.xml"]);
  const numberingXml = strFromU8(docxArchive["word/numbering.xml"]);
  const contentTypesXml = strFromU8(docxArchive["[Content_Types].xml"]);
  assert.match(documentXml, /<w:numPr><w:ilvl w:val="0"\/><w:numId w:val="1"\/><\/w:numPr>/);
  assert.match(documentXml, /<w:numPr><w:ilvl w:val="1"\/><w:numId w:val="2"\/><\/w:numPr>/);
  assert.match(numberingXml, /<w:numFmt w:val="decimal"\/>/);
  assert.match(numberingXml, /<w:numFmt w:val="bullet"\/>/);
  assert.match(numberingXml, /<w:lvlText w:val="•"\/>/);
  assert.match(contentTypesXml, /word\/numbering\.xml/);
  const importedDocx = await readPoemFile(new File([docx], "list-poem.docx"));
  assert.equal(importedDocx.title, title);
  assert.equal(importedDocx.text, text);

  const rtf = serializePoem(title, text, "rtf", editorHtml) as Blob;
  const rtfText = await rtf.text();
  assert.match(rtfText, /\\levelnfc0/);
  assert.match(rtfText, /\\levelnfc23/);
  assert.match(rtfText, /\\ls1\\ilvl0/);
  assert.match(rtfText, /\\ls2\\ilvl1/);
  assert.match(rtfText, /\\'B7/);
  const importedRtf = readRtf(rtfText);
  assert.equal(importedRtf.title, title);
  assert.equal(importedRtf.text, text);

  const odt = serializePoem(title, text, "odt", editorHtml) as Blob;
  const odtArchive = unzipSync(new Uint8Array(await odt.arrayBuffer()));
  const odtXml = strFromU8(odtArchive["content.xml"]);
  assert.match(odtXml, /<text:list-style style:name="PoemNumberedList">/);
  assert.match(odtXml, /<text:list-style style:name="PoemBulletedList">/);
  assert.match(odtXml, /<text:list-item><text:p>First numbered line<\/text:p><text:list/);
  assert.match(odtXml, /text:bullet-char="•"/);
  const importedOdt = await readPoemFile(new File([odt], "list-poem.odt"));
  assert.equal(importedOdt.title, title);
  assert.equal(importedOdt.text, text);
});
