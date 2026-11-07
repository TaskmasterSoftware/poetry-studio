import type { BrowserPoemDraft } from "./poem-files";

export type PoemOrderDirection = "up" | "down";

export function reorderPoemsInBook(
  drafts: BrowserPoemDraft[],
  poemId: string,
  direction: PoemOrderDirection,
): BrowserPoemDraft[] {
  const poemIndex = drafts.findIndex((draft) => draft.id === poemId);
  if (poemIndex < 0) return drafts;

  const bookId = drafts[poemIndex].bookId;
  if (!bookId) return drafts;

  const bookIndexes = drafts.reduce<number[]>((indexes, draft, index) => {
    if (draft.bookId === bookId) indexes.push(index);
    return indexes;
  }, []);
  const bookPosition = bookIndexes.indexOf(poemIndex);
  const neighborPosition = bookPosition + (direction === "up" ? -1 : 1);
  if (bookPosition < 0 || neighborPosition < 0 || neighborPosition >= bookIndexes.length) return drafts;

  const nextDrafts = [...drafts];
  const neighborIndex = bookIndexes[neighborPosition];
  [nextDrafts[poemIndex], nextDrafts[neighborIndex]] = [nextDrafts[neighborIndex], nextDrafts[poemIndex]];
  return nextDrafts;
}
