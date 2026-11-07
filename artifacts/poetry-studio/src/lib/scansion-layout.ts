import type { ScannedWord } from "./phonetics";

export type ScanSymbol = "u" | "/" | "\\";
export type ScanLineEdit = {
  marks: Record<number, ScanSymbol>;
  feet: number[];
};
export type ScansionOverlayItem =
  | {
      kind: "syllable";
      id: string;
      lineKey: string;
      syllableIndex: number;
      symbol: ScanSymbol;
      left: number;
      top: number;
    }
  | {
      kind: "foot";
      id: string;
      lineKey: string;
      boundaryIndex: number;
      active: boolean;
      left: number;
      top: number;
    };

type TextPosition = { node: Text; offset: number };

const blockTags = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE"]);

function collectTextPositions(root: HTMLElement): (TextPosition | null)[] {
  const positions: (TextPosition | null)[] = [];

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const textNode = node as Text;
      for (let offset = 0; offset < (textNode.textContent?.length ?? 0); offset += 1) {
        positions.push({ node: textNode, offset });
      }
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    if (element.tagName === "BR") {
      positions.push(null);
      return;
    }
    for (const child of Array.from(element.childNodes)) visit(child);
    if (blockTags.has(element.tagName)) positions.push(null);
  };

  for (const child of Array.from(root.childNodes)) visit(child);
  while (positions.at(-1) === null) positions.pop();
  return positions;
}

export function layoutScansionOverlay(
  editor: HTMLElement,
  paper: HTMLElement,
  lines: string[],
  rows: ScannedWord[][],
  edits: Record<string, ScanLineEdit>,
): ScansionOverlayItem[] {
  const positions = collectTextPositions(editor);
  const paperRect = paper.getBoundingClientRect();
  const items: ScansionOverlayItem[] = [];
  let lineStart = 0;

  lines.forEach((line, lineIndex) => {
    if (!line.trim()) {
      lineStart += line.length + 1;
      return;
    }

    const lineKey = `${lineIndex}:${line}`;
    const lineEdit = edits[lineKey];
    const syllablePoints: { left: number; top: number }[] = [];
    let syllableIndex = 0;

    for (const word of rows[lineIndex] ?? []) {
      word.marks.forEach((defaultSymbol, wordSyllableIndex) => {
        const localOffset = word.start + word.syllableOffsets[wordSyllableIndex];
        const position = positions[lineStart + localOffset];
        if (!position) {
          syllableIndex += 1;
          return;
        }

        const range = document.createRange();
        range.setStart(position.node, position.offset);
        range.setEnd(position.node, position.offset + 1);
        const rect = range.getBoundingClientRect();
        const point = {
          left: rect.left - paperRect.left + rect.width / 2,
          top: rect.top - paperRect.top - 19,
        };
        const symbol = lineEdit?.marks[syllableIndex] ?? defaultSymbol;
        items.push({
          kind: "syllable",
          id: `syllable-${lineIndex}-${syllableIndex}`,
          lineKey,
          syllableIndex,
          symbol: symbol as ScanSymbol,
          ...point,
        });
        syllablePoints.push(point);
        syllableIndex += 1;
      });
    }

    for (let boundaryIndex = 1; boundaryIndex < syllablePoints.length; boundaryIndex += 1) {
      const before = syllablePoints[boundaryIndex - 1];
      const after = syllablePoints[boundaryIndex];
      if (Math.abs(before.top - after.top) > 5) continue;
      items.push({
        kind: "foot",
        id: `foot-${lineIndex}-${boundaryIndex}`,
        lineKey,
        boundaryIndex,
        active: lineEdit?.feet.includes(boundaryIndex) ?? false,
        left: (before.left + after.left) / 2,
        top: (before.top + after.top) / 2,
      });
    }

    lineStart += line.length + 1;
  });

  return items.filter((item) => Number.isFinite(item.left) && Number.isFinite(item.top));
}
