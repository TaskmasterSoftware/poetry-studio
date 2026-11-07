import assert from "node:assert/strict";
import { after, test } from "node:test";
import { strFromU8, unzipSync } from "fflate";
import {
  choosePoemFile, downloadPoemFile, serializePoem, writePoemFile,
  type WritablePoemFileHandle,
} from "./poem-files";
import { readRtf } from "./document-import";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (originalCreateObjectUrl) Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  else Reflect.deleteProperty(URL, "createObjectURL");
  if (originalRevokeObjectUrl) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  else Reflect.deleteProperty(URL, "revokeObjectURL");
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
});

test("serializes RTF with escaped structural characters and unicode", async () => {
  const rtf = serializePoem("Poem {title}", "A \\ line — 🌧", "rtf");
  assert.ok(rtf instanceof Blob);
  const text = await rtf.text();
  assert.match(text, /Poem \\\{title\\\}/);
  assert.ok(text.includes("A \\\\ line"));
  assert.ok(text.includes("\\u8212?"));
  assert.ok(text.includes("\\u-10180?\\u-8409?"));
  assert.deepEqual(readRtf(text), { title: "Poem {title}", text: "A \\ line — 🌧" });
});
