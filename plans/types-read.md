---
status: planned
depends: [auth-identity]
specs:
  - specs/commands/types.md
  - specs/api/event-types.md
  - specs/behaviors/identifier-resolution.md
issues: []
---

# Plan: Types — reads + name resolution

## Scope

**In:** `types list` (active/inactive/all, `--org`), `types view` (truncated description + `--full`), `types slots` (31-day cap, empty-definitive), the availability **read** path of `types availability`, and — load-bearing for three later plans — **event-type name resolution** in `src/calendly/ids.ts` (exact → substring → candidate-list semantics). **Out:** create/update/one-off/availability-write (→ `types-write`), `link` (→ `events-write`), `book` (→ `book`).

## Implements

- `specs/commands/types.md` — list/view/slots + availability read.
- `specs/api/event-types.md` — read endpoints.
- `specs/behaviors/identifier-resolution.md` — the name-resolution tier.

## Validation

- [ ] `types` lists active types name-ascending with scheduling_url; `--all` adds the active column; `--org` role-gate translated.
- [ ] `types view` truncates a >500-char description with total size + `--full` hint; `--full` shows everything.
- [ ] `types slots` default 7-day window; 32-day request → cap-naming error; empty window → definitive line with widen/availability hints.
- [ ] Name resolution: exact beats substring; ambiguous substring lists `<uuid> (<name>)` candidates, exit 2; zero → `NOT_FOUND` + `types list` hint (unit-tested against fixtures, spot-checked live).
- [ ] `types availability <t>` renders rules + timezone readably for the live account.

## Risks / unknowns

- `event_type_available_times` slot shape (`invitees_remaining`) on group types is untested; slots on a non-solo type may need a schema tweak (spec update if so).

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
