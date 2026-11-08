import assert from "node:assert/strict";
import { test } from "node:test";
import { forms, searchPoetryForms } from "./poetry-forms";

test("sorts every form alphabetically and includes an example link", () => {
  const names = forms.map((form) => form.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })));

  for (const form of forms) {
    assert.ok(form.exampleTitle.trim(), `${form.name} should name its example`);
    const exampleUrl = new URL(form.exampleUrl);
    assert.ok(exampleUrl.protocol === "https:" || exampleUrl.protocol === "http:", `${form.name} should link to an example`);
  }
});

test("includes the requested forms and recognizes the common cinquin spelling", () => {
  const names = new Set(forms.map((form) => form.name));
  for (const name of [
    "Ghazal", "Cinquain", "Balliol rhyme", "Clerihew", "Chant royal", "Copla",
    "Golden shovel", "Limerick", "Lục bát", "Pantoum", "Rhyme royal", "Roundel",
    "Tercet", "Terzanelle", "Villanelle", "Abecedarian", "Haibun", "Ovillejo",
    "Cascade", "Nonet",
  ]) {
    assert.ok(names.has(name), `Expected the library to include ${name}`);
  }
  assert.equal(searchPoetryForms("cinquin")[0]?.name, "Cinquain");
});
