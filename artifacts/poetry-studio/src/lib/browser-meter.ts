import type { PoeticStressLevel, ScannedWord } from './phonetics';

/**
 * A browser-local English meter-fit prototype, inspired by Calliope-TS's
 * gradient-foot and dynamic-fit approach. It intentionally omits Calliope's
 * dependency parser and syntax-derived phrase stress.
 *
 * Adapted for client-only use from Calliope-TS 0.1.8 by Aleksey Calvin
 * Tsukanov, Apache-2.0. See artifacts/poetry-studio/THIRD_PARTY_NOTICES.md.
 */

type Expectation = 'W' | 'S';
type MeterName = 'iambic' | 'trochaic' | 'anapestic' | 'dactylic' | 'amphibrachic' | 'bacchic';

type Syllable = {
  stress: PoeticStressLevel;
  lexicalStress: number;
  isContent: boolean;
  isLineFinal: boolean;
  isPPStart: boolean;
  caesuraBefore: boolean;
  phraseEnd: boolean;
  wordIndex: number;
  isWordStart: boolean;
  isPoly: boolean;
  estimated: boolean;
  promotable: boolean;
  clashAdjacent: boolean;
};

type FootTemplate = {
  pattern: Expectation[];
  penalty: number;
  primary?: boolean;
  atStart?: boolean;
  atEnd?: boolean;
  countsAsFoot?: boolean;
  edgePenalty?: number;
  middlePenalty?: number;
  edgeNeedsNoAccentable?: number[];
};

type FootFit = {
  score: number;
  feet: number[];
  primary: boolean[];
  countsAsFoot: boolean[];
  strongOffsets: number[][];
};

export type BrowserMeterCandidate = {
  name: string;
  footCount: number;
  fit: number;
  confidence: number;
  scansion: string;
  footBoundaries: number[];
};

export type BrowserMeterEstimate = {
  best: BrowserMeterCandidate | null;
  alternatives: BrowserMeterCandidate[];
  estimated: boolean;
  note: string;
};

const substitutions = {
  inversionEdge: -0.4,
  inversionMiddle: -3.0,
  ternaryInDuple: -3.2,
  dupleInTernary: -1.3,
  pyrrhic: -1.6,
  spondee: -1.6,
  catalexis: -0.4,
  feminineEnding: -0.5,
  anacrusis: -0.5,
  doubleAnacrusis: -1.2,
  acephalous: -0.6,
  orphan: -8,
} as const;

const meterNames: MeterName[] = ['iambic', 'trochaic', 'anapestic', 'dactylic', 'amphibrachic', 'bacchic'];
const strongLevels = new Set<PoeticStressLevel>(['s', 'm']);
const weakLevels = new Set<PoeticStressLevel>(['x', 'w', 'n']);
const stressRank: Record<PoeticStressLevel, number> = { x: 0, w: 1, n: 2, m: 3, s: 4 };
const ternaryMeters = new Set<MeterName>(['anapestic', 'dactylic', 'amphibrachic', 'bacchic']);
const fallingMeters = new Set<MeterName>(['trochaic', 'dactylic']);

function lineLengthName(feet: number) {
  return ['', 'monometer', 'dimeter', 'trimeter', 'tetrameter', 'pentameter', 'hexameter', 'heptameter', 'octameter'][feet]
    ?? `${feet}-foot`;
}

function templatesFor(meter: MeterName): FootTemplate[] {
  const P = substitutions;
  const S = (pattern: string, penalty = 0, options: Omit<FootTemplate, 'pattern' | 'penalty'> = {}): FootTemplate => ({
    pattern: [...pattern] as Expectation[],
    penalty,
    ...options,
  });

  let templates: FootTemplate[];
  switch (meter) {
    case 'iambic':
      templates = [
        S('WS', 0, { primary: true }),
        { ...S('SW'), edgePenalty: P.inversionEdge, middlePenalty: P.inversionMiddle },
        { ...S('WWS'), edgePenalty: -1.8, middlePenalty: P.ternaryInDuple, edgeNeedsNoAccentable: [0, 1] },
        S('WW', P.pyrrhic),
        S('SS', P.spondee),
        S('WSW', P.feminineEnding, { atEnd: true }),
        S('S', P.catalexis, { atEnd: true, primary: true }),
      ];
      break;
    case 'trochaic':
      templates = [
        S('SW', 0, { primary: true }),
        S('S', P.catalexis, { atEnd: true, primary: true }),
        { ...S('WS'), edgePenalty: P.inversionEdge, middlePenalty: P.inversionMiddle },
        { ...S('SWW'), edgePenalty: -1.8, middlePenalty: P.ternaryInDuple, edgeNeedsNoAccentable: [1, 2] },
        S('SS', P.spondee),
        S('WW', P.pyrrhic),
        S('W', P.anacrusis, { atStart: true, countsAsFoot: false }),
        S('WW', P.doubleAnacrusis, { atStart: true }),
      ];
      break;
    case 'anapestic':
      templates = [
        S('WWS', 0, { primary: true }),
        S('WS', P.dupleInTernary),
        S('S', P.acephalous, { atStart: true }),
        S('WS', P.acephalous, { atStart: true }),
        S('WWSW', P.feminineEnding, { atEnd: true }),
        S('WSW', P.feminineEnding, { atEnd: true }),
      ];
      break;
    case 'dactylic':
      templates = [
        S('SWW', 0, { primary: true }),
        S('SW', P.dupleInTernary, { atEnd: true, primary: true }),
        S('S', P.catalexis, { atEnd: true, primary: true }),
        S('SW', P.dupleInTernary),
        S('W', P.anacrusis, { atStart: true, countsAsFoot: false }),
        S('WW', P.doubleAnacrusis, { atStart: true }),
      ];
      break;
    case 'amphibrachic':
      templates = [
        S('WSW', 0, { primary: true }),
        S('WS', P.catalexis, { atEnd: true, primary: true }),
        S('SW', P.acephalous, { atStart: true }),
        S('S', P.acephalous, { atStart: true }),
        S('WSWW', P.feminineEnding, { atEnd: true }),
        S('S', P.ternaryInDuple, { atEnd: true }),
      ];
      break;
    case 'bacchic':
      templates = [
        S('WSS', 0, { primary: true }),
        S('WS', P.catalexis, { atEnd: true, primary: true }),
        S('SS', P.acephalous, { atStart: true }),
        S('S', P.acephalous, { atStart: true }),
      ];
      break;
  }

  templates.push(S('S', P.orphan), S('W', P.orphan, { countsAsFoot: false }));
  return templates;
}

function buildSyllables(line: string, words: ScannedWord[]): Syllable[] {
  const syllables: Syllable[] = [];
  let previousWordEnd = 0;
  const boundary = /[,;:!?—–.()[\]]/;

  words.forEach((word, wordIndex) => {
    const gapBefore = line.slice(previousWordEnd, word.start);
    const gapAfter = line.slice(word.end, words[wordIndex + 1]?.start ?? line.length);
    const caesuraBefore = wordIndex > 0 && boundary.test(gapBefore);
    const phraseEnd = boundary.test(gapAfter) || wordIndex === words.length - 1;
    const levels = word.stressLevels.length ? word.stressLevels : word.marks.map((mark) => mark === '/' ? 's' : 'w');

    levels.forEach((stress, syllableIndex) => {
      syllables.push({
        stress,
        lexicalStress: word.lexicalStress?.[syllableIndex] ?? (stress === 's' ? 1 : 0),
        isContent: stress === 's' || stress === 'm' || (stress === 'n' && (word.lexicalStress?.[syllableIndex] ?? 0) > 0),
        isLineFinal: wordIndex === words.length - 1 && syllableIndex === levels.length - 1,
        isPPStart: caesuraBefore && syllableIndex === 0,
        caesuraBefore: caesuraBefore && syllableIndex === 0,
        phraseEnd: phraseEnd && syllableIndex === levels.length - 1,
        wordIndex,
        isWordStart: syllableIndex === 0,
        isPoly: levels.length > 1,
        estimated: word.estimated,
        promotable: false,
        clashAdjacent: false,
      });
    });
    previousWordEnd = word.end;
  });

  syllables.forEach((syllable, index) => {
    const before = syllables[index - 1];
    const after = syllables[index + 1];
    const lowBefore = !before || stressRank[before.stress] <= stressRank.w;
    const lowAfter = !after || stressRank[after.stress] <= stressRank.w;
    syllable.promotable = (syllable.stress === 'w' || syllable.stress === 'n') && lowBefore && lowAfter;
    syllable.clashAdjacent = Boolean(
      (before && strongLevels.has(before.stress)) || (after && strongLevels.has(after.stress)),
    );
  });
  return syllables;
}

function scoreSyllable(syllable: Syllable, expected: Expectation) {
  const actual = syllable.stress;
  if (expected === 'S') {
    if (actual === 's') return 4;
    if (actual === 'm') return 3;
    if (actual === 'n') {
      if (syllable.lexicalStress >= 2) return 2.5;
      if (syllable.isLineFinal) return 2.2;
      return syllable.isContent ? 1.5 : 1.3;
    }
    if (actual === 'x') return syllable.promotable ? 0 : -3.2;
    if (syllable.isLineFinal) return 1.5;
    if (syllable.promotable) return 0.3;
    return syllable.lexicalStress >= 2 ? 0 : -2.5;
  }

  if (actual === 'x') return 2.2;
  if (actual === 'w') return 2;
  if (actual === 'n') return 1.6;
  if (actual === 'm') return syllable.isPPStart ? 0.5 : syllable.clashAdjacent ? -0.3 : -1.2;
  if (syllable.isPPStart) return -0.6;
  return syllable.clashAdjacent ? -1.3 : -3.2;
}

function fitMeter(syllables: Syllable[], meter: MeterName): FootFit {
  const templates = templatesFor(meter);
  const memo: Array<FootFit | undefined> = new Array(syllables.length + 1);

  const solve = (start: number): FootFit => {
    if (start === syllables.length) return { score: 0, feet: [], primary: [], countsAsFoot: [], strongOffsets: [] };
    if (memo[start]) return memo[start]!;

    let best: FootFit = { score: Number.NEGATIVE_INFINITY, feet: [], primary: [], countsAsFoot: [], strongOffsets: [] };
    for (const template of templates) {
      const length = template.pattern.length;
      const end = start + length;
      if (end > syllables.length) continue;
      if (template.atStart && start !== 0) continue;
      if (template.atEnd && end !== syllables.length) continue;

      const edge = start === 0 || end === syllables.length || syllables[start].caesuraBefore;
      const edgeIsLicensed = edge && (template.edgeNeedsNoAccentable ?? []).every(
        (offset) => syllables[start + offset]?.stress !== 'n',
      );
      let footScore = template.edgePenalty !== undefined
        ? edgeIsLicensed
          ? template.edgePenalty
          : template.middlePenalty ?? template.penalty
        : template.penalty;
      let caesuraInside = false;
      const strongOffsets: number[] = [];
      for (let offset = 0; offset < length; offset += 1) {
        footScore += scoreSyllable(syllables[start + offset], template.pattern[offset]);
        if (template.pattern[offset] === 'S') strongOffsets.push(offset);
        if (offset > 0 && syllables[start + offset].caesuraBefore) caesuraInside = true;
      }
      if (caesuraInside) footScore -= 1;

      const remainder = solve(end);
      if (remainder.score === Number.NEGATIVE_INFINITY) continue;
      const score = footScore + remainder.score;
      if (score > best.score) {
        best = {
          score,
          feet: [length, ...remainder.feet],
          primary: [Boolean(template.primary), ...remainder.primary],
          countsAsFoot: [template.countsAsFoot !== false, ...remainder.countsAsFoot],
          strongOffsets: [strongOffsets, ...remainder.strongOffsets],
        };
      }
    }
    memo[start] = best;
    return best;
  };

  return solve(0);
}

function evaluateFit(syllables: Syllable[], fit: FootFit) {
  const beats = new Set<number>();
  const footBoundaries: number[] = [];
  let position = 0;
  let cleanFeet = 0;
  let maxScore = 0;
  let scansion = '';

  for (let footIndex = 0; footIndex < fit.feet.length; footIndex += 1) {
    const length = fit.feet[footIndex];
    const strongOffsets = new Set(fit.strongOffsets[footIndex]);
    let clean = fit.primary[footIndex];

    for (let offset = 0; offset < length; offset += 1) {
      const syllable = syllables[position + offset];
      const expectedStrong = strongOffsets.has(offset);
      maxScore += expectedStrong ? 4 : 2;
      if (expectedStrong) beats.add(position + offset);
      if (expectedStrong ? !strongLevels.has(syllable.stress) : strongLevels.has(syllable.stress)) clean = false;
      scansion += `${syllable.stress}`;
    }
    if (clean) cleanFeet += 1;
    position += length;
    if (position < syllables.length) {
      footBoundaries.push(position);
      scansion += '|';
    }
  }

  let matchedEdges = 0;
  let totalEdges = 0;
  let segmentStart = 0;
  for (let index = 0; index < syllables.length; index += 1) {
    if (!syllables[index].phraseEnd) continue;
    let edge = -1;
    for (let cursor = index; cursor >= segmentStart; cursor -= 1) {
      if (strongLevels.has(syllables[cursor].stress)) {
        edge = cursor;
        break;
      }
    }
    if (edge >= 0) {
      totalEdges += syllables[index].isLineFinal ? 3 : 1;
      if (beats.has(edge)) matchedEdges += syllables[index].isLineFinal ? 3 : 1;
    }
    segmentStart = index + 1;
  }
  const rightEdge = totalEdges ? matchedEdges / totalEdges : 0;
  const cleanRatio = fit.feet.length ? cleanFeet / fit.feet.length : 0;
  const firstBeat = syllables.findIndex((syllable) => strongLevels.has(syllable.stress));
  const fitFraction = maxScore ? fit.score / maxScore : 0;
  const footCount = fit.countsAsFoot.filter(Boolean).length;
  return {
    fitFraction,
    rightEdge,
    cleanRatio,
    footCount,
    confidence: Math.round(Math.max(0, Math.min(1, 0.7 * cleanRatio + 0.3 * rightEdge)) * 100),
    footBoundaries,
    scansion,
  };
}

function meterLabel(meter: MeterName, feet: number) {
  return `${meter} ${lineLengthName(feet)}`;
}

export function analyzeBrowserMeter(line: string, words: ScannedWord[]): BrowserMeterEstimate {
  const syllables = buildSyllables(line, words);
  const estimated = words.some((word) => word.estimated);
  if (!syllables.length) {
    return { best: null, alternatives: [], estimated: false, note: 'Add a line of English text to scan.' };
  }

  const scored = meterNames.map((meter) => {
    const fit = fitMeter(syllables, meter);
    const evaluated = evaluateFit(syllables, fit);
    const firstBeat = syllables.findIndex((syllable) => strongLevels.has(syllable.stress));
    const onsetBonus = evaluated.footCount > 0 && firstBeat >= 0
      ? (fallingMeters.has(meter) === (firstBeat === 0) ? 0.05 : 0)
      : 0;
    const score = evaluated.fitFraction
      + 0.28 * evaluated.rightEdge
      + 0.12 * evaluated.cleanRatio
      + onsetBonus
      + (ternaryMeters.has(meter) ? 0.02 : 0)
      + (meter === 'iambic' ? 0.02 : 0);

    return {
      meter,
      score,
      candidate: {
        name: meterLabel(meter, evaluated.footCount),
        footCount: evaluated.footCount,
        fit: Math.round(Math.max(0, Math.min(1, evaluated.fitFraction)) * 100),
        confidence: evaluated.confidence,
        scansion: evaluated.scansion,
        footBoundaries: evaluated.footBoundaries,
      },
    };
  }).sort((a, b) => b.score - a.score);

  const top = scored[0];
  const best = top && top.score >= 0.62 && top.candidate.footCount > 0 ? top.candidate : null;
  const alternatives = scored
    .slice(best ? 1 : 0, best ? 4 : 3)
    .filter((item) => item.candidate.footCount > 0)
    .map((item) => item.candidate);

  return {
    best,
    alternatives,
    estimated,
    note: estimated
      ? 'At least one word is missing from the local pronunciation dictionary, so its stress is estimated.'
      : 'This browser prototype uses lexical stress and punctuation cues; it does not yet model syntax-derived phrase stress.',
  };
}
