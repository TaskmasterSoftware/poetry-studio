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

export type ExportInlineStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  fontFamily?: string;
  fontSize?: string;
};
export type ExportRun = { text: string; style: ExportInlineStyle };
type OrderedListStyle = "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman" | "upper-roman";
export type ExportParagraph = {
  runs: ExportRun[];
  align?: "left" | "center" | "right" | "justify";
  left?: string;
  right?: string;
  firstLine?: string;
  listType?: "ordered" | "unordered";
  listLevel?: number;
  listId?: number;
  listStart?: number;
  listValue?: number;
  listStyle?: OrderedListStyle;
};

const editorBlockTags = new Set(["BLOCKQUOTE", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "OL", "P", "PRE", "UL"]);
const editorInlineTags = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE", "DEL", "SUP", "SUB"]);
const exportFontFamilies = new Set([
  "georgia, serif",
  "\"palatino linotype\", palatino, serif",
  "\"times new roman\", times, serif",
  "arial, helvetica, sans-serif",
  "verdana, geneva, sans-serif",
  "\"courier new\", courier, monospace",
  "\"trebuchet ms\", sans-serif",
]);

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
    if (property === "font-family" && exportFontFamilies.has(value)) style.fontFamily = value;
    if (property === "font-size") {
      const size = safeCssMeasure(value);
      const amount = Number.parseFloat(size);
      if (size && amount > 0 && amount <= 144) style.fontSize = size;
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

function firstFontName(value: string) {
  return value.split(",")[0].trim().replace(/^["']|["']$/g, "");
}

function fontSizeHalfPoints(value: string) {
  const twips = cssMeasureToTwips(value);
  return twips === undefined ? undefined : Math.round(twips / 10);
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

function cssOrderedListStyle(value: string): OrderedListStyle | undefined {
  const normalized = value.trim().toLowerCase();
  if (["decimal", "lower-alpha", "upper-alpha", "lower-roman", "upper-roman"].includes(normalized)) {
    return normalized as OrderedListStyle;
  }
  if (normalized === "lower-latin") return "lower-alpha";
  if (normalized === "upper-latin") return "upper-alpha";
  return undefined;
}

function orderedListStyle(list: Element): OrderedListStyle {
  let cssStyle: OrderedListStyle | undefined;
  for (const declaration of (list.getAttribute("style") || "").split(";")) {
    const separator = declaration.indexOf(":");
    if (separator < 0) continue;
    const property = declaration.slice(0, separator).trim().toLowerCase();
    const value = declaration.slice(separator + 1).trim().toLowerCase();
    if (property === "list-style-type") {
      cssStyle = cssOrderedListStyle(value) || cssStyle;
    } else if (property === "list-style") {
      const shorthandStyle = value.split(/\s+/).map(cssOrderedListStyle).find(Boolean);
      cssStyle = shorthandStyle || cssStyle;
    }
  }
  if (cssStyle) return cssStyle;

  switch ((list.getAttribute("type") || "").trim()) {
    case "a": return "lower-alpha";
    case "A": return "upper-alpha";
    case "i": return "lower-roman";
    case "I": return "upper-roman";
    default: return "decimal";
  }
}

function docxNumberFormat(style: OrderedListStyle) {
  switch (style) {
    case "lower-alpha": return "lowerLetter";
    case "upper-alpha": return "upperLetter";
    case "lower-roman": return "lowerRoman";
    case "upper-roman": return "upperRoman";
    default: return "decimal";
  }
}

function rtfNumberFormat(style: OrderedListStyle) {
  switch (style) {
    case "upper-roman": return 1;
    case "lower-roman": return 2;
    case "upper-alpha": return 3;
    case "lower-alpha": return 4;
    default: return 0;
  }
}

function odtNumberFormat(style: OrderedListStyle) {
  switch (style) {
    case "lower-alpha": return "a";
    case "upper-alpha": return "A";
    case "lower-roman": return "i";
    case "upper-roman": return "I";
    default: return "1";
  }
}

function odtListStyleName(listType: "ordered" | "unordered", style?: OrderedListStyle) {
  if (listType === "unordered") return "PoemBulletedList";
  switch (style || "decimal") {
    case "lower-alpha": return "PoemLowerAlphaList";
    case "upper-alpha": return "PoemUpperAlphaList";
    case "lower-roman": return "PoemLowerRomanList";
    case "upper-roman": return "PoemUpperRomanList";
    default: return "PoemNumberedList";
  }
}

function editorParagraphRuns(nodes: Node[], inherited: ExportInlineStyle = {}, includeBlocks = false): ExportRun[] {
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
      if (includeBlocks && tagName !== "OL" && tagName !== "UL") {
        Array.from(element.childNodes).forEach((child) => visit(child, nextStyle));
      }
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
    let nextListId = 1;
    const htmlListNumber = (element: Element, attribute: string) => {
      const value = (element.getAttribute(attribute) || "").trim();
      return /^[+-]?\d{1,6}$/.test(value) ? Number(value) : undefined;
    };
    const visitList = (list: Element, level: number) => {
      const listId = nextListId++;
      const listType = list.tagName.toUpperCase() === "OL" ? "ordered" : "unordered";
      const listStart = listType === "ordered" ? htmlListNumber(list, "start") : undefined;
      const listStyle = listType === "ordered" ? orderedListStyle(list) : undefined;
      let isFirstItem = true;
      for (const child of Array.from(list.childNodes)) {
        if (child.nodeType !== Node.ELEMENT_NODE || (child as Element).tagName.toUpperCase() !== "LI") continue;
        const item = child as Element;
        const contentNodes = Array.from(item.childNodes).filter((node) =>
          node.nodeType !== Node.ELEMENT_NODE
          || !["OL", "UL"].includes((node as Element).tagName.toUpperCase()),
        );
        paragraphs.push({
          runs: editorParagraphRuns(contentNodes, {}, true),
          ...editorParagraphStyle(item),
          listType,
          listLevel: level,
          listId,
          listStart: isFirstItem ? listStart : undefined,
          listValue: listType === "ordered" ? htmlListNumber(item, "value") : undefined,
          listStyle,
        });
        isFirstItem = false;
        const visitNestedLists = (container: ParentNode) => {
          for (const node of Array.from(container.childNodes)) {
            if (node.nodeType !== Node.ELEMENT_NODE) continue;
            const element = node as Element;
            const tagName = element.tagName.toUpperCase();
            if (tagName === "OL" || tagName === "UL") visitList(element, level + 1);
            else visitNestedLists(element);
          }
        };
        visitNestedLists(item);
      }
    };
    const visitContainer = (container: ParentNode) => {
      let inlineNodes: Node[] = [];
      const flushInline = () => {
        if (!inlineNodes.length) return;
        paragraphs.push({ runs: editorParagraphRuns(inlineNodes) });
        inlineNodes = [];
      };
      for (const node of Array.from(container.childNodes)) {
        if (node.nodeType === Node.ELEMENT_NODE && ["OL", "UL"].includes((node as Element).tagName.toUpperCase())) {
          flushInline();
          visitList(node as Element, 0);
        } else if (node.nodeType === Node.ELEMENT_NODE && editorBlockTags.has((node as Element).tagName.toUpperCase())) {
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

export function getEditorParagraphs(source: string | undefined, text: string) {
  return editorParagraphs(source, text);
}

function runsPlainText(runs: ExportRun[]) {
  return runs.map((run) => run.text).join("");
}

function docxRun(run: ExportRun) {
  const fontName = run.style.fontFamily ? firstFontName(run.style.fontFamily) : "";
  const fontSize = run.style.fontSize ? fontSizeHalfPoints(run.style.fontSize) : undefined;
  const properties = [
    fontName ? `<w:rFonts w:ascii="${escapeXml(validXmlText(fontName))}" w:hAnsi="${escapeXml(validXmlText(fontName))}"/>` : "",
    fontSize !== undefined ? `<w:sz w:val="${fontSize}"/><w:szCs w:val="${fontSize}"/>` : "",
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

function docxParagraph(paragraph: ExportParagraph, isTitle = false, numId?: number) {
  const line = runsPlainText(paragraph.runs);
  if (!line && !isTitle && paragraph.listId === undefined) return "<w:p/>";
  const properties = isTitle
    ? '<w:pStyle w:val="Title"/>'
    : [
      paragraph.listId !== undefined && paragraph.listLevel !== undefined
        ? `<w:numPr><w:ilvl w:val="${paragraph.listLevel}"/><w:numId w:val="${numId || paragraph.listId}"/></w:numPr>`
        : "",
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

function docxNumbering(paragraphs: ExportParagraph[]) {
  const listIds = Array.from(new Set(paragraphs.filter((paragraph) => paragraph.listId !== undefined)
    .map((paragraph) => paragraph.listId!)));
  const abstractNums = listIds.map((listId, index) => {
    const group = paragraphs.filter((paragraph) => paragraph.listId === listId);
    const listType = group[0]?.listType || "unordered";
    const maxLevel = Math.max(0, ...group.map((paragraph) => paragraph.listLevel || 0));
    const levels = Array.from({ length: maxLevel + 1 }, (_, level) => {
      const indent = 720 * (level + 1);
      const levelParagraph = group.find((paragraph) => (paragraph.listLevel || 0) === level) || group[0];
      const numberFormat = listType === "ordered" ? docxNumberFormat(levelParagraph?.listStyle || "decimal") : "bullet";
      const marker = listType === "ordered" ? `%${level + 1}.` : "•";
      const font = listType === "ordered" ? "" : '<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/></w:rPr>';
      return `<w:lvl w:ilvl="${level}"><w:start w:val="1"/><w:numFmt w:val="${numberFormat}"/><w:lvlText w:val="${marker}"/><w:lvlJc w:val="left"/>${font}<w:pPr><w:tabs><w:tab w:val="num" w:pos="${indent}"/></w:tabs><w:ind w:left="${indent}" w:hanging="360"/></w:pPr></w:lvl>`;
    }).join("");
    return `<w:abstractNum w:abstractNumId="${index + 1}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`;
  }).join("");
  const numberDefinitions = listIds.map((listId, index) =>
    `<w:num w:numId="${index + 1}"><w:abstractNumId w:val="${index + 1}"/></w:num>`,
  );
  const baseNumIds = new Map(listIds.map((listId, index) => [listId, index + 1]));
  const activeNumIds = new Map<string, number>();
  const paragraphNumIds = new Map<number, number>();
  let nextNumId = listIds.length + 1;
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph.listId === undefined || paragraph.listLevel === undefined) return;
    const level = Math.max(0, paragraph.listLevel);
    const key = `${paragraph.listId}:${level}`;
    let numId = activeNumIds.get(key) || baseNumIds.get(paragraph.listId)!;
    const start = paragraph.listValue ?? paragraph.listStart;
    if (start !== undefined) {
      numId = nextNumId++;
      numberDefinitions.push(
        `<w:num w:numId="${numId}"><w:abstractNumId w:val="${baseNumIds.get(paragraph.listId)}"/><w:lvlOverride w:ilvl="${level}"><w:startOverride w:val="${start}"/></w:lvlOverride></w:num>`,
      );
    }
    activeNumIds.set(key, numId);
    paragraphNumIds.set(paragraphIndex, numId);
  });
  return {
    paragraphNumIds,
    xml: `<w:numbering xmlns:w="${wordNamespace}">${abstractNums}${numberDefinitions.join("")}</w:numbering>`,
  };
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
      style.fontFamily ? `style:font-name="${escapeXml(validXmlText(firstFontName(style.fontFamily)))}"` : "",
      style.fontSize ? `fo:font-size="${escapeXml(style.fontSize)}"` : "",
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
  const paragraphXml = (paragraph: ExportParagraph) => {
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
  };

  type OdtListItem = {
    paragraph: ExportParagraph;
    listId: number;
    listType: "ordered" | "unordered";
    listStyle?: OrderedListStyle;
    startValue?: number;
    children: OdtListItem[];
  };
  const root: Array<ExportParagraph | OdtListItem> = [];
  const stack: OdtListItem[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.listId === undefined || paragraph.listType === undefined) {
      root.push(paragraph);
      stack.length = 0;
      continue;
    }
    const level = Math.max(0, paragraph.listLevel || 0);
    while (stack.length > level) stack.pop();
    const item: OdtListItem = {
      paragraph,
      listId: paragraph.listId,
      listType: paragraph.listType,
      listStyle: paragraph.listStyle,
      startValue: paragraph.listValue ?? paragraph.listStart,
      children: [],
    };
    const parent = level > 0 ? stack[level - 1] : undefined;
    if (parent) parent.children.push(item);
    else root.push(item);
    stack[level] = item;
  }

  const renderItems = (items: OdtListItem[]) => {
    let output = "";
    for (let index = 0; index < items.length;) {
      const first = items[index];
      let end = index + 1;
      while (end < items.length && items[end].listId === first.listId && items[end].listType === first.listType
        && items[end].listStyle === first.listStyle
        && items[end].startValue === undefined) end += 1;
      const listStyle = odtListStyleName(first.listType, first.listStyle);
      const listItems = items.slice(index, end).map((item) =>
        `<text:list-item>${paragraphXml(item.paragraph)}${renderItems(item.children)}</text:list-item>`,
      ).join("");
      const startValue = first.startValue !== undefined ? ` text:start-value="${first.startValue}"` : "";
      output += `<text:list text:style-name="${listStyle}"${startValue}>${listItems}</text:list>`;
      index = end;
    }
    return output;
  };
  const renderRoot = (nodes: Array<ExportParagraph | OdtListItem>) => {
    let output = "";
    for (let index = 0; index < nodes.length;) {
      const node = nodes[index];
      if (!("paragraph" in node)) {
        output += paragraphXml(node);
        index += 1;
        continue;
      }
      let end = index + 1;
      while (end < nodes.length && "paragraph" in nodes[end]
        && nodes[end].listId === node.listId && nodes[end].listType === node.listType
        && nodes[end].listStyle === node.listStyle) end += 1;
      output += renderItems(nodes.slice(index, end) as OdtListItem[]);
      index = end;
    }
    return output;
  };
  const hasUnordered = paragraphs.some((paragraph) => paragraph.listType === "unordered");
  const orderedStyles = Array.from(new Set(paragraphs
    .filter((paragraph) => paragraph.listType === "ordered")
    .map((paragraph) => paragraph.listStyle || "decimal")));
  const listStyles = [
    ...orderedStyles.map((style) => `<text:list-style style:name="${odtListStyleName("ordered", style)}">${Array.from({ length: 10 }, (_, level) =>
      `<text:list-level-style-number text:level="${level + 1}" style:num-format="${odtNumberFormat(style)}" style:num-suffix="."><style:list-level-properties text:space-before="${0.25 * (level + 1)}in" text:min-label-width="0.25in"/></text:list-level-style-number>`,
    ).join("")}</text:list-style>`),
    hasUnordered ? `<text:list-style style:name="PoemBulletedList">${Array.from({ length: 10 }, (_, level) =>
      `<text:list-level-style-bullet text:level="${level + 1}" text:bullet-char="•"><style:list-level-properties text:space-before="${0.25 * (level + 1)}in" text:min-label-width="0.25in"/></text:list-level-properties></text:list-level-style-bullet>`,
    ).join("")}</text:list-style>` : "",
  ].join("");
  return {
    body: renderRoot(root),
    paragraphStyles: `${paragraphStyles.join("")}${listStyles.replace("</style:list-level-properties>", "")}`,
    listStyles: "",
  };
}

function asBlob(bytes: Uint8Array, type: string) {
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new Blob([copy], { type });
}

function rtfRun(run: ExportRun, fontIds: Map<string, number>) {
  const fontId = run.style.fontFamily ? fontIds.get(run.style.fontFamily) : undefined;
  const fontSize = run.style.fontSize ? fontSizeHalfPoints(run.style.fontSize) : undefined;
  const controls = [
    fontId !== undefined ? `\\f${fontId}` : "",
    fontSize !== undefined ? `\\fs${fontSize}` : "",
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

function rtfParagraph(paragraph: ExportParagraph, listNumber: number | undefined, fontIds: Map<string, number>) {
  const controls = [
    paragraph.listId !== undefined && paragraph.listLevel !== undefined
      ? `\\ls${listNumber || 1}\\ilvl${paragraph.listLevel}`
      : "",
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
  const content = `${controls ? `{${controls} ` : ""}${paragraph.runs.map((run) => rtfRun(run, fontIds)).join("")}`;
  return `${content}${controls ? "\\par}" : "\\par"}\n`;
}

function rtfListTables(paragraphs: ExportParagraph[]) {
  const listIds = Array.from(new Set(paragraphs.filter((paragraph) => paragraph.listId !== undefined)
    .map((paragraph) => paragraph.listId!)));
  const instances: Array<{
    listId: number;
    listNumber: number;
    startLevel?: number;
    startValue?: number;
  }> = listIds.map((listId, index) => ({ listId, listNumber: index + 1 }));
  const activeListNumbers = new Map<string, number>();
  const paragraphListNumbers = new Map<number, number>();
  paragraphs.forEach((paragraph, paragraphIndex) => {
    if (paragraph.listId === undefined || paragraph.listLevel === undefined) return;
    const level = Math.max(0, paragraph.listLevel);
    const key = `${paragraph.listId}:${level}`;
    let listNumber = activeListNumbers.get(key) || listIds.indexOf(paragraph.listId) + 1;
    const start = paragraph.listValue ?? paragraph.listStart;
    if (start !== undefined) {
      listNumber = instances.length + 1;
      instances.push({ listId: paragraph.listId, listNumber, startLevel: level, startValue: start });
    }
    activeListNumbers.set(key, listNumber);
    paragraphListNumbers.set(paragraphIndex, listNumber);
  });
  const listDefinitions = instances.map((instance, index) => {
    const group = paragraphs.filter((paragraph) => paragraph.listId === instance.listId);
    const listType = group[0]?.listType || "unordered";
    const maxLevel = Math.max(0, ...group.map((paragraph) => paragraph.listLevel || 0));
    const levels = Array.from({ length: maxLevel + 1 }, (_, level) => {
      const indent = 720 * (level + 1);
      const levelParagraph = group.find((paragraph) => (paragraph.listLevel || 0) === level) || group[0];
      const levelText = listType === "ordered"
        ? `\\leveltext\\'02\\'${level.toString(16).padStart(2, "0")}.;}{\\levelnumbers\\'01;`
        : "\\leveltext\\'01\\'B7;}{\\levelnumbers;";
      const format = listType === "ordered" ? rtfNumberFormat(levelParagraph?.listStyle || "decimal") : 23;
      const levelStart = instance.startLevel === level ? instance.startValue : 1;
      return `{\\listlevel\\levelnfc${format}\\leveljc0\\levelfollow0\\levelstartat${levelStart}\\levelspace0\\levelindent${indent}{${levelText}}\\fi-360\\li${indent}}`;
    }).join("");
    const id = 1000 + index;
    return `{\\list\\listtemplateid${id}${levels}{\\listname ;}\\listid${id}}`;
  }).join("");
  const overrides = instances.map((instance, index) =>
    `{\\listoverride\\listid${1000 + index}\\listoverridecount0\\ls${index + 1}}`,
  ).join("");
  return { paragraphListNumbers, tables: listDefinitions ? `{\\*\\listtable${listDefinitions}}{\\*\\listoverridetable${overrides}}` : "" };
}

export function serializeRtf(title: string, text: string, editorHtml?: string) {
  const titleInfo = title.trim() ? `{\\info{\\title ${rtfText(title)}}}` : "";
  const visibleTitle = title.trim() ? `{\\b ${rtfText(title)}}\\par\n` : "";
  const paragraphs = editorParagraphs(editorHtml, text);
  const lists = rtfListTables(paragraphs);
  const fontNames = Array.from(new Set([
    "georgia, serif",
    ...paragraphs.flatMap((paragraph) => paragraph.runs
      .map((run) => run.style.fontFamily)
      .filter((family): family is string => Boolean(family))),
  ]));
  const fontIds = new Map(fontNames.map((family, index) => [family, index]));
  const fontTable = `{\\fonttbl${fontNames.map((family, index) =>
    `{\\f${index}\\fnil\\fcharset0 ${rtfText(firstFontName(family))};}`,
  ).join("")}}`;
  return new Blob(
    [`{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1 ${fontTable}${titleInfo}${lists.tables}\n${visibleTitle}${paragraphs.map((paragraph, index) => rtfParagraph(paragraph, lists.paragraphListNumbers.get(index), fontIds)).join("")}}`],
    { type: "application/rtf" },
  );
}

export function serializeDocx(title: string, text: string, editorHtml?: string) {
  const paragraphs = editorParagraphs(editorHtml, text);
  const numbering = docxNumbering(paragraphs);
  const titleParagraph = title.trim()
    ? `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${docxRun({ text: title, style: {} })}</w:p>`
    : "";
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
 <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${titleParagraph}${paragraphs.map((paragraph, index) => docxParagraph(paragraph, false, numbering.paragraphNumIds.get(index))).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(validXmlText(title))}</dc:title></cp:coreProperties>`;
  const archive = zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>'),
    "word/_rels/document.xml.rels": strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>'),
    "word/document.xml": strToU8(documentXml),
    "word/numbering.xml": strToU8(numbering.xml),
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
  const contentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2"><office:automatic-styles>${inlineStyles}${styledParagraphs.paragraphStyles}</office:automatic-styles><office:body><office:text>${titleContent}${styledParagraphs.listStyles}${styledParagraphs.body}</office:text></office:body></office:document-content>`;
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

const rtfCodePageEncodings: Record<number, string> = {
  874: "windows-874",
  932: "shift_jis",
  936: "gbk",
  949: "euc-kr",
  950: "big5",
  1200: "utf-16le",
  1250: "windows-1250",
  1251: "windows-1251",
  1252: "windows-1252",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
  65001: "utf-8",
  28591: "iso-8859-1",
  28592: "iso-8859-2",
  28593: "iso-8859-3",
  28594: "iso-8859-4",
  28595: "iso-8859-5",
  28596: "iso-8859-6",
  28597: "iso-8859-7",
  28598: "iso-8859-8",
  28599: "iso-8859-9",
  28603: "iso-8859-13",
  28605: "iso-8859-15",
};

function rtfEncoding(source: string): string {
  const codePage = Number(source.match(/\\ansicpg(\d+)/i)?.[1] || 1252);
  return rtfCodePageEncodings[codePage] || `windows-${codePage}`;
}

function decodeRtfBytes(bytes: number[], encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder("windows-1252").decode(new Uint8Array(bytes));
  }
}

function decodeRtfEscapedBytes(value: string, encoding: string): string {
  return value.replace(/(?:\\'[\da-f]{2})+/gi, (escapedBytes) => {
    const bytes = Array.from(escapedBytes.matchAll(/\\'([\da-f]{2})/gi), (match) => Number.parseInt(match[1], 16));
    return decodeRtfBytes(bytes, encoding);
  });
}

type RtfGroupState = {
  skip: boolean;
  unicodeFallback: number;
  style: InlineStyle;
  align?: "left" | "center" | "right" | "justify";
};

function rtfInlineHtml(text: string) {
  return text.split(/(\n)/).map((part) => part === "\n" ? "<br>" : escapeXml(part)).join("");
}

function rtfParagraphHtml(paragraph: ImportedContent & { align?: RtfGroupState["align"] }) {
  const style = paragraph.align ? ` style="text-align:${paragraph.align}"` : "";
  return `<p${style}>${paragraph.html || "<br>"}</p>`;
}

export function readRtf(source: string): { title: string; text: string; editorHtml: string } {
  const encoding = rtfEncoding(source);
  const rawTitle = source.match(/\\title\b((?:\\.|[^{}])*)/i)?.[1] || "";
  const title = rawTitle
    .replace(/(?:\\'[\da-f]{2})+/gi, (escapedBytes) => decodeRtfEscapedBytes(escapedBytes, encoding))
    .replace(/\\u(-?\d+)\??/g, (_match, value: string) => {
      const codeUnit = Number(value);
      return String.fromCharCode(codeUnit < 0 ? codeUnit + 65536 : codeUnit);
    })
    .replace(/\\([\\{}])/g, "$1")
    .replace(/\\~/g, " ")
    .replace(/\\_/g, "\u2011")
    .replace(/\\[a-zA-Z]+-?\d* ?/g, "")
    .trim();
  const groups: RtfGroupState[] = [{
    skip: false,
    unicodeFallback: 1,
    style: {},
  }];
  const paragraphs: (ImportedContent & { align?: RtfGroupState["align"] })[] = [];
  let runs: { text: string; style: InlineStyle }[] = [];
  let paragraphAlign: RtfGroupState["align"];
  let fallbackCharacters = 0;

  const append = (text: string, state: RtfGroupState) => {
    if (!text) return;
    const previous = runs[runs.length - 1];
    if (previous && JSON.stringify(previous.style) === JSON.stringify(state.style)) {
      previous.text += text;
    } else {
      runs.push({ text, style: { ...state.style } });
    }
  };
  const finishParagraph = (state: RtfGroupState) => {
    const text = runs.map((run) => run.text).join("");
    const html = runs.map((run) => wrappedInlineHtml(rtfInlineHtml(run.text), run.style)).join("");
    const paragraph = {
      text,
      html,
      align: paragraphAlign ?? state.align,
    };
    paragraphs.push({ ...paragraph, html: rtfParagraphHtml(paragraph) });
    runs = [];
    paragraphAlign = undefined;
  };

  for (let index = 0; index < source.length;) {
    const character = source[index];
    const group = groups[groups.length - 1];

    if (character === "{") {
      groups.push({ ...group, style: { ...group.style } });
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
        else append(character, group);
      }
      index += 1;
      continue;
    }

    const next = source[index + 1];
    if (!next) break;
    if (next === "'" && /^[\da-f]{2}$/i.test(source.slice(index + 2, index + 4))) {
      const bytes: number[] = [];
      while (source[index] === "\\" && source[index + 1] === "'" && /^[\da-f]{2}$/i.test(source.slice(index + 2, index + 4))) {
        bytes.push(Number.parseInt(source.slice(index + 2, index + 4), 16));
        index += 4;
      }
      const decodedCharacters = Array.from(decodeRtfBytes(bytes, encoding));
      if (!group.skip) {
        const skipped = Math.min(fallbackCharacters, decodedCharacters.length);
        fallbackCharacters -= skipped;
        append(decodedCharacters.slice(skipped).join(""), group);
      }
      continue;
    }
    if ("\\{}".includes(next)) {
      if (!group.skip) {
        if (fallbackCharacters > 0) fallbackCharacters -= 1;
        else append(next, group);
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
        else append(next === "~" ? " " : "\u2011", group);
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
      append(String.fromCharCode(codeUnit), group);
      fallbackCharacters = group.unicodeFallback;
    } else if (word === "par") {
      finishParagraph(group);
    } else if (word === "line" || word === "page" || word === "row") {
      append("\n", group);
    } else if (word === "tab" || word === "cell") {
      append("\t", group);
    } else if (word === "emdash") {
      append("\u2014", group);
    } else if (word === "endash") {
      append("\u2013", group);
    } else if (word === "bullet") {
      append("\u2022", group);
    } else if (word === "lquote") {
      append("\u2018", group);
    } else if (word === "rquote") {
      append("\u2019", group);
    } else if (word === "ldblquote") {
      append("\u201c", group);
    } else if (word === "rdblquote") {
      append("\u201d", group);
    } else if (word === "bin" && Number.isFinite(amount) && amount > 0) {
      index += amount;
    } else if (["b", "i", "ul", "ulw", "strike"].includes(word)) {
      const enabled = numericArgument === undefined || amount !== 0;
      if (word === "b") group.style.bold = enabled;
      if (word === "i") group.style.italic = enabled;
      if (word === "ul" || word === "ulw") group.style.underline = enabled;
      if (word === "strike") group.style.strike = enabled;
    } else if (word === "super") {
      group.style.superscript = true;
      group.style.subscript = false;
    } else if (word === "sub") {
      group.style.superscript = false;
      group.style.subscript = true;
    } else if (word === "nosupersub") {
      group.style.superscript = false;
      group.style.subscript = false;
    } else if (word === "ulnone") {
      group.style.underline = false;
    } else if (word === "plain") {
      group.style = {};
    } else if (["ql", "qc", "qr", "qj"].includes(word)) {
      group.align = ({ ql: "left", qc: "center", qr: "right", qj: "justify" } as const)[word as "ql" | "qc" | "qr" | "qj"];
      paragraphAlign = group.align;
    } else if (word === "pard") {
      group.align = undefined;
      paragraphAlign = undefined;
    }
  }

  if (runs.length || !paragraphs.length) finishParagraph(groups[groups.length - 1]);
  // A final \par is a paragraph terminator, not an extra poem stanza.
  if (paragraphs.length > 1 && !paragraphs[paragraphs.length - 1].text) paragraphs.pop();
  const imported = importedParagraphs(paragraphs, title);
  return {
    title,
    text: imported.text.replace(/\u0000/g, ""),
    editorHtml: imported.editorHtml,
  };
}
