---
name: autumn-job-tracker
description: Create, maintain, debug, and package the privacy-first 秋招求职工作台 Microsoft Edge extension for tracking applications, login health, deadlines, and recruitment email updates. Use when a user asks to build or modify this specific job-application dashboard workflow; do not use for generic spreadsheets or unrelated job-search advice.
---

# Autumn Job Tracker

Build on the bundled extension template in `assets/autumn-job-tracker/`. Copy it into the user's chosen workspace before editing; do not modify the installed skill in place unless the user is explicitly updating the skill itself.

## Workflow

1. Translate the request into observable behavior before changing code. Preserve manually entered application identity fields unless the user explicitly edits them.
2. Read [references/product-rules.md](references/product-rules.md) before changing capture, refresh, login detection, email search, deduplication, archiving, notifications, or storage.
3. Inspect the current extension and preserve user changes. Make the smallest coherent change across the content script, background worker, popup, dashboard, and manifest.
4. Keep browser credentials and personal application data on the device. Never add cookie, password, OTP, or session-token export. Do not commit runtime storage or personal records.
5. Test both the requested behavior and the relevant invariants in the reference. For page capture changes, test passive page opening separately from an explicit extension click.
6. Increment the manifest version after a verified behavior change. Run `scripts/verify-extension.ps1`, then use `scripts/package-extension.ps1` when a ZIP is requested.

## Handoff

Report the changed behavior, verification performed, version, and the absolute path to the unpacked extension or ZIP. Remind the user to reload it from `edge://extensions` when appropriate.
