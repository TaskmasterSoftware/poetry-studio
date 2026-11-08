# Third-party notices

Poetry Studio's original application code is licensed under
AGPL-3.0-only. Third-party works retain their own licences and copyright
notices; the application's licence does not replace them.

The software licence does not apply to poems, manuscripts, submission
records, or other documents written or imported by users.

## Calliope-TS English meter fitting

The browser-local meter-fitting prototype in `src/lib/browser-meter.ts` adapts
parts of Calliope-TS 0.1.8's English gradient-foot scoring and dynamic meter-fit
approach. It is modified for browser-only use and does not include Calliope-TS's
Node runtime, dependency parser, Russian engine, or optional Scandroid engine.

Author: Aleksey Calvin Tsukanov.

Source: <https://github.com/AlekseyCalvin/Calliope-TS>

The adapted work is distributed under the Apache License, Version 2.0. A copy
is included in `CALLIOPE-APACHE-2.0.txt`.

## CMU Pronouncing Dictionary

The bundled pronunciation dictionary in `public/cmudict.dict` is copyright
1993–2015 Carnegie Mellon University and is distributed under its BSD-style
licence. Its full copyright, redistribution conditions, and disclaimer are
preserved in `public/cmudict-LICENSE.txt`.

## Other dependencies

React, Radix UI, Lucide, Vite, fflate, and other dependencies retain their
respective upstream licences. Dependency versions are recorded in the
workspace manifests and `pnpm-lock.yaml`; their licence files are supplied
with the installed packages. Preserve those files when redistributing them.
