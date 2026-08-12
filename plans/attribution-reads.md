---
status: planned
depends: []
specs:
  - specs/commands/events.md
  - specs/api/scheduled-events.md
issues: [15]
---

# Plan: Attribution reads — invitee UTM + `events answers` (issue #15: item 5)

## Scope

**In:** surface the invitee `tracking` UTM block in the single-invitee detail view (API provides it; CLI currently drops it), and the new `events answers` aggregate: `events answers --type <t> [--window|--since|--from/--to] [--org] [--utm] [--status]` — drain scheduled events for scope+window, filter client-side by event type (the API has no type filter), drain matching events' invitees, emit one row per answer (or per invitee with `--utm`). **Out:** anything write-side.

## Implements

- `specs/commands/events.md` — the tracking block + the `events answers` section.
- `specs/api/scheduled-events.md` — tracking subfields + the no-type-filter note.

## Validation

- [ ] Invitee detail shows the UTM block when any tracking field is non-null and omits it when all-null (fixtures).
- [ ] `events answers --type <name>` resolves the type, drains + client-filters events, drains invitees, renders `{start,email,question,answer}` rows descending (multi-page fixtures); `--utm` swaps schema; `--status`/`--org` widen; empty window definitive.
- [ ] Window flags behave per time-windows (default `--since 30d`); `--window`-vs-`--since` conflict fires.
- [ ] Live spot-check against the account's real bookings (Q&A rows exist from the 2026-08-12 test booking's event type).

## Risks / unknowns

- Org-wide windows on busy orgs mean large drains (no server-side type filter); the header's `events: N` count keeps the cost visible. Revisit with a cap only if real usage hurts.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
