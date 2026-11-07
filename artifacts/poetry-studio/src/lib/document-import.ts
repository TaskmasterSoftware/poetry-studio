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

type ExportInlineStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
};
type ExportRun = { text: string; style: ExportInlineStyle };
type ExportParagraph = {
  runs: ExportRun[];
  align?: "left" | "center" | "right" | "justify";
  left?: string;
  right?: string;
  firstLine?: string;
};

const editorBlockTags = new Set(["BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "P", "PRE"]);
const editorInlineTags = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "SUP", "SUB"]);

function mergeExportStyles(...styles: ExportInlineStyle[]): ExportInlineStyle {
  return Object.assign({}, ...styles);
}

function editorInlineStyle(element: Element, inherited: ExportInlineStyle): ExportInlineStyle {
  const style = mergeExportStyles(inherited);
  const tagName = element.tagName.toUpperCase();
  if (["B", "STRONG"].includes(tagName)) style.bold = true;
  if (["I", "EM"].includes(tagName)) style.italic = true;
  if (tagName === "U") style.underline = true;
  if (["S", "STRIKE", "DEL"].includes(tagName)) style.strike = true;
  if (tagName === "SUP") style.superscript = true;
  if (tagName === "SUB") style.subscript = true;

  const css = element.getAttribute("style") || "";
  for (const declaration of css.split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase();
    if (property === "font-weight" && value) style.bold = value === "bold" || Number(value) >= 600;
    if (property === "font-style" && value) style.italic = value === "italic" || value === "oblique";
    if (property === "text-decoration" || property === "text-decoration-line") {
      if (value) {
        style.underline = value.includes("underline");
        style.strike = value.includes("line-through");
      }
    }
    if (property === "vertical-align") {
      if (value === "super") style.superscript = true;
      if (value === "sub") style.subscript = true;
    }
  }
  return style;
}

function safeCssMeasure(value: string) {
  const normalized = value.trim().toLowerCase();
  return /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:pt|in|cm|mm|px|pc)$/i.test(normalized) ? normalized : "";
}

function cssMeasureToTwips(value: string) {
  const match = value.match(/^(-?(?:\d+(?:\.\d+)?|\.\d+))(pt|in|cm|mm|px|pc)$/i);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const pointsPerUnit: Record<string, number> = {
    pt: 1, in: 72, cm: 72 / 2.54, mm: 72 / 25.4, px: 0.75, pc: 12,
  };
  return Math.round(amount * pointsPerUnit[match[2].toLowerCase()] * 20);
}

function editorParagraphStyle(element: Element): Pick<ExportParagraph, "align" | "left" | "right" | "firstLine"> {
  const declarations: Record<string, string> = {};
  for (const declaration of (element.getAttribute("style") || "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    declarations[declaration.slice(0, separator).trim().toLowerCase()] = declaration.slice(separator + 1).trim().toLowerCase();
  }
  const alignment = declarations["text-align"];
  return {
    align: ["left", "center", "right", "justify"].includes(alignment)
      ? alignment as ExportParagraph["align"]
      : undefined,
    left: safeCssMeasure(declarations["margin-left"] || ""),
    right: safeCssMeasure(declarations["margin-right"] || ""),
    firstLine: safeCssMeasure(declarations["text-indent"] || ""),
  };
}

function editorParagraphRuns(nodes: Node[], inherited: ExportInlineStyle = {}): ExportRun[] {
  const runs: ExportRun[] = [];
  const append = (text: string, style: ExportInlineStyle) => {
    if (!text) return;
    const previous = runs[runs.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text;
    else runs.push({ text, style });
  };
  const visit = (node: Node, style: ExportInlineStyle) => {
    if (node.nodeType === Node.TEXT_NODE) {
      append(node.textContent || "", style);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    const tagName = element.tagName.toUpperCase();
    const nextStyle = editorInlineStyle(element, style);
    if (tagName === "BR") {
      append("\n", style);
    } else if (tagName === "WBR") {
      return;
    } else if (editorBlockTags.has(tagName)) {
      return;
    } else if (editorInlineTags.has(tagName) || element.hasAttribute("style")) {
      Array.from(element.childNodes).forEach((child) => visit(child, nextStyle));
    } else {
      Array.from(element.childNodes).forEach((child) => visit(child, style));
    }
  };
  nodes.forEach((node) => visit(node, inherited));
  return runs;
}

function editorParagraphs(source: string | undefined, text: string): ExportParagraph[] {
  if (source && typeof DOMParser !== "undefined") {
    const document = new DOMParser().parseFromString(`<html><body>${source}</body></html>`, "text/html");
    const root = document.body || document.getElementsByTagName("body")[0] || document.documentElement;
    if (!root) return text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({
      runs: line ? [{ text: line, style: {} }] : [],
    }));
    const paragraphs: ExportParagraph[] = [];
    const visitContainer = (container: ParentNode) => {
      let inlineNodes: Node[] = [];
      const flushInline = () => {
        if (!inlineNodes.length) return;
        paragraphs.push({ runs: editorParagraphRuns(inlineNodes) });
        inlineNodes = [];
      };
      for (const node of Array.from(container.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE && editorBlockTags.has((node as Element).tagName.toUpperCase())) {
          const block = node as Element;
          const nestedBlocks = Array.from(block.childNodes).some((child) =>
            child.nodeType === Node.ELEMENT_NODE
            && editorBlockTags.has((child as Element).tagName.toUpperCase()),
          );
          if (nestedBlocks) {
            flushInline();
            visitContainer(block);
          } else {
            flushInline();
            const children = Array.from(block.childNodes);
            const isEmptyLine = children.some((child) =>
              child.nodeType === Node.ELEMENT_NODE
              && (child as Element).tagName.toUpperCase() === "BR",
            ) && children.every((child) =>
              (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toUpperCase() === "BR")
              || (child.nodeType === Node.TEXT_NODE && !(child.textContent || "").trim()),
            );
            paragraphs.push({
              runs: isEmptyLine ? [] : editorParagraphRuns(children),
              ...editorParagraphStyle(block),
            });
          }
        } else if (node.nodeType === Node.TEXT_NODE && !(node.textContent || "").trim()) {
          continue;
        } else {
          inlineNodes.push(node);
        }
      }
      flushInline();
    };
    visitContainer(root);
    if (paragraphs.length) return paragraphs;
  }
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => ({
    runs: line ? [{ text: line, style: {} }] : [],
  }));
}

function runsPlainText(runs: ExportRun[]) {
  return runs.map((run) => run.text).join("");
}

function docxRun(run: ExportRun) {
  const properties = [
    run.style.bold ? "<w:b/>" : "",
    run.style.italic ? "<w:i/>" : "",
    run.style.underline ? '<w:u w:val="single"/>' : "",
    run.style.strike ? "<w:strike/>" : "",
    run.style.superscript ? '<w:vertAlign w:val="superscript"/>' : "",
    run.style.subscript ? '<w:vertAlign w:val="subscript"/>' : "",
  ].filter(Boolean).join("");
  const content = run.text.split(/(\n|\t)/).map((part) => {
    if (part === "\n") return "<w:br/>";
    if (part === "\t") return "<w:tab/>";
    return part ? `<w:t xml:space="preserve">${escapeXml(validXmlText(part))}</w:t>` : "";
  }).join("");
  return `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}${content}</w:r>`;
}

function docxParagraph(paragraph: ExportParagraph, isTitle = false) {
  const line = runsPlainText(paragraph.runs);
  if (!line && !isTitle) return "<w:p/>";
  const properties = isTitle
    ? '<w:pStyle w:val="Title"/>'
    : [
      paragraph.align ? `<w:jc w:val="${paragraph.align}"/>` : "",
      (() => {
        const left = cssMeasureToTwips(paragraph.left || "");
        const right = cssMeasureToTwips(paragraph.right || "");
        const firstLine = cssMeasureToTwips(paragraph.firstLine || "");
        return left !== undefined || right !== undefined || firstLine !== undefined
          ? `<w:ind${left !== undefined ? ` w:left="${left}"` : ""}${right !== undefined ? ` w:right="${right}"` : ""}${firstLine !== undefined ? ` w:firstLine="${firstLine}"` : ""}/>`
          : "";
      })(),
    ].filter(Boolean).join("");
  const runs = paragraph.runs.map(docxRun).join("");
  return `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${runs || "<w:r><w:t></w:t></w:r>"}</w:p>`;
}

function odtInlineStyles(paragraphs: ExportParagraph[]) {
  const styles = new Map<string, ExportInlineStyle>();
  for (const paragraph of paragraphs) for (const run of paragraph.runs) {
    if (Object.values(run.style).some(Boolean)) styles.set(JSON.stringify(run.style), run.style);
  }
  const entries = Array.from(styles.entries());
  const names = new Map(entries.map(([key], index) => [key, `PoemText${index + 1}`]));
  const xml = entries.map(([key, style]) => {
    const properties = [
      style.bold ? 'fo:font-weight="bold"' : "",
      style.italic ? 'fo:font-style="italic"' : "",
      style.underline ? 'style:text-underline-style="solid"' : "",
      style.strike ? 'style:text-line-through-style="solid"' : "",
      style.superscript ? 'style:text-position="super 58%"' : "",
      style.subscript ? 'style:text-position="sub 58%"' : "",
    ].filter(Boolean).join(" ");
    return `<style:style style:name="${names.get(key)}" style:family="text"><style:text-properties ${properties}/></style:style>`;
  }).join("");
  return { names, xml };
}

function odtRun(run: ExportRun, names: Map<string, string>) {
  const content = run.text.split(/(\n|\t)/).map((part) => {
    if (part === "\n") return "<text:line-break/>";
    if (part === "\t") return "<text:tab/>";
    return escapeXml(validXmlText(part));
  }).join("");
  const name = names.get(JSON.stringify(run.style));
  return name ? `<text:span text:style-name="${name}">${content}</text:span>` : content;
}

function odtParagraphs(paragraphs: ExportParagraph[], names: Map<string, string>) {
  const paragraphStyles: string[] = [];
  const body = paragraphs.map((paragraph) => {
    const content = paragraph.runs.map((run) => odtRun(run, names)).join("");
    const styleAttributes = [
      paragraph.align ? `fo:text-align="${paragraph.align}"` : "",
      paragraph.left ? `fo:margin-left="${paragraph.left}"` : "",
      paragraph.right ? `fo:margin-right="${paragraph.right}"` : "",
      paragraph.firstLine ? `fo:text-indent="${paragraph.firstLine}"` : "",
    ].filter(Boolean).join(" ");
    const styleName = styleAttributes ? `PoemParagraph${paragraphStyles.length + 1}` : "";
    if (styleName) {
      paragraphStyles.push(`<style:style style:name="${styleName}" style:family="paragraph"><style:paragraph-properties ${styleAttributes}/></style:style>`);
    }
    return !runsPlainText(paragraph.runs)
      ? "<text:p/>"
      : `<text:p${styleName ? ` text:style-name="${styleName}"` : ""}>${content}</text:p>`;
  }).join("");
  return { body, paragraphStyles: paragraphStyles.join("") };
}

function asBlob(bytes: Uint8Array, type: string) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([copy], { type });
}

function rtfRun(run: ExportRun) {
  const controls = [
    run.style.bold ? "\\b" : "",
    run.style.italic ? "\\i" : "",
    run.style.underline ? "\\ul" : "",
    run.style.strike ? "\\strike" : "",
    run.style.superscript ? "\\super" : "",
    run.style.subscript ? "\\sub" : "",
  ].filter(Boolean).join("");
  const content = run.text.split(/(\n|\t)/).map((part) =>
    part === "\n" ? "\\line " : part === "\t" ? "\\tab " : rtfText(part),
  ).join("");
  return controls ? `{${controls} ${content}}` : content;
}

function rtfParagraph(paragraph: ExportParagraph) {
  const controls = [
    paragraph.align === "center" ? "\\qc" : "",
    paragraph.align === "right" ? "\\qr" : "",
    paragraph.align === "justify" ? "\\qj" : "",
    paragraph.align === "left" ? "\\ql" : "",
    paragraph.left ? (() => {
      const value = cssMeasureToTwips(paragraph.left!);
      return value === undefined ? "" : `\\li${value}`;
    })() : "",
    paragraph.right ? (() => {
      const value = cssMeasureToTwips(paragraph.right!);
      return value === undefined ? "" : `\\ri${value}`;
    })() : "",
    paragraph.firstLine ? (() => {
      const value = cssMeasureToTwips(paragraph.firstLine!);
      return value === undefined ? "" : `\\fi${value}`;
    })() : "",
  ].filter(Boolean).join("");
  return `${controls ? `{${controls} ` : ""}${paragraph.runs.map(rtfRun).join("")}${controls ? "}" : ""}\\par\n`;
}

export function serializeRtf(title: string, text: string, editorHtml?: string) {
  const titleInfo = title.trim() ? `{\\info{\\title ${rtfText(title)}}}` : "";
  const visibleTitle = title.trim() ? `{\\b ${rtfText(title)}}\\par\n` : "";
  const paragraphs = editorParagraphs(editorHtml, text);
  return new Blob(
    [`{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1 ${titleInfo}\n${visibleTitle}${paragraphs.map(rtfParagraph).join("")}}`],
    { type: "application/rtf" },
  );
}

export function serializeDocx(title: string, text: string, editorHtml?: string) {
  const paragraphs = editorParagraphs(editorHtml, text);
  const titleParagraph = title.trim()
    ? `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${docxRun({ text: title, style: {} })}</w:p>`
    : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${titleParagraph}${paragraphs.map((paragraph) => docxParagraph(paragraph)).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
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

export function serializeOdt(title: string, text: string, editorHtml?: string) {
  const paragraphs = editorParagraphs(editorHtml, text);
  const { names, xml: inlineStyles } = odtInlineStyles(paragraphs);
  const styledParagraphs = odtParagraphs(paragraphs, names);
  const titleContent = title.trim()
    ? `<text:h text:outline-level="1">${escapeXml(validXmlText(title))}</text:h>`
    : "";
  const contentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2"><office:automatic-styles>${inlineStyles}${styledParagraphs.paragraphStyles}</office:automatic-styles><office:body><office:text>${titleContent}${styledParagraphs.body}</office:text></office:body></office:document-content>`;
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
