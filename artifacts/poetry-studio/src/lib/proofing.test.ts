import assert from "node:assert/strict";
import { test } from "node:test";
import { findGrammarSuggestions } from "./proofing";

test("proofing suggestions include exact text offsets for repeated occurrences", () => {
  const text = "The the waves hush. The the night listens.";
  const suggestions = findGrammarSuggestions(text);

  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions.map((item) => item.match), ["The the", "The the"]);
  assert.deepEqual(suggestions.map((item) => item.start), [0, 20]);
  assert.deepEqual(suggestions.map((item) => text.slice(item.start, item.end)), suggestions.map((item) => item.match));
  assert.notEqual(suggestions[0].id, suggestions[1].id);
});

test("overlapping grammar rules produce one actionable suggestion per text range", () => {
  const suggestions = findGrammarSuggestions("A a thought, a a pause.");

  assert.equal(suggestions.length, 2);
  assert.deepEqual(suggestions.map((item) => item.reason), [
    "A repeated article may be accidental.",
    "A repeated article may be accidental.",
  ]);
});
