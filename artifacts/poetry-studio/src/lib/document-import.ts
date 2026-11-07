import { strFromU8, unzipSync } from "fflate";

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
    const text = Array.from(body.childNodes)
      .map(wordNodeText)
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/\n+$/, "");
    return { title: metadataTitle(archive), text };
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
    const text = Array.from(body.childNodes)
      .map(odtNodeText)
      .join("")
      .replace(/\u00a0/g, " ")
      .replace(/\n+$/, "");
    return { title: metadataTitle(archive), text };
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

  return {
    title: "",
    text: output.join("").replace(/\u00a0/g, " ").replace(/\u0000/g, "").replace(/\n+$/, ""),
  };
}
