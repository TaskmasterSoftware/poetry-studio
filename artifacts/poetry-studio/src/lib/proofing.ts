export interface GrammarSuggestion {
  id: string;
  match: string;
  fix: string;
  reason: string;
  start: number;
  end: number;
}

export function findGrammarSuggestions(text: string): GrammarSuggestion[] {
  const suggestions: GrammarSuggestion[] = [];
  const add = (match: RegExpMatchArray, fix: string, reason: string) => {
    if (match.index === undefined || !match[0]) return;
    const start = match.index;
    const value = match[0];
    suggestions.push({
      id: `${start}:${value.length}:${value.toLowerCase()}`,
      match: value,
      fix,
      reason,
      start,
      end: start + value.length,
    });
  };

  for (const match of text.matchAll(/\b(the|a|an)\s+\1\b/gi)) {
    add(match, match[0].split(/\s+/)[0], 'A repeated article may be accidental.');
  }
  for (const match of text.matchAll(/\byour welcome\b/gi)) {
    add(match, match[0].replace(/^your/i, 'You’re'), '“You’re welcome” uses the contraction for “you are.”');
  }
  for (const match of text.matchAll(/\b(it|that|there) is\b/gi)) {
    const contraction = match[0].replace(/\s+is$/i, '’s');
    add(match, contraction, `Consider the contraction ${contraction}.`);
  }
  for (const match of text.matchAll(/\b(could|should|would|might|must) of\b/gi)) {
    add(match, match[0].replace(/\s+of$/i, ' have'), 'After a modal verb, use “have” rather than “of.”');
  }
  for (const match of text.matchAll(/\b(\w+)\s+\1\b/gi)) {
    add(match, match[1], 'A repeated word may be accidental.');
  }

  const unique = new Map<string, GrammarSuggestion>();
  for (const suggestion of suggestions) {
    if (!unique.has(suggestion.id)) unique.set(suggestion.id, suggestion);
  }
  return [...unique.values()].sort((a, b) => a.start - b.start || a.end - b.end);
}
