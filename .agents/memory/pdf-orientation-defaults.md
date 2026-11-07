---
name: PDF orientation defaults
description: Compatibility rule for orientation added to PDF export options.
---

When adding orientation to the existing PDF export options, keep portrait as the default when orientation is omitted.

**Why:** Existing callers may pass only page size and margins; their exports should not change unexpectedly.

**How to apply:** Keep new orientation fields optional for old callers and make portrait the fallback in the renderer and UI.
