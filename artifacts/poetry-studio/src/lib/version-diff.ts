export type VersionDiffSegment = {
  text: string;
  isWord: boolean;
  changed: boolean;
};

export type VersionWordDiff = {
  left: VersionDiffSegment[];
  right: VersionDiffSegment[];
};

const tokenPattern = /[\p{L}\p{M}\p{N}_]+(?:['’][\p{L}\p{M}\p{N}_]+)*|[^\p{L}\p{M}\p{N}_]+/gu;
const wordPattern = /^[\p{L}\p{M}\p{N}_]/u;

export function diffWords(leftText: string, rightText: string): VersionWordDiff {
  const tokenize = (text: string) => Array.from(text.matchAll(tokenPattern), ([token]) => ({
    text: token,
    isWord: wordPattern.test(token),
    changed: false,
  }));
  const left = tokenize(leftText);
  const right = tokenize(rightText);
  const leftWordIndexes = left.flatMap((token, index) => token.isWord ? [index] : []);
  const rightWordIndexes = right.flatMap((token, index) => token.isWord ? [index] : []);
  const rows = leftWordIndexes.length + 1;
  const columns = rightWordIndexes.length + 1;
  const commonLengths = Array.from({ length: rows }, () => new Uint32Array(columns));

  for (let leftIndex = leftWordIndexes.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = rightWordIndexes.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const leftWord = left[leftWordIndexes[leftIndex]].text;
      const rightWord = right[rightWordIndexes[rightIndex]].text;
      commonLengths[leftIndex][rightIndex] = leftWord === rightWord
        ? commonLengths[leftIndex + 1][rightIndex + 1] + 1
        : Math.max(commonLengths[leftIndex + 1][rightIndex], commonLengths[leftIndex][rightIndex + 1]);
    }
  }

  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < leftWordIndexes.length && rightIndex < rightWordIndexes.length) {
    const leftTokenIndex = leftWordIndexes[leftIndex];
    const rightTokenIndex = rightWordIndexes[rightIndex];
    if (left[leftTokenIndex].text === right[rightTokenIndex].text) {
      leftIndex += 1;
      rightIndex += 1;
    } else if (commonLengths[leftIndex + 1][rightIndex] >= commonLengths[leftIndex][rightIndex + 1]) {
      left[leftTokenIndex].changed = true;
      leftIndex += 1;
    } else {
      right[rightTokenIndex].changed = true;
      rightIndex += 1;
    }
  }
  while (leftIndex < leftWordIndexes.length) {
    left[leftWordIndexes[leftIndex]].changed = true;
    leftIndex += 1;
  }
  while (rightIndex < rightWordIndexes.length) {
    right[rightWordIndexes[rightIndex]].changed = true;
    rightIndex += 1;
  }

  return { left, right };
}
