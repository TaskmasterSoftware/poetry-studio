---
name: HTML parsing in tests
description: Notes about the Node DOM shim used for browser HTML parsing tests.
---

When tests use `@xmldom/xmldom` as `DOMParser`, its `text/html` handling behaves like XML parsing rather than a browser HTML parser: element tag names remain lowercase, `document.body` may be missing, and elements may not expose `.children`. Normalize tag-name casing and use standard DOM child-node traversal when code must be exercised under both environments.

**Why:** Export tests initially missed paragraph and tag styling because the shim did not apply browser HTML parsing conventions.

**How to apply:** For HTML parsing helpers tested in Node, account for lowercase tag names and avoid relying on browser-only DOM conveniences unless the test supplies a browser-compatible DOM.
