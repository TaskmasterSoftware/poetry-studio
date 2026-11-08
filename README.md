# Poetry Studio

A browser-based, desktop-style writing workspace for poets.

Public source: <https://github.com/TaskmasterSoftware/poetry-studio>.

Poetry Studio includes rich-text editing, poem and book organisation, document
import and export, pronunciation-based rhyme search, proofreading, scansion,
poetic-form references, version comparisons, and searchable submission metadata.
Books can include editable front and back matter, with recto/verso placement in
PDF exports.

## Privacy and documents

The writing workspace stores drafts and settings locally in the browser.
Export backups before clearing browser data. Publishing this application’s
source code does **not** publish anyone’s locally stored poems or manuscripts.

The software licence does not apply to user-authored or imported documents.
Authors retain whatever rights they have in their own work.

## Development

Use Node.js 24 and pnpm 10. Install dependencies at the workspace root:

```sh
pnpm install --frozen-lockfile
```

To run the writing application outside Replit:

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/poetry-studio run dev
```

On Replit, start the existing `artifacts/poetry-studio: web` workflow instead.
Its managed configuration supplies the port and base path.

### Checks

```sh
pnpm --filter @workspace/poetry-studio run typecheck
pnpm --filter @workspace/poetry-studio test
```

Browser tests require Chromium or a Playwright-supported browser installation:

```sh
pnpm --filter @workspace/poetry-studio run test:e2e
```

### Production build

```sh
PORT=5173 BASE_PATH=/ pnpm --filter @workspace/poetry-studio run build
```

The static site is written to `artifacts/poetry-studio/dist/public`.
Set `BASE_PATH` to the intended mount path when hosting below a URL prefix.

## Repository structure

- `artifacts/poetry-studio/` — the writing application and its tests.
- `artifacts/api-server/` — the workspace's supporting API scaffold.
- `artifacts/mockup-sandbox/` — component-preview tooling.
- `lib/` — shared workspace libraries and API contracts.
- `scripts/` — workspace scripts.

The local writing features do not require cloud-storage credentials.
Never commit secrets, `.env` files, personal manuscripts, or private submission
records to a public repository.

## PDF output

The current exporter produces ordinary PDF 1.4. It does **not** yet claim
PDF/X-1a:2001 compliance, CMYK conversion, or embedded fonts.

During evaluation, Kura 1.3.0's `x1a` converter produced
**PDF/X-1a:2003**, not PDF/X-1a:2001. It has not been integrated into the
application. Changing a PDF header or conformance label is not a substitute
for conversion and validation against the requested standard.

## Licence

Original Poetry Studio application code is licensed under the
**GNU Affero General Public License, version 3 only**
(`AGPL-3.0-only`). See [LICENSE](LICENSE).

The AGPL permits use, modification, redistribution, and commercial use under
its conditions. In particular, operators of modified versions used over a
network must offer their users access to the corresponding source. See the
licence's full text for the precise obligations.

Third-party code and data retain their original licences. See
[third-party notices](artifacts/poetry-studio/THIRD_PARTY_NOTICES.md), including
the Apache-2.0 notice for adapted Calliope-TS code and the CMU dictionary licence.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidance.
