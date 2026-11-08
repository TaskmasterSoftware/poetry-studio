---
name: Markdown indent representation
description: Preserve paragraph indentation in plain Markdown without triggering code blocks.
---

Represent paragraph indents in Markdown with non-breaking spaces rather than ordinary leading spaces.

**Why:** Markdown interprets four or more ordinary leading spaces as code blocks, while non-breaking spaces remain visible layout whitespace.

**How to apply:** When exporting paragraph indents to Markdown, keep unindented text unchanged and emit non-breaking spaces only for paragraphs with explicit supported indent metadata.
