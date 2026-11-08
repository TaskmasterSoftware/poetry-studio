---
name: Scansion processing boundary
description: Preserve on-device poem processing and keep the scansion engine English-only unless scope changes.
---

Keep scansion analysis in the browser. Do not send poem text to the app API or a third-party service without the user's explicit approval. The Calliope-TS evaluation scope is English only; the Russian engine is not needed.

The evaluated Calliope-TS package release is Node-oriented and does not bundle cleanly for the browser. Before adopting an upstream release directly, verify that it has a browser entry and no filesystem-only dependencies; otherwise keep any browser adaptation clearly labeled as a prototype, not the full engine.

**Why:** The user asked to prototype a browser-compatible approach, and the app promises that writing stays on the device. A browser adaptation avoids uploading manuscript text but does not include the full syntax-aware engine.

**How to apply:** Prefer a client-safe English engine, retain the current editable scansion marks, and ask before changing the local-only processing boundary.
