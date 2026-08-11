---
status: planned
depends: [auth-identity]
specs:
  - specs/commands/events.md
  - specs/commands/busy.md
  - specs/api/scheduled-events.md
issues: []
---

# Plan: Events & busy — reads

## Scope

**In:** `events list` (all filters, upcoming-default, past-window sort flip, limit/drain semantics), `events view`, `events invitees` (list + single-match detail with Q&A), and `busy` (7-day cap, calendly/external rows, connected-calendar caveat line). **Out:** cancel and no-show (→ `events-write`), everything under `types`.

## Implements

- `specs/commands/events.md` — the three read subcommands (cancel/no-show sections excluded).
- `specs/commands/busy.md` — fully.
- `specs/api/scheduled-events.md` — read endpoints.

## Validation

- [ ] `events` with defaults: header shows resolved scope/window/status; rows sorted ascending; `--since 7d` flips to descending.
- [ ] `--org` without admin role → role-gate `FORBIDDEN` suggesting dropping `--org` (live check against test account).
- [ ] `--limit` stop reports "more available" with hints; drained list reports `complete: true`; zero-result output is definitive with scope+window.
- [ ] `events invitees <e> --email <x>` with one match renders Q&A + cancel/reschedule URLs; with several renders the list.
- [ ] `busy --until 10d` → `VALIDATION_ERROR` naming the 7-day cap; happy path shows both row types against the live account.
- [ ] All identifier args accept both UUID and URI (unit + live spot check).

## Risks / unknowns

- External busy rows require a connected calendar with conflict-check on in the test account; if unavailable, validate the caveat-line path instead and note it.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
