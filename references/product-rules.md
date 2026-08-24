# Product rules

Read the sections relevant to the requested change. These rules describe the tested behavior of the bundled template.

## Application identity and capture

- Store enterprise name separately from page-derived fields. It is manual-only and must never be populated or overwritten by the page title, website name, email text, refresh results, or migration logic.
- Once saved, enterprise name, job title, location, and application date remain unchanged during immediate and scheduled refreshes. Only an explicit user edit may change them.
- The query URL comes from the browser tab's current address, including hash routes; do not substitute a link found inside the page.
- Opening, reloading, focusing, or mutating a recruitment or mailbox page must remain silent. Page capture happens only after an explicit extension action. Workbench-initiated immediate and scheduled checks are separate configured workflows.
- When information is incomplete, keep the URL and ask the user to fill the missing required fields.
- Deduplicate application cards by a stable application/job identifier when available, otherwise by normalized source URL plus job identity. A refresh must not create duplicate records.

## Status and login health

- Determine status from the current application card or its local detail region. A stage label such as `Offer` elsewhere in a progress diagram is not evidence that the candidate received an offer.
- Positive readable-page evidence includes `应聘记录`, `投递记录`, `应聘进展`, fields such as `岗位名称`, `职位名称`, `应聘职位`, a submitted card containing a date, or the saved job title appearing on the page.
- A standalone `登录` prompt means the page was not conclusively checked; report `未检查`, not a confirmed login failure.
- Treat CAPTCHA, verification, explicit session expiry, or a confirmed login form without positive application evidence as requiring attention.
- Archive a confirmed rejected/unsuccessful application and notify only once for that terminal state.

## Recruitment email workflow

- Use the user's already logged-in webmail session; never extract credentials, cookies, OTPs, or tokens.
- Search only the inbox. For each enterprise and mailbox, enter the manual enterprise name once in the normal full-text mail search and submit it once. Do not use AI search, contact search, spam, or advertising folders unless the user explicitly changes the product rule.
- Search results qualify when the visible sender, subject, or snippet contains the complete normalized enterprise name.
- Open each qualifying result's actual message detail before collecting the subject, sender, body, date, detail URL, stage, and deadline.
- Deduplicate with the strongest stable mail identifier available; otherwise use a normalized combination of mailbox, detail URL, sender, subject, and date. Skip mail already recorded, pending, dismissed, or deleted.
- A uniquely matched message may enter the history. Ambiguous mail goes to the pending-confirmation area with functional confirm and cancel actions. Confirmed mail appears in the email history.
- Single and multi-select deletion must remove selected records and remember their ignored signatures so later checks do not re-add them.

## Storage, UI, and notifications

- Store data in Edge extension local storage unless the user explicitly requests and authorizes a cloud design.
- Initial setup collects name, phone number, and one to five email addresses, but these values must never be committed to source control or sent to analytics.
- Editing and first-run dialogs close only through their explicit save, cancel, close, or delete controls; typing or interacting inside them must not dismiss them.
- Notify on a new stage, deadline, login issue, or terminal result, and keep an unread indicator until acknowledged. Avoid repeat notifications for the same state.
- Keep the dashboard responsive on phone-sized and desktop layouts and retain accessible text alongside decorative icons.

## Minimum regression checks

- Merely opening a recruitment page sends no capture/save message; explicitly clicking the extension still extracts the page.
- Merely opening a mailbox sends no discovery or email-save message.
- Immediate refresh does not overwrite manual identity fields or create a duplicate application.
- A page that displays an inactive `Offer` stage but says the résumé is under review remains in screening.
- Login-positive keywords or the saved job title mark a readable application page normal.
- Rejected applications archive and notify once.
- Mail search submits the enterprise once, opens message details, records a new message once, and supports batch deletion.
