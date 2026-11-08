import { countLineSyllables, getRhymeKey, type SyllableCountResult } from './phonetics';
import type { FormEntry, FormCheckSpec } from './poetry-forms';

export type FormCheckStatus = 'match' | 'warning' | 'info';

export type FormCheckItem = {
  label: string;
  status: FormCheckStatus;
  detail: string;
};

export type FormLineSyllables = {
  line: number;
  actual: number;
  expected?: number;
  estimatedWords: string[];
};

export type FormRhymeCheck = {
  stanza: number;
  expected: string;
  actual: string;
  status: FormCheckStatus;
};

export type FormCheckResult = {
  formName: string;
  lineCount: number;
  stanzaCount: number;
  checks: FormCheckItem[];
  lineSyllables: FormLineSyllables[];
  rhymeChecks: FormRhymeCheck[];
  notes: string[];
};

export type FormCheckLookups = {
  countLineSyllables: (line: string) => Promise<SyllableCountResult>;
  getRhymeKey: (word: string) => Promise<string | null>;
};

const defaultLookups: FormCheckLookups = { countLineSyllables, getRhymeKey };

export function splitPoemStanzas(text: string) {
  const stanzas: string[][] = [];
  let current: string[] = [];

  for (const sourceLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = sourceLine.trim();
    if (!line) {
      if (current.length) {
        stanzas.push(current);
        current = [];
      }
      continue;
    }
    current.push(line);
  }

  if (current.length) stanzas.push(current);
  return stanzas;
}

function lastWord(line: string) {
  return line.match(/[a-z]+(?:['’][a-z]+)?/gi)?.at(-1) ?? '';
}

function normalizeLine(line: string) {
  return line
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

async function detectedRhymePattern(lines: string[], lookups: FormCheckLookups) {
  const keys = await Promise.all(lines.map((line) => lookups.getRhymeKey(lastWord(line))));
  const labels = new Map<string, string>();
  let nextLabel = 0;
  return keys.map((key) => {
    if (!key) return '?';
    if (!labels.has(key)) labels.set(key, String.fromCharCode(65 + nextLabel++));
    return labels.get(key)!;
  });
}

function rhymePatternMatches(expected: string[], actual: string[]) {
  if (expected.length !== actual.length) return false;
  const expectedToActual = new Map<string, string>();
  const actualToExpected = new Map<string, string>();

  for (let index = 0; index < expected.length; index++) {
    if (expected[index] === '-') continue;
    if (actual[index] === '?') return null;
    const expectedLabel = expected[index].toUpperCase();
    const actualLabel = actual[index];
    if (expectedToActual.has(expectedLabel) && expectedToActual.get(expectedLabel) !== actualLabel) return false;
    if (actualToExpected.has(actualLabel) && actualToExpected.get(actualLabel) !== expectedLabel) return false;
    expectedToActual.set(expectedLabel, actualLabel);
    actualToExpected.set(actualLabel, expectedLabel);
  }
  return true;
}

function rhymePatternText(pattern: string[]) {
  return pattern.map((label) => label === '-' ? '·' : label.toUpperCase()).join('');
}

function addFinding(checks: FormCheckItem[], label: string, pass: boolean, success: string, issue: string) {
  checks.push({ label, status: pass ? 'match' : 'warning', detail: pass ? success : issue });
}

export async function analyzePoemForm(
  text: string,
  form: FormEntry,
  lookups: FormCheckLookups = defaultLookups,
): Promise<FormCheckResult> {
  const stanzas = splitPoemStanzas(text);
  const lines = stanzas.flat();
  const spec: FormCheckSpec = form.check ?? {};
  const checks: FormCheckItem[] = [];
  const lineSyllables: FormLineSyllables[] = [];
  const rhymeChecks: FormRhymeCheck[] = [];
  const notes = [
    'Blank lines mark stanza breaks. Syllable counts use a pronunciation dictionary with rough estimates for unknown words.',
    'Rhyme checks compare dictionary pronunciations for exact end rhymes; slant rhyme, dialect, meter, and deliberate variation may be missed.',
    ...(spec.notes ?? []),
  ];

  if (!lines.length) {
    checks.push({ label: 'Poem', status: 'info', detail: 'Add poem lines to run the form check.' });
    return { formName: form.name, lineCount: 0, stanzaCount: 0, checks, lineSyllables, rhymeChecks, notes };
  }

  if (spec.lineCount !== undefined) {
    addFinding(
      checks,
      'Line count',
      lines.length === spec.lineCount,
      `${lines.length} lines, as expected.`,
      `${lines.length} lines; this form commonly uses ${spec.lineCount}.`,
    );
  }

  if (spec.minimumLineCount !== undefined || spec.lineCountMultipleOf !== undefined) {
    const meetsMinimum = spec.minimumLineCount === undefined || lines.length >= spec.minimumLineCount;
    const meetsMultiple = spec.lineCountMultipleOf === undefined || lines.length % spec.lineCountMultipleOf === 0;
    addFinding(
      checks,
      'Line count',
      meetsMinimum && meetsMultiple,
      `${lines.length} lines meets the configured minimum and grouping.`,
      `${lines.length} lines; this form expects at least ${spec.minimumLineCount ?? 1} lines${spec.lineCountMultipleOf ? ` in groups of ${spec.lineCountMultipleOf}` : ''}.`,
    );
  }

  if (spec.stanzaPattern?.length) {
    const expectedStanzas = spec.repeatStanzaPattern
      ? stanzas.map((_, index) => spec.stanzaPattern![index % spec.stanzaPattern!.length])
      : spec.stanzaPattern;
    const matches = stanzas.length === expectedStanzas.length
      && stanzas.every((stanza, index) => stanza.length === expectedStanzas[index]);
    const actualShape = stanzas.map((stanza) => stanza.length).join(' / ');
    const expectedShape = expectedStanzas.join(' / ');
    addFinding(
      checks,
      'Stanza shape',
      matches,
      `Stanza line counts: ${actualShape}.`,
      `Stanza line counts are ${actualShape}; expected ${expectedShape}.`,
    );
  }

  if (spec.syllablePattern?.length) {
    const syllableCounts = await Promise.all(lines.map((line) => lookups.countLineSyllables(line)));
    const lineResults = syllableCounts.map((result, index) => ({
      line: index + 1,
      actual: result.count,
      expected: spec.repeatSyllablePattern
        ? spec.syllablePattern![index % spec.syllablePattern!.length]
        : spec.syllablePattern![index],
      estimatedWords: result.estimatedWords,
    }));
    lineSyllables.push(...lineResults);
    const expectedLineCount = spec.repeatSyllablePattern ? lines.length : spec.syllablePattern.length;
    const matches = lines.length === expectedLineCount
      && lineResults.every((result) => result.expected !== undefined && result.actual === result.expected);
    const matched = lineResults.filter((result) => result.expected !== undefined && result.actual === result.expected).length;
    addFinding(
      checks,
      'Syllables per line',
      matches,
      `All ${lines.length} line counts match the configured pattern.`,
      `${matched} of ${lineResults.length} line counts match the configured pattern.`,
    );
    if (syllableCounts.some((result) => result.estimated)) {
      checks.push({
        label: 'Syllable estimate',
        status: 'info',
        detail: 'At least one word was not in the pronunciation dictionary; its count is estimated from spelling.',
      });
    }
  }

  if (spec.rhymePatterns?.length) {
    for (let index = 0; index < stanzas.length; index++) {
      const expected = spec.repeatRhymePattern
        ? spec.rhymePatterns[index % spec.rhymePatterns.length]
        : spec.rhymePatterns[index];
      if (!expected) break;
      const actual = await detectedRhymePattern(stanzas[index], lookups);
      const match = rhymePatternMatches(expected, actual);
      const status: FormCheckStatus = match === null ? 'info' : match ? 'match' : 'warning';
      rhymeChecks.push({
        stanza: index + 1,
        expected: rhymePatternText(expected),
        actual: actual.join(''),
        status,
      });
      checks.push({
        label: `Rhyme · stanza ${index + 1}`,
        status,
        detail: match === null
          ? `Expected ${rhymePatternText(expected)}; at least one end word is missing from the pronunciation dictionary.`
          : match
            ? `Detected ${actual.join('')}, consistent with ${rhymePatternText(expected)}.`
            : `Detected ${actual.join('')}; expected rhyme pattern ${rhymePatternText(expected)}.`,
      });
    }
  }

  if (spec.rhymeWithAnchorEveryNthLine) {
    const { anchorLine, every, alsoLines = [] } = spec.rhymeWithAnchorEveryNthLine;
    const positions = [...new Set([
      ...alsoLines,
      ...Array.from({ length: Math.ceil(lines.length / every) }, (_, index) => anchorLine + index * every),
    ])].filter((line) => line <= lines.length);
    const anchor = await lookups.getRhymeKey(lastWord(lines[anchorLine - 1] ?? ''));
    const keys = await Promise.all(positions.map((line) => lookups.getRhymeKey(lastWord(lines[line - 1] ?? ''))));
    const unknown = !anchor || keys.some((key) => !key);
    const matches = Boolean(anchor) && keys.every((key) => key === anchor);
    const status: FormCheckStatus = unknown ? 'info' : matches ? 'match' : 'warning';
    checks.push({
      label: 'Ghazal end rhymes',
      status,
      detail: unknown
        ? 'Some relevant end words are missing from the pronunciation dictionary.'
        : matches
          ? `Lines ${positions.join(', ')} share the rhyme of line ${anchorLine}.`
          : `Lines ${positions.join(', ')} should rhyme with line ${anchorLine}.`,
    });
  }

  if (spec.repeatedLines?.length) {
    const results = spec.repeatedLines.map(([first, second]) => {
      const firstText = normalizeLine(lines[first - 1] ?? '');
      const secondText = normalizeLine(lines[second - 1] ?? '');
      return firstText.length > 0 && firstText === secondText;
    });
    addFinding(
      checks,
      'Repeated lines',
      results.every(Boolean),
      'Configured refrain lines repeat in the expected positions.',
      `${results.filter(Boolean).length} of ${results.length} configured refrain repetitions match.`,
    );
  }

  if (spec.repeatedLinesAcrossStanzas) {
    const { sourceOffsets, targetOffsets } = spec.repeatedLinesAcrossStanzas;
    const repetitions: boolean[] = [];
    for (let stanzaIndex = 0; stanzaIndex < stanzas.length - 1; stanzaIndex++) {
      for (let offsetIndex = 0; offsetIndex < sourceOffsets.length; offsetIndex++) {
        const from = normalizeLine(stanzas[stanzaIndex][sourceOffsets[offsetIndex] - 1] ?? '');
        const to = normalizeLine(stanzas[stanzaIndex + 1][targetOffsets[offsetIndex] - 1] ?? '');
        repetitions.push(from.length > 0 && from === to);
      }
    }
    addFinding(
      checks,
      'Pantoum repetitions',
      repetitions.length > 0 && repetitions.every(Boolean),
      'The expected lines repeat at the start of the next stanza.',
      `${repetitions.filter(Boolean).length} of ${repetitions.length} line repetitions match.`,
    );
  }

  if (spec.cascadeOpeningLines) {
    const openingStanza = stanzas[0];
    const repetitions = openingStanza.map((line, index) =>
      normalizeLine(line) === normalizeLine(stanzas[index + 1]?.at(-1) ?? ''),
    );
    addFinding(
      checks,
      'Cascade lines',
      repetitions.length > 0 && repetitions.every(Boolean),
      'Each opening-stanza line returns at the end of a later stanza.',
      `${repetitions.filter(Boolean).length} of ${repetitions.length} opening lines return in the expected later stanzas.`,
    );
  }

  if (!checks.length) {
    checks.push({
      label: 'Structure',
      status: 'info',
      detail: `${lines.length} lines in ${stanzas.length} stanza${stanzas.length === 1 ? '' : 's'}; this form has no single fixed pattern for the checker to grade.`,
    });
  }

  return { formName: form.name, lineCount: lines.length, stanzaCount: stanzas.length, checks, lineSyllables, rhymeChecks, notes };
}
