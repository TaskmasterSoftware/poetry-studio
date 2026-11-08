export type FormCheckSpec = {
  lineCount?: number;
  minimumLineCount?: number;
  lineCountMultipleOf?: number;
  syllablePattern?: number[];
  repeatSyllablePattern?: boolean;
  stanzaPattern?: number[];
  repeatStanzaPattern?: boolean;
  rhymePatterns?: string[][];
  repeatRhymePattern?: boolean;
  repeatedLines?: Array<[number, number]>;
  repeatedLinesAcrossStanzas?: { sourceOffsets: number[]; targetOffsets: number[] };
  cascadeOpeningLines?: boolean;
  rhymeWithAnchorEveryNthLine?: { anchorLine: number; every: number; alsoLines?: number[] };
  notes?: string[];
};

export type FormEntry = {
  name: string;
  aliases?: string[];
  structure: string;
  description: string;
  example: string;
  exampleTitle: string;
  exampleUrl: string;
  check?: FormCheckSpec;
};

// Keep exampleTitle and exampleUrl required so every form has a reference.
export const forms: FormEntry[] = [
  {
    name: 'Abecedarian',
    structure: 'alphabetical sequence · lines or stanzas',
    description: 'Each line or stanza begins with the next letter of the alphabet.',
    example: 'A → B → C …',
    exampleTitle: '“Hangul Abecedarian” by Franny Choi',
    exampleUrl: 'https://www.poetryfoundation.org/poetrymagazine/poems/151514/hangul-abecedarian',
    check: { notes: ['Alphabetical progression is not checked automatically.'] },
  },
  {
    name: 'Acrostic',
    structure: 'letters spell a word or phrase',
    description: 'Letters in a chosen position—often the first of each line—spell a word or message.',
    example: 'initial letters read downward',
    exampleTitle: 'Acrostic examples from the Poetry Foundation',
    exampleUrl: 'https://www.poetryfoundation.org/articles/1594990/acrostics',
    check: { notes: ['Acrostic spelling needs a target word, which is not currently stored with the poem.'] },
  },
  {
    name: 'Ballad',
    structure: 'narrative song · often ABCB quatrains',
    description: 'A story-driven, song-like poem; many English ballads use alternating four- and three-stress lines.',
    example: 'ABCB · DEFE',
    exampleTitle: '“The Unquiet Grave”',
    exampleUrl: 'https://www.poetryfoundation.org/poems/50403/the-unquiet-grave',
    check: { stanzaPattern: [4], repeatStanzaPattern: true, rhymePatterns: [['A', 'B', 'C', 'B']], repeatRhymePattern: true },
  },
  {
    name: 'Balliol rhyme',
    structure: '4 lines · AABB · four beats per line',
    description: 'A comic portrait in the voice of its subject, usually in two rhyming couplets.',
    example: 'AABB',
    exampleTitle: 'Balliol rhyme examples',
    exampleUrl: 'https://en.wikipedia.org/wiki/Balliol_rhyme',
    check: { lineCount: 4, stanzaPattern: [4], rhymePatterns: [['A', 'A', 'B', 'B']] },
  },
  {
    name: 'Blank verse',
    structure: 'unrhymed iambic pentameter',
    description: 'Unrhymed lines in a regular meter, most often iambic pentameter.',
    example: 'five iambs · no end rhyme',
    exampleTitle: '“Paradise Lost,” Book 12 by John Milton',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45748/paradise-lost-book-12-1674-version',
    check: { notes: ['Meter and substitutions are not graded; read the stress pattern aloud.'] },
  },
  {
    name: 'Cascade',
    structure: 'stanzas · opening lines return as refrains',
    description: 'Each line in the opening stanza becomes the final line of a later stanza.',
    example: 'a / b / c · d / e / a · f / g / b …',
    exampleTitle: 'Cascade poem examples at dVerse',
    exampleUrl: 'https://dversepoets.com/2026/02/05/mtb-revisiting-cascade-poems',
    check: { cascadeOpeningLines: true, notes: ['Blank lines are treated as stanza breaks.'] },
  },
  {
    name: 'Chant royal',
    structure: 'five stanzas + envoy · repeated rhyme scheme',
    description: 'A French fixed form with repeated stanza rhymes and an envoy; stanza length and refrain vary by version.',
    example: 'five matching stanzas · envoy',
    exampleTitle: '“To May, the Prince of Months” and other examples',
    exampleUrl: 'https://www.classicalpoets.org/chant-royal',
    check: { notes: ['Chant royal variants differ in stanza length and refrain; review the chosen variant manually.'] },
  },
  {
    name: 'Cinquain',
    aliases: ['cinquin'],
    structure: '5 lines · several established patterns',
    description: 'A five-line form with multiple traditions; the American form uses 2 / 4 / 6 / 8 / 2 syllables.',
    example: '2 · 4 · 6 · 8 · 2',
    exampleTitle: 'Adelaide Crapsey’s “Verse”',
    exampleUrl: 'https://www.gutenberg.org/cache/epub/63010/pg63010.html',
    check: { lineCount: 5, stanzaPattern: [5], syllablePattern: [2, 4, 6, 8, 2], notes: ['This checks the American syllabic cinquain; other cinquain forms differ.'] },
  },
  {
    name: 'Clerihew',
    structure: '4 lines · AABB',
    description: 'A deliberately irregular, comic quatrain that sketches a person’s biography.',
    example: 'AABB · uneven line lengths',
    exampleTitle: '“Edmund Clerihew Bentley” by John Foster',
    exampleUrl: 'https://childrens.poetryarchive.org/poem/edmund-clerihew-bentley/',
    check: { lineCount: 4, stanzaPattern: [4], rhymePatterns: [['A', 'A', 'B', 'B']] },
  },
  {
    name: 'Copla',
    structure: 'Spanish lyric stanza · patterns vary',
    description: 'A Spanish-language song and verse tradition with several stanza forms; copla manriqueña is one well-known variation.',
    example: 'varies by regional and stanza form',
    exampleTitle: '“Coplas por la muerte de su padre” by Jorge Manrique',
    exampleUrl: 'https://www.uv.es/ivorra/Literatura/Coplas.htm',
    check: { notes: ['Copla patterns vary by tradition; this checker does not choose a regional variant.'] },
  },
  {
    name: 'Elegy',
    structure: 'variable · grief and remembrance',
    description: 'A poem of mourning or reflection on loss; it does not require one fixed meter or rhyme scheme.',
    example: 'lament · reflection · remembrance',
    exampleTitle: '“Elegy Written in a Country Churchyard” by Thomas Gray',
    exampleUrl: 'https://www.poetryfoundation.org/poems/44299/elegy-written-in-a-country-churchyard',
    check: { notes: ['Elegies do not have one required line count, meter, or rhyme scheme.'] },
  },
  {
    name: 'Epigram',
    structure: 'brief · pointed or witty turn',
    description: 'A short, compressed poem or saying that ends with a sharp observation, joke, or twist.',
    example: 'setup · turn',
    exampleTitle: '“Epigram” by Matthew Prior',
    exampleUrl: 'https://www.eighteenthcenturypoetry.org/works/pmp18-w0650.shtml',
    check: { notes: ['The checker cannot assess wit, compression, or the final turn.'] },
  },
  {
    name: 'Free verse',
    structure: 'open form · no fixed scheme',
    description: 'Line, breath, image, and sound create the structure without a regular meter or rhyme scheme.',
    example: 'follow the music of the sentence',
    exampleTitle: '“When I Heard the Learn’d Astronomer” by Walt Whitman',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45479/when-i-heard-the-learnd-astronomer',
    check: { notes: ['Free verse has no required syllable count or rhyme scheme.'] },
  },
  {
    name: 'Ghazal',
    structure: 'couplets · rhyme + refrain',
    description: 'Self-contained couplets linked by a shared rhyme and a repeating refrain.',
    example: 'AA · BA · CA · DA …',
    exampleTitle: '“Ghazal” by Agha Shahid Ali',
    exampleUrl: 'https://www.poetryfoundation.org/poems/43279/ghazal-56d221fe8a756',
    check: {
      minimumLineCount: 10,
      lineCountMultipleOf: 2,
      stanzaPattern: [2],
      repeatStanzaPattern: true,
      rhymeWithAnchorEveryNthLine: { anchorLine: 2, every: 2, alsoLines: [1] },
      notes: ['The refrain and ghazal-specific couplet independence are not checked.'],
    },
  },
  {
    name: 'Golden shovel',
    structure: 'source line · words become line endings',
    description: 'Each word of a chosen source line ends a successive line, preserving the source line when read downward.',
    example: 'line endings read as the source poem',
    exampleTitle: '“The Golden Shovel” by Terrance Hayes',
    exampleUrl: 'https://www.poetryfoundation.org/poems/55678/the-golden-shovel',
    check: { notes: ['Add or choose the source line before checking; source-line correspondence is not currently stored.'] },
  },
  {
    name: 'Haibun',
    structure: 'prose + haiku',
    description: 'A prose passage is paired or interwoven with haiku, often to shape a travel or nature reflection.',
    example: 'prose passage · haiku',
    exampleTitle: '“Time Traveler’s Haibun: 1989” by Maureen Thorson',
    exampleUrl: 'https://www.poetryfoundation.org/poems/149728/time-traveler39s-haibun-1989',
    check: { notes: ['The prose-and-haiku relationship is not automatically classified.'] },
  },
  {
    name: 'Haiku',
    structure: '3 lines · often 5 / 7 / 5 in English',
    description: 'A brief image or moment, traditionally attentive to season and nature; English syllable counts are approximate.',
    example: 'short · long · short',
    exampleTitle: '“Haiku” by Etheridge Knight',
    exampleUrl: 'https://www.poetryfoundation.org/poems/47593/haiku',
    check: { lineCount: 3, stanzaPattern: [3], syllablePattern: [5, 7, 5], notes: ['English syllable counts are estimates; many haiku do not use 5 / 7 / 5.'] },
  },
  {
    name: 'Limerick',
    structure: '5 lines · AABBA',
    description: 'A compact, often comic form with longer first, second, and fifth lines and shorter third and fourth.',
    example: 'AABBA',
    exampleTitle: '“There was an Old Man with a Beard” by Edward Lear',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45755/there-was-an-old-man-with-a-beard',
    check: { lineCount: 5, stanzaPattern: [5], rhymePatterns: [['A', 'A', 'B', 'B', 'A']] },
  },
  {
    name: 'Lục bát',
    aliases: ['Luc bat'],
    structure: 'alternating 6- and 8-syllable lines',
    description: 'A traditional Vietnamese verse form with linked rhyme and tonal rules.',
    example: '6 · 8 · 6 · 8 …',
    exampleTitle: 'Opening lines of “Truyện Kiều” with form notes',
    exampleUrl: 'https://thelittlewhiteattic.blogspot.com/2020/05/truyen-kieu-verse-form-context-language.html',
    check: { syllablePattern: [6, 8], repeatSyllablePattern: true, stanzaPattern: [2], repeatStanzaPattern: true, notes: ['Vietnamese tone and rhyme rules are not checked by the English pronunciation dictionary.'] },
  },
  {
    name: 'Nonet',
    structure: '9 lines · 9 syllables down to 1',
    description: 'Each successive line loses one syllable; rhyme is optional.',
    example: '9 · 8 · 7 · 6 · 5 · 4 · 3 · 2 · 1',
    exampleTitle: 'Nonet examples at Shadow Poetry',
    exampleUrl: 'http://shadowpoetry.com/resources/wip/nonet.html',
    check: { lineCount: 9, stanzaPattern: [9], syllablePattern: [9, 8, 7, 6, 5, 4, 3, 2, 1] },
  },
  {
    name: 'Ode',
    structure: 'variable · sustained address or meditation',
    description: 'A lyric meditation or address to a person, object, or idea; stanza patterns may be regular or free.',
    example: 'stanza pattern of your choosing',
    exampleTitle: '“Ode to a Nightingale” by John Keats',
    exampleUrl: 'https://www.poetryfoundation.org/poems/44479/ode-to-a-nightingale',
    check: { notes: ['Odes vary in stanza structure, meter, and rhyme; no single scheme is assumed.'] },
  },
  {
    name: 'Ovillejo',
    structure: '10 lines · three short-answer couplets + quatrain',
    description: 'A Spanish form whose short answers are gathered into the final stanza; syllable counts and rhyme follow a fixed pattern.',
    example: 'question / short answer · … · answers gathered',
    exampleTitle: '“Ovillejos” by Miguel de Cervantes, translated by Paul Archer',
    exampleUrl: 'http://www.paularcher.net/translations/miguel_de_cervantes/ovillejos.html',
    check: { lineCount: 10, stanzaPattern: [10], syllablePattern: [8, 3, 8, 3, 8, 3, 8, 8, 8, 8] },
  },
  {
    name: 'Pantoum',
    structure: 'interlocking quatrains',
    description: 'Lines two and four of each stanza return as lines one and three of the next; the ending often loops back.',
    example: 'ABAB · BCBC · CDCD …',
    exampleTitle: '“Pantoum of the Great Depression” by Donald Justice',
    exampleUrl: 'https://www.poetryfoundation.org/poems/58080/pantoum-of-the-great-depression',
    check: {
      stanzaPattern: [4],
      repeatStanzaPattern: true,
      rhymePatterns: [['A', 'B', 'A', 'B']],
      repeatRhymePattern: true,
      repeatedLinesAcrossStanzas: { sourceOffsets: [2, 4], targetOffsets: [1, 3] },
      notes: ['The final stanza’s common return to the opening lines is not checked.'],
    },
  },
  {
    name: 'Rhyme royal',
    structure: '7 lines · ABABBCC',
    description: 'A seven-line stanza, traditionally in iambic pentameter, used in medieval and Renaissance narrative poetry.',
    example: 'ABABBCC',
    exampleTitle: '“They flee from me” by Thomas Wyatt',
    exampleUrl: 'https://rpo.library.utoronto.ca/glossary/poems/they-flee-me-sometime-did-me-seek',
    check: { stanzaPattern: [7], repeatStanzaPattern: true, rhymePatterns: [['A', 'B', 'A', 'B', 'B', 'C', 'C']], repeatRhymePattern: true },
  },
  {
    name: 'Rondeau',
    structure: '15 lines · two rhymes + refrain',
    description: 'Three stanzas share two rhymes, with a shortened refrain returning at the ends of the final stanzas.',
    example: 'AABBA · AABR · AABBAR',
    exampleTitle: '“In Flanders Fields” by John McCrae',
    exampleUrl: 'https://www.poetryfoundation.org/poems/47380/in-flanders-fields',
    check: { lineCount: 15, stanzaPattern: [5, 4, 6], rhymePatterns: [['A', 'A', 'B', 'B', 'A'], ['A', 'A', 'B', '-'], ['A', 'A', 'B', 'B', 'A', '-']] },
  },
  {
    name: 'Roundel',
    structure: '11 lines · two rhymes + refrain',
    description: 'Swinburne’s English form uses repeated opening words as a refrain after the third line and at the close.',
    example: 'ABAR · BAB · ABAR',
    exampleTitle: '“The Roundel” by Algernon Charles Swinburne',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45301/the-roundel',
    check: { lineCount: 11, stanzaPattern: [4, 3, 4], rhymePatterns: [['A', 'B', 'A', 'B'], ['A', 'B', 'A'], ['A', 'B', 'A', 'B']] },
  },
  {
    name: 'Sestina',
    structure: '39 lines · 6 stanzas + envoy',
    description: 'Six end-words rotate through six six-line stanzas before gathering in a three-line envoy.',
    example: 'six repeating end-words',
    exampleTitle: '“Sestina” by Algernon Charles Swinburne',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45304/sestina-56d224c2ea7e6',
    check: { lineCount: 39, stanzaPattern: [6, 6, 6, 6, 6, 6, 3], notes: ['The six end-word rotation is not checked.'] },
  },
  {
    name: 'Sonnet',
    structure: '14 lines · often iambic pentameter',
    description: 'A fourteen-line poem with a turn in thought; Shakespearean and Petrarchan patterns are common.',
    example: 'ABAB CDCD EFEF GG',
    exampleTitle: '“Sonnet 18” by William Shakespeare',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45087/sonnet-18-shall-i-compare-thee-to-a-summers-day',
    check: { lineCount: 14, stanzaPattern: [14], notes: ['Sonnet rhyme schemes vary by tradition; meter and the turn in thought are not graded.'] },
  },
  {
    name: 'Tanka',
    structure: '5 lines · often 5 / 7 / 5 / 7 / 7',
    description: 'A short Japanese lyric traditionally shaped in five sound units; English syllable counts are approximate.',
    example: 'short · long · short · long · long',
    exampleTitle: '“Four Tanka” translated by Yuki Tanaka',
    exampleUrl: 'https://www.poetryfoundation.org/poetrymagazine/poems/1682788/four-tanka',
    check: { lineCount: 5, stanzaPattern: [5], syllablePattern: [5, 7, 5, 7, 7], notes: ['English syllable counts are estimates; translations and modern tanka vary.'] },
  },
  {
    name: 'Tercet',
    structure: '3 lines · rhymed or unrhymed',
    description: 'A three-line stanza or poem; tercets may stand alone or connect through a larger rhyme scheme.',
    example: 'AAA · ABA · or unrhymed',
    exampleTitle: '“The Convergence of the Twain” by Thomas Hardy',
    exampleUrl: 'https://www.poetryfoundation.org/poems/47266/the-convergence-of-the-twain',
    check: { stanzaPattern: [3], repeatStanzaPattern: true },
  },
  {
    name: 'Terza rima',
    structure: 'three-line stanzas · interlocking rhyme',
    description: 'Tercets link their middle rhyme to the next stanza, often followed by a closing line or couplet.',
    example: 'ABA · BCB · CDC …',
    exampleTitle: '“Ode to the West Wind” by Percy Bysshe Shelley',
    exampleUrl: 'https://www.poetryfoundation.org/poems/45134/ode-to-the-west-wind',
    check: { stanzaPattern: [3], repeatStanzaPattern: true, rhymePatterns: [['A', 'B', 'A']], repeatRhymePattern: true, notes: ['Cross-stanza rhyme links are not checked.'] },
  },
  {
    name: 'Terzanelle',
    structure: '19 lines · 5 tercets + quatrain',
    description: 'A hybrid of terza rima and villanelle, combining interlocking tercets with recurring refrains.',
    example: 'ABA · bCB · cDC … · final quatrain',
    exampleTitle: 'Terzanelle examples at Shadow Poetry',
    exampleUrl: 'http://www.shadowpoetry.com/resources/wip/terzanelle.html',
    check: {
      lineCount: 19,
      stanzaPattern: [3, 3, 3, 3, 3, 4],
      repeatedLines: [[1, 6], [1, 12], [1, 18], [3, 9], [3, 15], [3, 19], [2, 6], [5, 9], [8, 12], [11, 15], [14, 18]] as [number, number][],
      notes: ['Interlocking rhyme links between stanzas are not checked.'],
    },
  },
  {
    name: 'Triolet',
    structure: '8 lines · two repeated lines',
    description: 'An eight-line French form built around two lines that recur in a fixed pattern.',
    example: 'ABaAabAB',
    exampleTitle: '“Saint’s Day Triolet: Saint Anthony” by Deborah Paredez',
    exampleUrl: 'https://www.poetryfoundation.org/poetrymagazine/poems/56996/saints-day-triolet-saint-anthony',
    check: { lineCount: 8, stanzaPattern: [8], rhymePatterns: [['A', 'B', 'A', 'A', 'A', 'B', 'A', 'B']], repeatedLines: [[1, 4], [1, 7], [2, 8]] as [number, number][] },
  },
  {
    name: 'Villanelle',
    structure: '19 lines · 5 tercets + quatrain',
    description: 'Two refrain lines alternate through five tercets before meeting in the closing quatrain.',
    example: 'ABA · ABA · ABA · ABA · ABA · ABAA',
    exampleTitle: '“One Art” by Elizabeth Bishop',
    exampleUrl: 'https://www.poetryfoundation.org/poems/47536/one-art',
    check: {
      lineCount: 19,
      stanzaPattern: [3, 3, 3, 3, 3, 4],
      rhymePatterns: [['A', 'B', 'A'], ['A', 'B', 'A'], ['A', 'B', 'A'], ['A', 'B', 'A'], ['A', 'B', 'A'], ['A', 'B', 'A', 'A']],
      repeatedLines: [[1, 6], [1, 12], [1, 18], [3, 9], [3, 15], [3, 19]] as [number, number][],
      notes: ['The checker compares rhyme patterns within each stanza, not the same two rhyme sounds across all stanzas.'],
    },
  },
].sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));

export function searchPoetryForms(query: string): FormEntry[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return forms;
  return forms.filter((form) =>
    [form.name, ...(form.aliases ?? []), form.structure, form.description, form.exampleTitle]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}

export function findPoetryForm(name: string): FormEntry | undefined {
  const normalizedName = name.trim().toLocaleLowerCase();
  return forms.find((form) =>
    [form.name, ...(form.aliases ?? [])].some((candidate) => candidate.toLocaleLowerCase() === normalizedName),
  );
}
