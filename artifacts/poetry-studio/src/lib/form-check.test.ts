import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePoemForm, splitPoemStanzas, type FormCheckLookups } from './form-check';
import type { FormEntry } from './poetry-forms';

const form: FormEntry = {
  name: 'Test form',
  structure: 'four lines',
  description: 'A deterministic form for tests.',
  example: 'AABB',
  exampleTitle: 'Test example',
  exampleUrl: 'https://example.com/poem',
  check: {
    lineCount: 4,
    stanzaPattern: [4],
    syllablePattern: [5, 7, 5, 7],
    rhymePatterns: [['A', 'A', 'B', 'B']],
  },
};

function lookups(syllables: Record<string, number>, rhymes: Record<string, string>): FormCheckLookups {
  return {
    countLineSyllables: async (line) => ({
      count: syllables[line] ?? 1,
      estimated: !(line in syllables),
      estimatedWords: line in syllables ? [] : [line.split(/\s+/).at(-1) ?? line],
    }),
    getRhymeKey: async (word) => rhymes[word.toLowerCase()] ?? null,
  };
}

test('splits non-empty lines into stanzas using blank lines', () => {
  assert.deepEqual(splitPoemStanzas('  first  \nsecond\n\n\nthird\n'), [['first', 'second'], ['third']]);
});

test('reports line, syllable, and rhyme deviations against a configured form', async () => {
  const poem = 'rose\nprose\nmoon\ntune';
  const result = await analyzePoemForm(poem, form, lookups(
    { rose: 5, prose: 7, moon: 5, tune: 6 },
    { rose: 'r', prose: 'r', moon: 'm', tune: 'm' },
  ));

  assert.equal(result.lineCount, 4);
  assert.equal(result.stanzaCount, 1);
  assert.equal(result.checks.find((item) => item.label === 'Line count')?.status, 'match');
  assert.equal(result.checks.find((item) => item.label === 'Syllables per line')?.status, 'warning');
  assert.equal(result.checks.find((item) => item.label === 'Rhyme · stanza 1')?.status, 'match');
  assert.equal(result.lineSyllables[3].expected, 7);
  assert.equal(result.lineSyllables[3].actual, 6);
});

test('marks rhyme checks as informational when pronunciation is unknown', async () => {
  const result = await analyzePoemForm('one\ntwo\nthree\nfour', form, lookups(
    { one: 5, two: 7, three: 5, four: 7 },
    { one: 'a', two: 'a', three: 'b' },
  ));

  assert.equal(result.checks.find((item) => item.label === 'Rhyme · stanza 1')?.status, 'info');
});

test('checks pantoum line repeats between adjacent stanzas', async () => {
  const pantoum: FormEntry = {
    ...form,
    name: 'Pantoum sample',
    check: {
      stanzaPattern: [4],
      repeatStanzaPattern: true,
      repeatedLinesAcrossStanzas: { sourceOffsets: [2, 4], targetOffsets: [1, 3] },
    },
  };
  const result = await analyzePoemForm(
    'first line\nsecond refrain\nthird line\nfourth refrain\n\nsecond refrain\nnew line\nfourth refrain\nlast line',
    pantoum,
  );

  assert.equal(result.checks.find((item) => item.label === 'Pantoum repetitions')?.status, 'match');
  assert.equal(result.checks.find((item) => item.label === 'Stanza shape')?.status, 'match');
});
