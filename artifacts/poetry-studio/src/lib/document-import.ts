import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const officeNamespace = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const textNamespace = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const dcNamespace = "http://purl.org/dc/elements/1.1/";
const skippedRtfDestinations = new Set([
  "annotation", "colortbl", "datastore", "filetbl", "fonttbl", "footer",
  "footerf", "footerl", "footerr", "header", "headerf", "headerl", "headerr",
  "info", "listtable", "listoverridetable", "object", "pict", "revtbl",
  "rsidtbl", "stylesheet", "themedata", "xmlnstbl",
]);

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] || character);
}

function validXmlText(value: string) {
  return value.replace(/[^\u0009\u000a\u000d\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "");
}

function rtfText(value: string) {
  return Array.from(value).map((character) => {
    if (character === "\\") return "\\\\";
    if (character === "{") return "\\{";
    if (character === "}") return "\\}";
    if (character === "\t") return "\\tab ";
    const codePoint = character.codePointAt(0)!;
    if (codePoint >= 0x20 && codePoint <= 0x7e) return character;
    const utf16 = codePoint > 0xffff
      ? [0xd800 + ((codePoint - 0x10000) >> 10), 0xdc00 + ((codePoint - 0x10000) & 0x3ff)]
      : [codePoint];
    return utf16.map((codeUnit) => `\\u${codeUnit > 0x7fff ? codeUnit - 0x10000 : codeUnit}?`).join("");
  }).join("");
}

function rtfParagraphs(text: string) {
  return text.replace(/\r\n?/g, "\n").split("\n").map(rtfText).join("\\par\n");
}

function docxParagraph(line: string, isTitle = false) {
  if (!line && !isTitle) return "<w:p/>";
  const runs = line.split("\t").map((part, index) => {
    const text = `<w:t xml:space="preserve">${escapeXml(validXmlText(part))}</w:t>`;
    return `${index ? "<w:r><w:tab/></w:r>" : ""}<w:r>${text}</w:r>`;
  }).join("");
  return `<w:p>${isTitle ? '<w:pPr><w:pStyle w:val="Title"/></w:pPr>' : ""}${runs}</w:p>`;
}

function odtParagraph(line: string, isTitle = false) {
  const content = line.split("\t").map((part) => escapeXml(validXmlText(part))).join("<text:tab/>");
  if (!line && !isTitle) return "<text:p/>";
  return isTitle
    ? `<text:h text:outline-level="1">${content}</text:h>`
    : `<text:p>${content}</text:p>`;
}

function officeBody(title: string, text: string, paragraph: (line: string, isTitle?: boolean) => string) {
  const titleParagraph = title.trim() ? `${paragraph(title, true)}` : "";
  const poemParagraphs = text.replace(/\r\n?/g, "\n").split("\n").map((line) => paragraph(line)).join("");
  return `${titleParagraph}${poemParagraphs}`;
}

function asBlob(bytes: Uint8Array, type: string) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([copy], { type });
}

export function serializeRtf(title: string, text: string) {
  const titleInfo = title.trim() ? `{\\info{\\title ${rtfText(title)}}}` : "";
  const visibleTitle = title.trim() ? `{\\b ${rtfText(title)}}\\par\n` : "";
  return new Blob(
    [`{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1 ${titleInfo}\n${visibleTitle}${rtfParagraphs(text)}\n}`],
    { type: "application/rtf" },
  );
}

export function serializeDocx(title: string, text: string) {
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${officeBody(title, text, docxParagraph)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(validXmlText(title))}</dc:title></cp:coreProperties>`;
  const archive = zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    "word/document.xml": strToU8(documentXml),
    "word/styles.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style></w:styles>'),
    "docProps/core.xml": strToU8(coreXml),
  });
  return asBlob(archive, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

export function serializeOdt(title: string, text: string) {
  const contentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.2"><office:body><office:text>${officeBody(title, text, odtParagraph)}</office:text></office:body></office:document-content>`;
  const archive = zipSync({
    mimetype: strToU8("application/vnd.oasis.opendocument.text"),
    "content.xml": strToU8(contentXml),
    "meta.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.2"><office:meta><dc:title>${escapeXml(validXmlText(title))}</dc:title></office:meta></office:document-meta>`),
    "META-INF/manifest.xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2"><manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/></manifest:manifest>'),
  }, { level: 0 });
  return asBlob(archive, "application/vnd.oasis.opendocument.text");
}

function parseXml(source: string, label: string): XMLDocument {
  const document = new DOMParser().parseFromString(source, "application/xml");
  if (document.getElementsByTagName("parsererror").length) {
    throw new Error(`This ${label} file contains invalid document data.`);
  }
  return document;
}

function zippedXml(archive: Record<string, Uint8Array>, path: string, label: string): string {
  const content = archive[path];
  if (!content) throw new Error(`This ${label} file is missing ${path}.`);
  return strFromU8(content);
}

function metadataTitle(archive: Record<string, Uint8Array>): string {
  const content = archive["docProps/core.xml"] || archive["meta.xml"];
  if (!content) return "";
  const document = parseXml(strFromU8(content), "document metadata");
  return document.getElementsByTagNameNS(dcNamespace, "title")[0]?.textContent?.trim() || "";
}

function withoutLeadingTitle(text: string, title: string) {
  if (!title) return text;
  if (text === title) return "";
  return text.startsWith(`${title}\n`) ? text.slice(title.length + 1) : text;
}

function wordNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (element.namespaceURI === wordNamespace) {
    if (element.localName === "t") return element.textContent || "";
    if (element.localName === "tab") return "\t";
    if (element.localName === "br" || element.localName === "cr") return "\n";
    if (element.localName === "noBreakHyphen") return "\u2011";
    if (element.localName === "softHyphen") return "";
    if (element.localName === "delText") return "";
    if (element.localName === "p") {
      return `${Array.from(element.childNodes).map(wordNodeText).join("")}\n`;
    }
  }
  return Array.from(element.childNodes).map(wordNodeText).join("");
}

export async function readDocx(file: File): Promise<{ title: string; text: string }> {
  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const document = parseXml(zippedXml(archive, "word/document.xml", "Word"), "Word");
    const body = document.getElementsByTagNameNS(wordNamespace, "body")[0];
    if (!body) throw new Error("This Word document has no readable document body.");
    const title = metadataTitle(archive);
    const text = Array.from(body.childNodes)
      .map(wordNodeText)
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/\n+$/, "");
    return { title, text: withoutLeadingTitle(text, title) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("This ")) throw error;
    throw new Error("Could not read this Word document. Try saving it as .docx and opening it again.");
  }
}

function odtNodeText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as Element;
  if (element.namespaceURI === textNamespace) {
    if (element.localName === "line-break") return "\n";
    if (element.localName === "tab") return "\t";
    if (element.localName === "s") {
      const count = Math.min(1000, Math.max(1, Number(element.getAttributeNS(textNamespace, "c")) || 1));
      return " ".repeat(count);
    }
    const content = Array.from(element.childNodes).map(odtNodeText).join("");
    if (element.localName === "p" || element.localName === "h") return `${content}\n`;
    return content;
  }
  return Array.from(element.childNodes).map(odtNodeText).join("");
}

export async function readOdt(file: File): Promise<{ title: string; text: string }> {
  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const document = parseXml(zippedXml(archive, "content.xml", "OpenDocument"), "OpenDocument");
    const body = document.getElementsByTagNameNS(officeNamespace, "text")[0];
    if (!body) throw new Error("This OpenDocument file has no readable text body.");
    const title = metadataTitle(archive);
    const text = Array.from(body.childNodes)
      .map(odtNodeText)
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/\n+$/, "");
    return { title, text: withoutLeadingTitle(text, title) };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("This ")) throw error;
    throw new Error("Could not read this OpenDocument file. Try saving it as .odt and opening it again.");
  }
}

function decodeRtfByte(hex: string): string {
  const value = Number.parseInt(hex, 16);
  if (!Number.isFinite(value)) return "";
  try {
    return new TextDecoder("windows-1252").decode(new Uint8Array([value]));
  } catch {
    return String.fromCharCode(value);
  }
}

export function readRtf(source: string): { title: string; text: string } {
  const rawTitle = source.match(/\\title\b((?:\\.|[^{}])*)/i)?.[1] || "";
  const title = rawTitle
    .replace(/\\'([\da-f]{2})/gi, (_match, hex: string) => decodeRtfByte(hex))
    .replace(/\\u(-?\d+)\??/g, (_match, value: string) => {
      const codeUnit = Number(value);
      return String.fromCharCode(codeUnit < 0 ? codeUnit + 65536 : codeUnit);
    })
    .replace(/\\([\\{}])/g, "$1")
    .replace(/\\~/g, " ")
    .replace(/\\_/g, "\u2011")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .trim();
  const groups: { skip: boolean; unicodeFallback: number }[] = [{ skip: false, unicodeFallback: 1 }];
  const output: string[] = [];
  let fallbackCharacters = 0;

  for (let index = 0; index < source.length;) {
    const character = source[index];
    const group = groups[groups.length - 1];

    if (character === "{") {
      groups.push({ ...group });
      index += 1;
      continue;
    }
    if (character === "}") {
      if (groups.length > 1) groups.pop();
      index += 1;
      continue;
    }
    if (character !== "\\") {
      if (!group.skip && character !== "\r" && character !== "\n") {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else output.push(character);
      }
      index += 1;
      continue;
    }

    const next = source[index + 1];
    if (!next) break;
    if (next === "'" && /^[\da-f]{2}$/i.test(source.slice(index + 2, index + 4))) {
      const decoded = decodeRtfByte(source.slice(index + 2, index + 4));
      if (!group.skip) {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else output.push(decoded);
      }
      index += 4;
      continue;
    }
    if ("\\{}".includes(next)) {
      if (!group.skip) {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else output.push(next);
      }
      index += 2;
      continue;
    }
    if (next === "*") {
      group.skip = true;
      index += 2;
      continue;
    }
    if (next === "~" || next === "_" || next === "-") {
      if (!group.skip && next !== "-") {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else output.push(next === "~" ? " " : "\u2011");
      }
      index += 2;
      continue;
    }
    if (next === "\r" || next === "\n") {
      index += source[index + 2] === (next === "\r" ? "\n" : "\r") ? 3 : 2;
      continue;
    }

    const control = source.slice(index + 1).match(/^([a-zA-Z]+)(-?\d+)? ?/);
    if (!control) {
      index += 2;
      continue;
    }
    const [, word, numericArgument] = control;
    const amount = Number(numericArgument);
    index += control[0].length + 1;
    if (skippedRtfDestinations.has(word)) {
      group.skip = true;
      continue;
    }
    if (group.skip) continue;

    if (word === "uc" && Number.isFinite(amount)) {
      group.unicodeFallback = Math.max(0, amount);
    } else if (word === "u" && Number.isFinite(amount)) {
      const codeUnit = amount < 0 ? amount + 65536 : amount;
      output.push(String.fromCharCode(codeUnit));
      fallbackCharacters = group.unicodeFallback;
    } else if (word === "par" || word === "line" || word === "page" || word === "row") {
      output.push("\n");
    } else if (word === "tab" || word === "cell") {
      output.push("\t");
    } else if (word === "emdash") {
      output.push("\u2014");
    } else if (word === "endash") {
      output.push("\u2013");
    } else if (word === "bullet") {
      output.push("\u2022");
    } else if (word === "lquote") {
      output.push("\u2018");
    } else if (word === "rquote") {
      output.push("\u2019");
    } else if (word === "ldblquote") {
      output.push("\u201c");
    } else if (word === "rdblquote") {
      output.push("\u201d");
    } else if (word === "bin" && Number.isFinite(amount) && amount > 0) {
      index += amount;
    }
  }

  const text = output.join("").replace(/\u00a0/g, " ").replace(/\u0000/g, "").replace(/\n+$/, "");
  return { title, text: withoutLeadingTitle(text, title) };
}
