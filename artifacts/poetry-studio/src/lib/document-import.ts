import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const officeNamespace = "urn:oasis:names:tc:opendocument:xmlns:office:1.0";
const textNamespace = "urn:oasis:names:tc:opendocument:xmlns:text:1.0";
const styleNamespace = "urn:oasis:names:tc:opendocument:xmlns:style:1.0";
const foNamespace = "urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0";
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

type InlineStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
};
type ImportedContent = { text: string; html: string };
type WordStyle = { parent: string; runProperties?: Element; paragraphProperties?: Element };
type OdtStyle = {
  parent: string;
  inline: InlineStyle;
  paragraph: { align?: string; left?: string; right?: string; firstLine?: string };
};

function directChild(element: Element | null | undefined, namespace: string, localName: string) {
  return Array.from(element?.childNodes || []).find((child) =>
    child.nodeType === Node.ELEMENT_NODE
    && (child as Element).namespaceURI === namespace
    && (child as Element).localName === localName,
  ) as Element | undefined;
}

function wordAttribute(element: Element | null | undefined, name: string) {
  return element?.getAttributeNS(wordNamespace, name) || "";
}

function enabledWordProperty(properties: Element, name: string): boolean | undefined {
  const property = directChild(properties, wordNamespace, name);
  if (!property) return undefined;
  const value = wordAttribute(property, "val").toLowerCase();
  return !["0", "false", "off", "none"].includes(value);
}

function wordInlineProperties(properties?: Element): InlineStyle {
  if (!properties) return {};
  const result: InlineStyle = {};
  for (const [property, key] of [
    ["b", "bold"], ["i", "italic"], ["u", "underline"], ["strike", "strike"],
  ] as const) {
    const enabled = enabledWordProperty(properties, property);
    if (enabled !== undefined) result[key] = enabled;
  }
  if (directChild(properties, wordNamespace, "dstrike")) result.strike = enabledWordProperty(properties, "dstrike");
  const vertical = wordAttribute(directChild(properties, wordNamespace, "vertAlign"), "val");
  if (vertical === "superscript") result.superscript = true;
  if (vertical === "subscript") result.subscript = true;
  if (vertical === "baseline") {
    result.superscript = false;
    result.subscript = false;
  }
  return result;
}

function mergeInlineStyles(...styles: InlineStyle[]): InlineStyle {
  return Object.assign({}, ...styles);
}

function wordStyleMap(stylesDocument?: XMLDocument) {
  const styles = new Map<string, WordStyle>();
  if (!stylesDocument) return styles;
  for (const style of Array.from(stylesDocument.getElementsByTagNameNS(wordNamespace, "style"))) {
    const id = wordAttribute(style, "styleId");
    if (!id) continue;
    styles.set(id, {
      parent: wordAttribute(directChild(style, wordNamespace, "basedOn"), "val"),
      runProperties: directChild(style, wordNamespace, "rPr"),
      paragraphProperties: directChild(style, wordNamespace, "pPr"),
    });
  }
  return styles;
}

function resolvedWordInlineStyle(
  styleId: string,
  styles: Map<string, WordStyle>,
  visited = new Set<string>(),
): InlineStyle {
  if (!styleId || visited.has(styleId)) return {};
  visited.add(styleId);
  const style = styles.get(styleId);
  return style
    ? mergeInlineStyles(
      resolvedWordInlineStyle(style.parent, styles, visited),
      wordInlineProperties(directChild(style.runProperties, wordNamespace, "rPr") || style.runProperties),
    )
    : {};
}

function wordRunStyle(properties: Element | undefined, styles: Map<string, WordStyle>): InlineStyle {
  const styleId = wordAttribute(directChild(properties, wordNamespace, "rStyle"), "val");
  return mergeInlineStyles(
    resolvedWordInlineStyle(styleId, styles),
    wordInlineProperties(properties),
  );
}

function wrappedInlineHtml(html: string, style: InlineStyle) {
  const tags = [
    style.bold ? "strong" : "",
    style.italic ? "em" : "",
    style.underline ? "u" : "",
    style.strike ? "s" : "",
    style.superscript ? "sup" : "",
    style.subscript ? "sub" : "",
  ].filter(Boolean);
  return tags.reduceRight((content, tag) => `<${tag}>${content}</${tag}>`, html);
}

function wordInlineContent(node: Node, styles: Map<string, WordStyle>, inherited: InlineStyle = {}): ImportedContent {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (/^\s*[\r\n]\s*$/u.test(text)) return { text: "", html: "" };
    return { text, html: escapeXml(text) };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return { text: "", html: "" };
  const element = node as Element;
  if (element.namespaceURI === wordNamespace) {
    if (element.localName === "t") {
      const text = element.textContent || "";
      return { text, html: escapeXml(text) };
    }
    if (element.localName === "tab") return { text: "\t", html: "\t" };
    if (element.localName === "br" || element.localName === "cr") return { text: "\n", html: "<br>" };
    if (element.localName === "noBreakHyphen") return { text: "\u2011", html: "\u2011" };
    if (element.localName === "softHyphen" || element.localName === "delText" || element.localName === "rPr") {
      return { text: "", html: "" };
    }
    if (element.localName === "r") {
      const properties = directChild(element, wordNamespace, "rPr");
      const style = wordRunStyle(properties, styles);
      const content = Array.from(element.childNodes)
        .filter((child) => !(child.nodeType === Node.ELEMENT_NODE
          && (child as Element).namespaceURI === wordNamespace
          && (child as Element).localName === "rPr"))
        .map((child) => wordInlineContent(child, styles, mergeInlineStyles(inherited, style)));
      const result = { text: content.map((part) => part.text).join(""), html: content.map((part) => part.html).join("") };
      return { ...result, html: wrappedInlineHtml(result.html, style) };
    }
  }
  const content = Array.from(element.childNodes).map((child) => wordInlineContent(child, styles, inherited));
  return { text: content.map((part) => part.text).join(""), html: content.map((part) => part.html).join("") };
}

function wordParagraphStyle(paragraph: Element, styles: Map<string, WordStyle>) {
  const paragraphProperties = directChild(paragraph, wordNamespace, "pPr");
  const styleId = wordAttribute(directChild(paragraphProperties, wordNamespace, "pStyle"), "val");
  const declarations: string[] = [];
  const chain: WordStyle[] = [];
  const visited = new Set<string>();
  let current = styleId;
  while (current && !visited.has(current)) {
    visited.add(current);
    const style = styles.get(current);
    if (!style) break;
    chain.unshift(style);
    current = style.parent;
  }
  chain.push({ parent: "", paragraphProperties });
  let align = "";
  let left: number | undefined;
  let right: number | undefined;
  let firstLine: number | undefined;
  let hanging: number | undefined;
  for (const style of chain) {
    const props = style.paragraphProperties;
    const jc = wordAttribute(directChild(props, wordNamespace, "jc"), "val");
    if (["left", "center", "right", "both", "distribute"].includes(jc)) {
      align = jc === "both" || jc === "distribute" ? "justify" : jc;
    }
    const indent = directChild(props, wordNamespace, "ind");
    const parseTwips = (attribute: string) => {
      const raw = wordAttribute(indent, attribute);
      if (!/^-?\d{1,6}$/.test(raw)) return undefined;
      return Math.max(-20000, Math.min(20000, Number(raw)));
    };
    left = parseTwips("left") ?? parseTwips("start") ?? left;
    right = parseTwips("right") ?? parseTwips("end") ?? right;
    firstLine = parseTwips("firstLine") ?? firstLine;
    hanging = parseTwips("hanging") ?? hanging;
  }
  if (align) declarations.push(`text-align:${align}`);
  if (left !== undefined) declarations.push(`margin-left:${left / 20}pt`);
  if (right !== undefined) declarations.push(`margin-right:${right / 20}pt`);
  const indent = firstLine !== undefined ? firstLine : hanging !== undefined ? -hanging : undefined;
  if (indent !== undefined) declarations.push(`text-indent:${indent / 20}pt`);
  return declarations.length ? ` style="${declarations.join(";")}"` : "";
}

function importedParagraphs(paragraphs: ImportedContent[], title: string) {
  const content = title && paragraphs[0]?.text === title ? paragraphs.slice(1) : paragraphs;
  const rawText = paragraphs.map((paragraph) => paragraph.text).join("\n").replace(/\n+$/, "");
  return {
    text: withoutLeadingTitle(rawText.replace(/\u00a0/g, " "), title),
    editorHtml: content.map((paragraph) => paragraph.html).join(""),
  };
}

export async function readDocx(file: File): Promise<{ title: string; text: string; editorHtml: string }> {
  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const document = parseXml(zippedXml(archive, "word/document.xml", "Word"), "Word");
    const body = document.getElementsByTagNameNS(wordNamespace, "body")[0];
    if (!body) throw new Error("This Word document has no readable document body.");
    const title = metadataTitle(archive);
    const styles = wordStyleMap(archive["word/styles.xml"]
      ? parseXml(strFromU8(archive["word/styles.xml"]), "Word styles")
      : undefined);
    const paragraphs = Array.from(body.getElementsByTagNameNS(wordNamespace, "p")).map((paragraph) => {
      const content = Array.from(paragraph.childNodes)
        .filter((child) => !(child.nodeType === Node.ELEMENT_NODE
          && (child as Element).namespaceURI === wordNamespace
          && (child as Element).localName === "pPr"))
        .map((child) => wordInlineContent(child, styles));
      return {
        text: content.map((part) => part.text).join(""),
        html: `<p${wordParagraphStyle(paragraph, styles)}>${content.map((part) => part.html).join("") || "<br>"}</p>`,
      };
    });
    const imported = importedParagraphs(paragraphs, title);
    return { title, text: imported.text, editorHtml: imported.editorHtml };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("This ")) throw error;
    throw new Error("Could not read this Word document. Try saving it as .docx and opening it again.");
  }
}

function odtStyleMap(documents: XMLDocument[]) {
  const styles = new Map<string, OdtStyle>();
  const attribute = (element: Element | null | undefined, namespace: string, name: string) =>
    element?.getAttributeNS(namespace, name) || "";
  for (const document of documents) {
    for (const style of Array.from(document.getElementsByTagNameNS(styleNamespace, "style"))) {
      const name = style.getAttributeNS(styleNamespace, "name");
      if (!name) continue;
      const textProperties = directChild(style, styleNamespace, "text-properties");
      const paragraphProperties = directChild(style, styleNamespace, "paragraph-properties");
      const inline: InlineStyle = {};
      const weight = attribute(textProperties, foNamespace, "font-weight").toLowerCase();
      const fontStyle = attribute(textProperties, foNamespace, "font-style").toLowerCase();
      const underline = attribute(textProperties, styleNamespace, "text-underline-style").toLowerCase();
      const strike = attribute(textProperties, styleNamespace, "text-line-through-style").toLowerCase();
      if (weight) inline.bold = weight === "bold" || Number(weight) >= 600;
      if (fontStyle) inline.italic = fontStyle === "italic" || fontStyle === "oblique";
      if (underline) inline.underline = underline !== "none";
      if (strike) inline.strike = strike !== "none";
      const position = attribute(textProperties, styleNamespace, "text-position").toLowerCase();
      if (position.startsWith("super")) inline.superscript = true;
      if (position.startsWith("sub")) inline.subscript = true;
      const align = attribute(paragraphProperties, foNamespace, "text-align").toLowerCase();
      styles.set(name, {
        parent: attribute(style, styleNamespace, "parent-style-name"),
        inline,
        paragraph: {
          align,
          left: attribute(paragraphProperties, foNamespace, "margin-left") || undefined,
          right: attribute(paragraphProperties, foNamespace, "margin-right") || undefined,
          firstLine: attribute(paragraphProperties, foNamespace, "text-indent") || undefined,
        },
      });
    }
  }
  return styles;
}

function resolvedOdtStyle(name: string, styles: Map<string, OdtStyle>, visited = new Set<string>()): OdtStyle {
  if (!name || visited.has(name)) return { parent: "", inline: {}, paragraph: {} };
  visited.add(name);
  const style = styles.get(name);
  if (!style) return { parent: "", inline: {}, paragraph: {} };
  const parent = resolvedOdtStyle(style.parent, styles, visited);
  return {
    parent: "",
    inline: mergeInlineStyles(parent.inline, style.inline),
    paragraph: { ...parent.paragraph, ...style.paragraph },
  };
}

function safeOdtMeasure(value?: string) {
  return value && /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:cm|mm|in|pt|pc|px)$/i.test(value.trim())
    ? value.trim()
    : "";
}

function odtParagraphStyle(paragraph: Element, styles: Map<string, OdtStyle>) {
  const styleName = paragraph.getAttributeNS(textNamespace, "style-name") || "";
  const paragraphStyle = resolvedOdtStyle(styleName, styles).paragraph;
  const declarations: string[] = [];
  const alignment = (paragraphStyle.align || "").toLowerCase();
  const align = alignment === "start" ? "left" : alignment === "end" ? "right" : alignment;
  if (["left", "right", "center", "justify"].includes(align)) declarations.push(`text-align:${align}`);
  const left = safeOdtMeasure(paragraphStyle.left);
  const right = safeOdtMeasure(paragraphStyle.right);
  const firstLine = safeOdtMeasure(paragraphStyle.firstLine);
  if (left) declarations.push(`margin-left:${left}`);
  if (right) declarations.push(`margin-right:${right}`);
  if (firstLine) declarations.push(`text-indent:${firstLine}`);
  return declarations.length ? ` style="${declarations.join(";")}"` : "";
}

function odtInlineContent(node: Node, styles: Map<string, OdtStyle>, inherited: InlineStyle = {}): ImportedContent {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent || "";
    if (/^\s*[\r\n]\s*$/u.test(text)) return { text: "", html: "" };
    return { text, html: escapeXml(text) };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return { text: "", html: "" };
  const element = node as Element;
  if (element.namespaceURI === textNamespace) {
    if (element.localName === "line-break") return { text: "\n", html: "<br>" };
    if (element.localName === "tab") return { text: "\t", html: "\t" };
    if (element.localName === "s") {
      const count = Math.min(1000, Math.max(1, Number(element.getAttributeNS(textNamespace, "c")) || 1));
      const text = " ".repeat(count);
      return { text, html: text };
    }
    if (element.localName === "p" || element.localName === "h") return { text: "", html: "" };
    const styleName = element.getAttributeNS(textNamespace, "style-name");
    const inlineStyle = styleName ? resolvedOdtStyle(styleName, styles).inline : {};
    const content = Array.from(element.childNodes)
      .map((child) => odtInlineContent(child, styles, mergeInlineStyles(inherited, inlineStyle)));
    const result = { text: content.map((part) => part.text).join(""), html: content.map((part) => part.html).join("") };
    return element.localName === "span" && styleName
      ? { ...result, html: wrappedInlineHtml(result.html, inlineStyle) }
      : result;
  }
  const content = Array.from(element.childNodes).map((child) => odtInlineContent(child, styles, inherited));
  return { text: content.map((part) => part.text).join(""), html: content.map((part) => part.html).join("") };
}

export async function readOdt(file: File): Promise<{ title: string; text: string; editorHtml: string }> {
  try {
    const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
    const document = parseXml(zippedXml(archive, "content.xml", "OpenDocument"), "OpenDocument");
    const body = document.getElementsByTagNameNS(officeNamespace, "text")[0];
    if (!body) throw new Error("This OpenDocument file has no readable text body.");
    const title = metadataTitle(archive);
    const documents = [document];
    if (archive["styles.xml"]) documents.push(parseXml(strFromU8(archive["styles.xml"]), "OpenDocument styles"));
    const styles = odtStyleMap(documents);
    const paragraphs = Array.from(body.getElementsByTagNameNS(textNamespace, "*"))
      .filter((paragraph) => paragraph.localName === "p" || paragraph.localName === "h")
      .map((paragraph) => {
        const content = Array.from(paragraph.childNodes).map((child) => odtInlineContent(child, styles));
        return {
          text: content.map((part) => part.text).join(""),
          html: `<p${odtParagraphStyle(paragraph, styles)}>${content.map((part) => part.html).join("") || "<br>"}</p>`,
        };
      });
    const imported = importedParagraphs(paragraphs, title);
    return { title, text: imported.text, editorHtml: imported.editorHtml };
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
