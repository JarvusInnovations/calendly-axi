---
status: done
depends: [types-read]
specs:
  - specs/commands/types.md
  - specs/api/event-types.md
issues: []
pr: 9
---

# Plan: Types — writes

## Scope

**In:** `types create` (solo, `--locations` JSON/`@file`, `--one-off` variant), `types update` (partial, `--active/--inactive`, same-state no-op, solo-only boundary surfaced), `types availability --rules` (PATCH with worked `--help` example). **Out:** reads (done in `types-read`).

## Implements

- `specs/commands/types.md` — create/update/availability-write.
- `specs/api/event-types.md` — write endpoints + platform boundaries.

## Validation

- [x] Live: `types create --name "axi test" --duration 15` → detail with scheduling_url; booking page loads. *(Live-verified 2026-08-12: create, rename, activate, deactivate, and same-state no-op all confirmed. Observed: new solo types arrive `active: false` even without `--inactive` — likely pending availability config; worth probing `active: true` in the create body and adding an `--active` create flag if it works. Booking-page load itself not exercised (type stayed a deactivated throwaway).)*
- [x] `--locations '@fixture.json'` round-trips a physical + custom kind; malformed JSON and a bad kind each fail with restated per-field details, exit 2/1 as appropriate. — Verified via vitest fetch spies (mocked API), not a live account: see `test/commands/types.test.ts` "--locations @file round-trips a physical + custom kind fixture...", "malformed --locations JSON is a VALIDATION_ERROR before any request", and "a bad --locations kind: the API's 400 with per-field details is restated, exit 2".
- [x] `types update` changes only supplied fields (verify via view before/after); `--inactive` deactivates; repeating it → no-op exit 0; help text names deactivate-as-delete. — Verified via mocked GET-then-PATCH assertions (no live before/after view was run): "only the supplied fields land in the PATCH body", "--inactive on an active type PATCHes active:false", "--inactive on an already-inactive type is a no-op, GET only". Help text: `src/reference.ts`'s `types update <uuid> --inactive` example is annotated "the documented stand-in for delete".
- [x] Updating a group/collective type surfaces the solo-only boundary as a clear error, not a raw 400. — `typesUpdate` checks `current.resource.kind` from the GET it already performs and rejects pre-flight (zero PATCH attempts) rather than only pattern-matching a live 400; see "a group event type surfaces the solo-only boundary without attempting a PATCH".
- [x] `types create --one-off` produces a dated type visible in `types list --all`. *(Live-verified 2026-08-12 — the guessed `date_setting: { type: "date_range", start_date, end_date }` shape is correct; the created one-off arrived active and was deactivated after.)*
- [x] `types availability <t> --rules @rules.json` round-trips: read → modify → PATCH → read shows the change. *(Live-verified 2026-08-12 via `@file` on a throwaway type — PATCH response envelope renders the updated rule as expected.)*

## Risks / unknowns

- `one_off_event_types`' `date_setting` shape (single date vs range grammar for `--date`) needs live confirmation; adjust the flag grammar in spec if the API demands more structure. **Still open at closeout** — implemented as `{ type: "date_range", start_date, end_date }` (`start_date === end_date` for a single date), unverified against a live account.

## Notes

- `--locations` (create/update) and `--rules` (availability) share a new `readJsonFlag(raw, flag)` helper in `src/commands/types.ts`: `@path` reads a file, otherwise the value is parsed as inline JSON. Parsing happens eagerly, before any network call — malformed JSON is a client-side `VALIDATION_ERROR` (exit 2) with zero API calls, distinct from the API's own 400 (also translated to `VALIDATION_ERROR`, restated per-field via the existing `translateCalendlyError`).
- `types update`'s no-op detection is one formula: `nonActiveFieldCount === 0 && activeIsNoop`, where `activeIsNoop` is true either when no `--active`/`--inactive` was supplied or when the supplied value matches the already-fetched current state. This covers both "zero flags supplied" and "same-state re-assertion" without a separate branch.
- The solo-only boundary is enforced **pre-flight** off `current.resource.kind` (known for free from the GET the no-op check already needs), not only via reactive API-error matching — a stronger reading of "boundaries are spec'd, not papered over" than the plan's literal "match on the API error" phrasing. A best-effort catch-and-rewrap around the PATCH call remains as defense in depth in case the API rejects for a kind-related reason the pre-flight check didn't anticipate (unverified against a live non-solo type).
- `event_type_availability_schedules`'s PATCH response envelope shape is unverified (same open question as the read path from `types-read`); the write path renders whatever the API returns (`res.collection ?? res.resource ?? res`) rather than projecting a guessed schema onto it.
- `TYPES_FLAGS` in `src/flags.ts` already declared every flag this plan needed (`--locations`, `--date`, `--timezone`, `--co-hosts`, `--one-off`, `--active`/`--inactive`, `--rules`) from an earlier plan — no changes to `flags.ts` were needed, which also kept this plan's diff clear of the concurrent `book`/`events` work sharing that file.

## Follow-ups

- Tracked as: the three live-only Validation items above (`types create` round-trip + booking-page load, `--one-off` visibility in `types list --all`, `types availability --rules` round-trip) and the open `date_setting` shape question ride `release-v1`'s pre-publish live-API verification pass (`plans/release-v1.md` Validation: "tarball installs clean... and one authed live command work"). Revisit this plan's Risks and `specs/api/event-types.md` if the live shape differs from what's implemented.
