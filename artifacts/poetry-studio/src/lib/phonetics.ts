export type RhymeMatch = {
  word: string;
  pronunciation: string;
  syllables: number;
};

type Pronunciation = {
  word: string;
  phones: string[];
  rhymeKey: string;
  onset: string;
  coda: string;
  syllables: number;
  stress: string;
};

let dictionaryPromise: Promise<Pronunciation[]> | undefined;
let lexiconPromise: Promise<Map<string, Pronunciation>> | undefined;

const isVowel = (phone: string) => /[012]$/.test(phone);
const cleanPhone = (phone: string) => phone.replace(/[012]$/, "");

function parseDictionary(text: string): Pronunciation[] {
  const entries: Pronunciation[] = [];

  for (const line of text.split(/\r?\n/)) {
    const firstSpace = line.indexOf(" ");
    if (firstSpace < 1 || line.startsWith(";;;")) continue;

    const word = line.slice(0, firstSpace).replace(/\(\d+\)$/, "").toLowerCase();
    const phones = line.slice(firstSpace + 1).trim().split(/\s+/);
    let lastStressedVowel = -1;
    let lastVowel = -1;
    const stresses: string[] = [];

    phones.forEach((phone, index) => {
      if (!isVowel(phone)) return;
      lastVowel = index;
      const stress = phone.at(-1) ?? "0";
      stresses.push(stress);
      if (stress === "1" || stress === "2") lastStressedVowel = index;
    });

    if (lastVowel < 0) continue;
    if (lastStressedVowel < 0) lastStressedVowel = lastVowel;

    const rhymePhones = phones.slice(lastStressedVowel).map(cleanPhone);
    const onset = phones.slice(0, lastStressedVowel).map(cleanPhone).join(" ");
    const coda = phones.slice(lastVowel + 1).map(cleanPhone).join(" ");

    entries.push({
      word,
      phones,
      rhymeKey: rhymePhones.join(" "),
      onset,
      coda,
      syllables: stresses.length,
      stress: stresses.map((stress) => (stress === "1" || stress === "2" ? "／" : "×")).join(""),
    });
  }

  return entries;
}

async function getDictionary(): Promise<Pronunciation[]> {
  if (!dictionaryPromise) {
    dictionaryPromise = fetch(`${import.meta.env.BASE_URL}cmudict.dict`)
      .then((response) => {
        if (!response.ok) throw new Error("The built-in pronunciation dictionary could not be loaded.");
        return response.text();
      })
      .then(parseDictionary);
  }
  return dictionaryPromise;
}

function choosePronunciations(entries: Pronunciation[]): Pronunciation[] {
  const chosen = new Map<string, Pronunciation>();
  for (const entry of entries) {
    const previous = chosen.get(entry.word);
    if (!previous || entry.stress.includes("／")) chosen.set(entry.word, entry);
  }
  return [...chosen.values()];
}

async function getLexicon(): Promise<Map<string, Pronunciation>> {
  if (!lexiconPromise) {
    lexiconPromise = getDictionary().then((entries) =>
      new Map(choosePronunciations(entries).map((entry) => [entry.word, entry])),
    );
  }
  return lexiconPromise;
}

export async function findRhymes(
  query: string,
  mode: "perfect" | "near" = "perfect",
  limit = 36,
): Promise<RhymeMatch[]> {
  const normalized = query.toLowerCase().replace(/[^a-z']/g, "");
  if (!normalized) return [];

  const lexicon = await getLexicon();
  const source = lexicon.get(normalized);
  if (!source) return [];

  const matches = [...lexicon.values()]
    .filter((entry) => {
      if (entry.word === normalized) return false;
      if (mode === "perfect") return entry.rhymeKey === source.rhymeKey;
      const sameCoda = source.coda.length > 0 && entry.coda === source.coda;
      const sameStressedVowel = source.rhymeKey.split(" ")[0] === entry.rhymeKey.split(" ")[0];
      const sameRhyme = source.rhymeKey === entry.rhymeKey;
      return !sameRhyme && (sameCoda || (sameStressedVowel && entry.coda !== source.coda));
    })
    .map((entry) => ({
      entry,
      score:
        (entry.coda === source.coda ? 4 : 0) +
        (entry.rhymeKey.split(" ")[0] === source.rhymeKey.split(" ")[0] ? 2 : 0) +
        (entry.word.length < 14 ? 1 : 0),
    }))
    .sort((a, b) => b.score - a.score || a.entry.word.localeCompare(b.entry.word))
    .slice(0, limit)
    .map(({ entry }) => ({
      word: entry.word,
      pronunciation: entry.stress,
      syllables: entry.syllables,
    }));

  return matches;
}

export async function scanLine(line: string): Promise<string> {
  const byWord = await getLexicon();
  const words = line.toLowerCase().match(/[a-z']+/g) ?? [];
  return words
    .map((word) => byWord.get(word)?.stress ?? (word.match(/[aeiouy]+/g)?.map(() => "×").join("") || "×"))
    .join(" ");
}

export async function findSpellingErrors(text: string, personalWords: string[]): Promise<string[]> {
  const lexicon = await getLexicon();
  const personal = new Set(personalWords.map((word) => word.toLowerCase().replace(/’/g, "'")));
  const errors = new Set<string>();
  for (const match of text.matchAll(/[A-Za-z]+(?:['’][A-Za-z]+)?/g)) {
    const word = match[0];
    const normalized = word.toLowerCase().replace(/’/g, "'");
    if (word.length > 1 && !lexicon.has(normalized) && !personal.has(normalized)) errors.add(word);
  }
  return [...errors];
}

