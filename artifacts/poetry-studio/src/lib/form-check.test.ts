import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzePoemForm, splitPoemStanzas, type FormCheckLookups } from './form-check';
import { forms, type FormEntry } from './poetry-forms';

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

test('requires a variant choice before checking forms with multiple conventions', async () => {
  const sonnet = forms.find((entry) => entry.name === 'Sonnet');
  assert.ok(sonnet);
  const result = await analyzePoemForm('line one\nline two', sonnet);

  assert.equal(result.checks.length, 1);
  assert.equal(result.checks[0].label, 'Form variant');
  assert.match(result.checks[0].detail, /Choose a form variant/);
});

test('uses the selected sonnet variant for stanza and rhyme expectations', async () => {
  const sonnet = forms.find((entry) => entry.name === 'Sonnet');
  assert.ok(sonnet);
  const poem = [
    'red', 'blue', 'bed', 'true',
    '', 'stone', 'gray', 'known', 'day',
    '', 'fire', 'green', 'desire', 'seen',
    '', 'light', 'night',
  ].join('\n');
  const result = await analyzePoemForm(poem, sonnet, lookups({}, {}), 'shakespearean');

  assert.equal(result.variantName, 'Shakespearean');
  assert.deepEqual(result.checks.find((item) => item.label === 'Stanza shape')?.status, 'match');
  assert.deepEqual(result.rhymeChecks.map((item) => item.expected), ['ABAB', 'CDCD', 'EFEF', 'GG']);
  assert.equal(result.notes.some((note) => note.includes('turn in thought')), true);
});

test('checks word counts for the didactic cinquain variant', async () => {
  const cinquain = forms.find((entry) => entry.name === 'Cinquain');
  assert.ok(cinquain);
  const poem = 'Bird\nQuiet bird\nBirds are singing\nWakes the sleeping garden\nSpring';
  const result = await analyzePoemForm(poem, cinquain, lookups({}, {}), 'didactic');

  assert.equal(result.variantName, 'Didactic');
  assert.equal(result.checks.find((item) => item.label === 'Words per line')?.status, 'match');
  assert.deepEqual(result.lineWords.map((line) => line.expected), [1, 2, 3, 4, 1]);
  assert.equal(result.lineSyllables.length, 0);
});

test('checks rhyme links that continue across sonnet stanzas', async () => {
  const sonnet = forms.find((entry) => entry.name === 'Sonnet');
  assert.ok(sonnet);
  const result = await analyzePoemForm([
    'one', 'blue', 'three', 'true',
    '', 'blue', 'nine', 'true', 'fine',
    '', 'nine', 'day', 'nine', 'way',
    '', 'end', 'end',
  ].join('\n'), sonnet, lookups({}, {
    blue: 'b', true: 'b', nine: 'c', fine: 'c', day: 'd', way: 'd',
  }), 'spenserian');

  assert.equal(result.checks.find((item) => item.label === 'Linked stanza rhymes')?.status, 'match');
});

test('checks chant royal line and stanza expectations for the selected convention', async () => {
  const chantRoyal = forms.find((entry) => entry.name === 'Chant royal');
  assert.ok(chantRoyal);
  const stanzas = [
    ...Array.from({ length: 5 }, (_, stanza) =>
      Array.from({ length: 11 }, (_, line) => `stanza ${stanza + 1} line ${line + 1}`).join('\n')),
    Array.from({ length: 5 }, (_, line) => `envoy line ${line + 1}`).join('\n'),
  ];
  const result = await analyzePoemForm(stanzas.join('\n\n'), chantRoyal, lookups({}, {}), 'eleven-line-stanzas');

  assert.equal(result.lineCount, 60);
  assert.equal(result.checks.find((item) => item.label === 'Line count')?.status, 'match');
  assert.equal(result.checks.find((item) => item.label === 'Stanza shape')?.status, 'match');
  assert.ok(result.notes.some((note) => /rhyme scheme and refrain/i.test(note)));
});
