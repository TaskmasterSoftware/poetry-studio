# Contributing to Poetry Studio

## Before making a change

- Keep poem text and analysis on the user's device unless a new data flow has
  been explicitly approved and explained.
- Preserve supported formatting across document import and export.
- Treat scansion and form checks as advisory, not authoritative corrections.
- Do not describe a PDF as a print standard unless its output actually
  conforms to that standard.

## Development checks

Use the setup commands in [README.md](README.md). For application changes, run:

```sh
pnpm --filter @workspace/poetry-studio run typecheck
pnpm --filter @workspace/poetry-studio test
```

Add focused tests for changed behaviour. Include relevant browser tests when
changing an interaction that cannot be checked through unit tests alone.

## Contributions and licences

By submitting original contributions for inclusion in this project, you agree
to make those contributions available under `AGPL-3.0-only`. You retain your
copyright. Do not submit code or assets unless you have the right to contribute
them under compatible terms.

Preserve third-party copyright and licence notices. Record newly bundled
third-party code, datasets, fonts, and profiles in
`artifacts/poetry-studio/THIRD_PARTY_NOTICES.md`.

Do not include credentials, real manuscripts, personal submission histories,
or other private information in issues, screenshots, fixtures, or commits.
Use short synthetic poems for examples and tests.
