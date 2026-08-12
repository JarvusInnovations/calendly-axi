---
status: done
depends: []
specs:
  - specs/commands/events.md
  - specs/api/scheduled-events.md
issues: [15]
pr: 18
---

# Plan: Attribution reads — invitee UTM + `events answers` (issue #15: item 5)

## Scope

**In:** surface the invitee `tracking` UTM block in the single-invitee detail view (API provides it; CLI currently drops it), and the new `events answers` aggregate: `events answers --type <t> [--window|--since|--from/--to] [--org] [--utm] [--status]` — drain scheduled events for scope+window, filter client-side by event type (the API has no type filter), drain matching events' invitees, emit one row per answer (or per invitee with `--utm`). **Out:** anything write-side.

## Implements

- `specs/commands/events.md` — the tracking block + the `events answers` section.
- `specs/api/scheduled-events.md` — tracking subfields + the no-type-filter note.

## Validation

- [x] Invitee detail shows the UTM block when any tracking field is non-null and omits it when all-null (fixtures).
- [x] `events answers --type <name>` resolves the type, drains + client-filters events, drains invitees, renders `{start,email,question,answer}` rows descending (multi-page fixtures); `--utm` swaps schema; `--status`/`--org` widen; empty window definitive.
- [x] Window flags behave per time-windows (default `--since 30d`); `--window`-vs-`--since` conflict fires.
- [ ] Live spot-check against the account's real bookings (Q&A rows exist from the 2026-08-12 test booking's event type).

## Risks / unknowns

- Org-wide windows on busy orgs mean large drains (no server-side type filter); the header's `events: N` count keeps the cost visible. Revisit with a cap only if real usage hurts.

## Notes

Shipped as PR #18. `events answers` always issues a type-name detail fetch
(`GET /event_types/{uuid}`) for the header's resolved type name before
resolving the window — same shape as `types slots`'s pre-fetch — so a
`--window`/`--since` conflict fails after that one call, not before any
network call at all. `--status` (default `active`; `canceled`/`all` widen)
governs both the `scheduled_events` drain and each matched event's invitee
drain identically; `all` omits the `status` query param on both rather than
sending an unsupported value. The events API accepts no `event_type` filter
(confirmed in `specs/api/scheduled-events.md`), so the type match is a
client-side `event.event_type === typeUri` filter after the full
scope+window drain — costly on busy orgs with no upper bound, per the plan's
Risks note.

## Follow-ups

- Live spot-check (unchecked above) needs a real account run once a token is
  available: `events answers --type <the 2026-08-12 test booking's type>`
  against real Q&A data.
- If org-wide `events answers` drains prove expensive in practice, revisit
  with a cap per the plan's Risks/unknowns note — not done speculatively
  here.
