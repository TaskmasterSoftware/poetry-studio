import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyPoemMetadata, matchesPoemMetadataSearch, normalizePoemMetadata, type PoemMetadata } from "./poem-files";

test("normalizes poem metadata while keeping each submission attempt", () => {
  const metadata = normalizePoemMetadata({
    dateWritten: "2025-03-10",
    form: "Ghazal",
    tags: ["  winter  ", "Winter", "memory"],
    notes: "A note to self",
    submissions: [
      { id: "first", publisher: "North Review", websiteUrl: "https://north.example", submittedAt: "2025-04-01", status: "rejected", responseDate: "2025-05-02", notes: "Try again later." },
      { id: "second", publisher: "North Review", websiteUrl: "https://north.example", submittedAt: "2025-06-01", status: "pending", responseDate: "", notes: "" },
    ],
  });

  assert.equal(metadata.form, "Ghazal");
  assert.deepEqual(metadata.tags, ["Winter", "memory"]);
  assert.equal(metadata.submissions.length, 2);
  assert.equal(metadata.submissions[0].status, "rejected");
  assert.equal(metadata.submissions[1].status, "pending");
});

test("metadata search matches title, notes, tags, publisher, dates, and status", () => {
  const poem: { title: string; metadata: PoemMetadata } = {
    title: "The Harbor",
    metadata: {
      ...emptyPoemMetadata(),
      dateWritten: "2025-03-10",
      form: "Ghazal",
      tags: ["winter memory"],
      notes: "A blue evening",
      submissions: [{
        id: "submission-1",
        publisher: "North Review",
        websiteUrl: "https://north.example",
        submittedAt: "2025-04-01",
        status: "pending",
        responseDate: "",
        notes: "Waiting for reply",
      }],
    },
  };

  assert.equal(matchesPoemMetadataSearch(poem, "harbor"), true);
  assert.equal(matchesPoemMetadataSearch(poem, "winter ghazal"), true);
  assert.equal(matchesPoemMetadataSearch(poem, "north 2025-04-01"), true);
  assert.equal(matchesPoemMetadataSearch(poem, "awaiting reply"), true);
  assert.equal(matchesPoemMetadataSearch(poem, "published"), false);
});

test("metadata normalizer safely defaults malformed values", () => {
  const metadata = normalizePoemMetadata({
    dateWritten: "not-a-date",
    tags: "not-an-array",
    submissions: [{ status: "unknown", publisher: 12 }],
  });

  assert.equal(metadata.dateWritten, "");
  assert.deepEqual(metadata.tags, []);
  assert.equal(metadata.submissions[0].status, "pending");
  assert.equal(metadata.submissions[0].publisher, "");
});
