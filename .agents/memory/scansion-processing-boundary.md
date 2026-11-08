---
name: Scansion processing boundary
description: Preserve on-device poem processing and keep the scansion engine English-only unless scope changes.
---

Keep scansion analysis in the browser. Do not send poem text to the app API or a third-party service without the user's explicit approval. The Calliope-TS evaluation scope is English only; the Russian engine is not needed.

**Why:** The user asked to prototype a browser-compatible approach, and the app promises that writing stays on the device.

**How to apply:** Prefer a client-safe English engine, retain the current editable scansion marks, and ask before changing the local-only processing boundary.
