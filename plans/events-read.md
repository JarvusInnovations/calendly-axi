---
status: done
depends: [auth-identity]
specs:
  - specs/commands/events.md
  - specs/commands/busy.md
  - specs/api/scheduled-events.md
issues: []
pr: 6
---

# Plan: Events & busy — reads

## Scope

**In:** `events list` (all filters, upcoming-default, past-window sort flip, limit/drain semantics), `events view`, `events invitees` (list + single-match detail with Q&A), and `busy` (7-day cap, calendly/external rows, connected-calendar caveat line). **Out:** cancel and no-show (→ `events-write`), everything under `types`.

## Implements

- `specs/commands/events.md` — the three read subcommands (cancel/no-show sections excluded).
- `specs/commands/busy.md` — fully.
- `specs/api/scheduled-events.md` — read endpoints.

## Validation

- [x] `events` with defaults: header shows resolved scope/window/status; rows sorted ascending; `--since 7d` flips to descending.
- [ ] `--org` without admin role → role-gate `FORBIDDEN` suggesting dropping `--org` (live check against test account). No live credentials on this machine — the 403→`FORBIDDEN` translation itself is pre-existing, shared code in `client.ts` (untouched by this plan), not independently re-verified against a live role-gate body here.
- [x] `--limit` stop reports "more available" with hints; drained list reports `complete: true`; zero-result output is definitive with scope+window.
- [x] `events invitees <e> --email <x>` with one match renders Q&A + cancel/reschedule URLs; with several renders the list.
- [ ] `busy --until 10d` → `VALIDATION_ERROR` naming the 7-day cap; happy path shows both row types against the live account. The cap-error half is unit-tested (including the exact-7-day boundary) and both row types render correctly against fixtures, but the live-account happy path is unverified — no live credentials on this machine. Left unchecked since the criterion as written is a live check.
- [x] All identifier args accept both UUID and URI — unit-tested (`events view`). No live spot check performed.

## Risks / unknowns

- External busy rows require a connected calendar with conflict-check on in the test account; if unavailable, validate the caveat-line path instead and note it.

## Notes

- `busy`'s schema requires an event `name` for calendly-type rows, but `GET /user_busy_times` only returns a URI reference (`event`) for those rows, not an embedded name. Implemented as a best-effort enrichment: dedupe the calendly-row event URIs, look each one up via `GET /scheduled_events/{uuid}`, and leave the name blank (not fail the command) if a lookup errors. This adds up to N extra live calls per `busy` invocation (N = distinct calendly events in the 7-day window) — reasonable given the window is capped and results are typically small, but worth knowing if it ever needs to become a single batched call.
- Extended `resolveScope` (in `src/calendly/scope.ts`, merged by `auth-identity`) to accept an optional pre-resolved `self` profile. `scoping.md` promises the `users/me` bootstrap runs once per invocation; both `events` and `busy` need `self` themselves (for the header label and the profile timezone) in addition to calling `resolveScope`, and without this the uncached/env-token-only path would have bootstrapped twice. Fully backward-compatible — the parameter is optional and every pre-existing call site is unaffected.
- Extracted the profile-timezone formatter that was a local helper in `commands/home.ts` into `src/time/format.ts` so `events` and `busy` could share it, rather than triplicating it. `home.ts` itself was left untouched (out of this plan's scope).
- Added `compact()` to `src/output/render.ts` so detail views (`events view`, the single-invitee path of `events invitees`) only render fields the API actually returned, rather than relying on the TOON encoder's handling of explicit `undefined` values.
- The "mixed" case in `events.md`'s "`status` column only when the filter allows mixed/canceled" note doesn't currently exist as a distinct state — the CLI's `--status` flag only ever resolves to exactly one of `active`/`canceled`. Implemented as: show the column whenever the resolved status isn't the default `active`.

## Follow-ups

- None beyond the plan's own noted live-only validation gaps above; `events cancel`/`events no-show` are already owned by the planned `events-write` (which depends on this plan) — no deferral needed.
