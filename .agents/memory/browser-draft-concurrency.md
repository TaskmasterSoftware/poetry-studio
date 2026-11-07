---
name: Browser draft concurrency
description: Cross-tab persistence decisions for browser-based poem drafts.
---

Manuscript content is shared between tabs, but each tab's active poem selection is local to that tab. Reloading one tab should not switch it to the poem most recently selected in another tab.

**Why:** A shared active selection can make a tab appear to have lost its current work after reload, even when the manuscript itself remains stored.

**How to apply:** When changing browser draft persistence, merge content changes by draft identity and keep working selection state tab-local. If simultaneous edits target the same poem, preserve both versions and make the conflict copy visible.
