import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeBrowserMeter } from './browser-meter';
import type { PoeticStressLevel, ScannedWord } from './phonetics';

function scannedWords(levels: PoeticStressLevel[], estimatedAt = -1) {
  let offset = 0;
  const words = levels.map((level, index): ScannedWord => {
    const word = `sy${index}`;
    const start = offset;
    offset += word.length + 1;
    return {
      word,
      start,
      end: start + word.length,
      marks: [level === 's' ? '/' : level === 'm' || level === 'n' ? '\\' : 'u'],
      stressLevels: [level],
      lexicalStress: [level === 's' ? 1 : level === 'm' ? 2 : 0],
      syllableOffsets: [0],
      estimated: index === estimatedAt,
    };
  });
  return { words, line: words.map((word) => word.word).join(' ') };
}

test('recognizes a clean iambic pentameter pattern in the browser', () => {
  const { line, words } = scannedWords(['w', 's', 'w', 's', 'w', 's', 'w', 's', 'w', 's']);
  const result = analyzeBrowserMeter(line, words);

  assert.equal(result.best?.name, 'iambic pentameter');
  assert.equal(result.best?.fit, 100);
  assert.equal(result.best?.footBoundaries.length, 4);
});

test('ranks a clean anapestic pattern above the competing meters', () => {
  const { line, words } = scannedWords(['w', 'w', 's', 'w', 'w', 's', 'w', 'w', 's']);
  const result = analyzeBrowserMeter(line, words);

  assert.equal(result.best?.name, 'anapestic trimeter');
  assert.equal(result.best?.fit, 100);
});

test('does not claim a regular meter for a uniformly weak contour', () => {
  const { line, words } = scannedWords(Array.from({ length: 10 }, () => 'w'));
  const result = analyzeBrowserMeter(line, words);

  assert.equal(result.best, null);
  assert.ok(result.alternatives.length > 0);
});

test('reports when some syllable stresses are estimated', () => {
  const { line, words } = scannedWords(['w', 's', 'w', 's'], 2);
  const result = analyzeBrowserMeter(line, words);

  assert.equal(result.estimated, true);
  assert.match(result.note, /estimated/i);
});
