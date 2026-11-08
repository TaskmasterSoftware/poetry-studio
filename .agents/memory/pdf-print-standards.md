---
name: PDF print standards
description: Exact PDF/X revision must be verified; Kura's generic x1a target is not the requested 2001 revision.
---

Never label an ordinary PDF or a different PDF/X revision as PDF/X-1a:2001.

**Why:** The user specifically requested PDF/X-1a:2001 for IngramSpark.
Evaluating Kura 1.3.0 showed that its `x1a` target emits PDF/X-1a:2003
(PDF 1.4), and its own conformance check accepts that 2003 output. The public
documentation's generic “x1a” target name does not establish the year.

**How to apply:** Before integrating a print converter, inspect the actual
output revision and validate the requested standard. Do not substitute 2003
for 2001 or assume printer acceptance. Kura was evaluated, not integrated.
