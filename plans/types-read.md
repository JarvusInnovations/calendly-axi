---
status: done
depends: [auth-identity]
specs:
  - specs/commands/types.md
  - specs/api/event-types.md
  - specs/behaviors/identifier-resolution.md
issues: []
pr: 7
---

# Plan: Types — reads + name resolution

## Scope

**In:** `types list` (active/inactive/all, `--org`), `types view` (truncated description + `--full`), `types slots` (31-day cap, empty-definitive), the availability **read** path of `types availability`, and — load-bearing for three later plans — **event-type name resolution** in `src/calendly/ids.ts` (exact → substring → candidate-list semantics). **Out:** create/update/one-off/availability-write (→ `types-write`), `link` (→ `events-write`), `book` (→ `book`).

## Implements

- `specs/commands/types.md` — list/view/slots + availability read.
- `specs/api/event-types.md` — read endpoints.
- `specs/behaviors/identifier-resolution.md` — the name-resolution tier.

## Validation

- [x] `types` lists active types name-ascending with scheduling_url; `--all` adds the active column; `--org` role-gate translated.
- [x] `types view` truncates a >500-char description with total size + `--full` hint; `--full` shows everything.
- [x] `types slots` default 7-day window; 32-day request → cap-naming error; empty window → definitive line with widen/availability hints.
- [x] Name resolution: exact beats substring; ambiguous substring lists `<uuid> (<name>)` candidates, exit 2; zero → `NOT_FOUND` + `types list` hint (unit-tested against fixtures, spot-checked live). *(Live spot-check 2026-08-11: `"30 minute virtual meeting"` resolved by exact name across a 27-type account. Live data also surfaced that real ids are mostly canonical lowercase dashed UUIDs — bare-id detection fixed on develop in `fix(types): live-API fixes`.)*
- [x] `types availability <t>` renders rules + timezone readably for the live account. *(Live-verified 2026-08-11 — weekly rules + intervals render cleanly. `types slots` also live-verified after fixing the strictly-future `start_time` requirement the API enforces — see `fix(types): live-API fixes` on develop.)*

## Risks / unknowns

- `event_type_available_times` slot shape (`invitees_remaining`) on group types is untested; slots on a non-solo type may need a schema tweak (spec update if so).
- `event_type_availability_schedules`' exact response shape beyond "rules + timezone" isn't detailed in `specs/api/event-types.md` and wasn't confirmed against a live account — the read path renders whatever the API returns rather than projecting a guessed schema, so a shape surprise degrades gracefully but the spec/renderer may need tightening once verified.

## Notes

No live Calendly credentials exist on this machine, so everything was validated with
vitest `fetch` spies against fixtures shaped to match the documented API contract
(`specs/api/conventions.md`, `specs/api/event-types.md`). 186 tests across 15 files;
`bun run check && bun run build && bun run test` clean.

Event-type name resolution needed a discriminator the spec doesn't spell out: given a
`<type>` argument, how do you tell "bare uuid" from "human name" without an API call?
Real Calendly uuids are uppercase alphanumeric with no lowercase letters (per the
spec's own example, `GBGBDCAADAEDCRZ2`), so `src/calendly/ids.ts` treats anything
matching `/^[A-Z0-9_-]+$/` as a bare id and everything else (any lowercase letter, or
whitespace) as a name to resolve — this correctly handles single-word names like
`"Meeting"` (mixed case) as well as multi-word ones. The one known gap: an
all-uppercase, no-space name (`"STANDUP"`) would still 404 as a bad uuid instead of
resolving by name. Worth a live spot-check once a PAT exists; tighten the heuristic
(or the spec) then if real event-type names collide with it.

Two Validation items stay unchecked — both explicitly call for a live account, which
this machine doesn't have:

- **Row 4** (name resolution) — the exact/substring/ambiguous/zero-hit logic is fully
  exercised in `test/calendly/ids.test.ts` against fixtures shaped to the documented
  `GET /event_types` collection response; the "spot-checked live" half of the
  checklist wording is what's outstanding.
- **Row 5** (`types availability`) — the read path is implemented and unit-tested
  against a plausible fixture, but the endpoint's exact schema is a Risk (above,
  carried over from planning) rather than something `specs/api/event-types.md`
  nails down, so "renders readably for the live account" can't be confirmed without
  one.

## Follow-ups

- Once a live PAT exists: spot-check name resolution and `types availability`
  against the real API, and tighten `BARE_TOKEN_RE`'s heuristic (or
  `specs/behaviors/identifier-resolution.md`) if reality collides with it.
  Tracked by this plan's own Notes/Risks rather than a separate issue, following
  `auth-identity`'s precedent for the same class of live-only gap.
- The `event_type_available_times` group-type shape risk (above) carries forward
  unresolved — first group/collective-type account that runs `types slots` should
  confirm the `invitees_remaining` shape and file a spec update if it differs.
