import assert from 'node:assert/strict';
import test from 'node:test';
import { diffWords } from './version-diff';

const changedWords = (segments: ReturnType<typeof diffWords>['left']) =>
  segments.filter((segment) => segment.isWord && segment.changed).map((segment) => segment.text);

test('highlights only the replaced words and leaves punctuation readable', () => {
  const diff = diffWords('The quiet, blue harbor.', 'The quiet, green harbor!');

  assert.deepEqual(changedWords(diff.left), ['blue']);
  assert.deepEqual(changedWords(diff.right), ['green']);
  assert.equal(diff.left.map((segment) => segment.text).join(''), 'The quiet, blue harbor.');
  assert.equal(diff.right.map((segment) => segment.text).join(''), 'The quiet, green harbor!');
});

test('marks inserted and deleted words without marking shared words', () => {
  const insertion = diffWords('I walk home.', 'I walk slowly home.');
  const deletion = diffWords('I walk slowly home.', 'I walk home.');

  assert.deepEqual(changedWords(insertion.left), []);
  assert.deepEqual(changedWords(insertion.right), ['slowly']);
  assert.deepEqual(changedWords(deletion.left), ['slowly']);
  assert.deepEqual(changedWords(deletion.right), []);
});

test('preserves Unicode words, contractions, and unchanged repeated words', () => {
  const diff = diffWords('L’été sings, sings softly.', 'L’été sings, sings brightly.');

  assert.deepEqual(changedWords(diff.left), ['softly']);
  assert.deepEqual(changedWords(diff.right), ['brightly']);
});

test('treats capitalization changes as word changes', () => {
  const diff = diffWords('the moon', 'The moon');

  assert.deepEqual(changedWords(diff.left), ['the']);
  assert.deepEqual(changedWords(diff.right), ['The']);
});
