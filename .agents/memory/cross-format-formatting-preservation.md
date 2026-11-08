---
name: Cross-format formatting preservation
description: Preserve supported formatting when importing and exporting manuscript files across formats.
---

Import formatting from supported file formats such as RTF, DOCX, and ODT. Preserve that formatting when exporting back to the same format or converting to another format, wherever the destination format supports it.

**Why:** The user expects formatting to survive document import and export, rather than being lost during conversion.

**How to apply:** When changing file import/export behavior, preserve supported formatting consistently across round trips and cross-format conversions. Do not silently discard formatting that the destination format can represent.
