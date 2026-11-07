---
name: Per-user cloud storage
description: Poetry Studio's storage providers must be authorized separately by each app user.
---

Cloud storage access must be per application user. Never route every user's file operations through a Replit workspace owner's shared provider connection. The user selected Google Drive, OneDrive, Dropbox, Box, and SharePoint; Apple iCloud should use a device file-picker fallback if supported.

**Why:** The user explicitly chose per-user authorization after asking whether a shared Google Drive connection would be exposed to all app users.

**How to apply:** Associate each provider authorization and every file operation with the signed-in app user. Do not use a shared workspace integration for end-user storage.
