---
status: planned
depends: [types-read]
specs:
  - specs/commands/types.md
  - specs/api/event-types.md
issues: []
---

# Plan: Types — writes

## Scope

**In:** `types create` (solo, `--locations` JSON/`@file`, `--one-off` variant), `types update` (partial, `--active/--inactive`, same-state no-op, solo-only boundary surfaced), `types availability --rules` (PATCH with worked `--help` example). **Out:** reads (done in `types-read`).

## Implements

- `specs/commands/types.md` — create/update/availability-write.
- `specs/api/event-types.md` — write endpoints + platform boundaries.

## Validation

- [ ] Live: `types create --name "axi test" --duration 15` → detail with scheduling_url; booking page loads.
- [ ] `--locations '@fixture.json'` round-trips a physical + custom kind; malformed JSON and a bad kind each fail with restated per-field details, exit 2/1 as appropriate.
- [ ] `types update` changes only supplied fields (verify via view before/after); `--inactive` deactivates; repeating it → no-op exit 0; help text names deactivate-as-delete.
- [ ] Updating a group/collective type surfaces the solo-only boundary as a clear error, not a raw 400.
- [ ] `types create --one-off` produces a dated type visible in `types list --all`.
- [ ] `types availability <t> --rules @rules.json` round-trips: read → modify → PATCH → read shows the change.

## Risks / unknowns

- `one_off_event_types`' `date_setting` shape (single date vs range grammar for `--date`) needs live confirmation; adjust the flag grammar in spec if the API demands more structure.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
