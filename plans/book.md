---
status: done
depends: [types-read]
specs:
  - specs/commands/book.md
  - specs/api/booking.md
issues: []
pr: 8
---

# Plan: Book — direct booking via the Scheduling API

## Scope

**In:** `book` end to end — required-flag validation before any API call, custom-question pre-validation against the type's `custom_questions`, `--answer`/`--guests`/`--location`/`--timezone` handling, confirmation output with cancel/reschedule URLs, and the three failure shapes (409 slot-taken, booking-specific 429 wording, `PLAN_REQUIRED` on Free). **Out:** nothing — this is the whole command.

## Implements

- `specs/commands/book.md` — fully.
- `specs/api/booking.md` — the `POST /invitees` half.

## Validation

- [x] Missing any required flag → exit 2 listing exactly the missing ones, zero API calls (asserted via fetch spy).
- [x] Required custom question unanswered → pre-flight `VALIDATION_ERROR` listing `{position,name,required}`, zero booking calls.
- [ ] Live (paid account): `types slots` → `book` that slot → confirmation with event uuid + URLs; the meeting appears in `events` and the invitee got the standard email.
- [x] Booking the same slot again → `CONFLICT` suggesting `types slots`. (Fixture-verified: a 409 on `POST /invitees` renders `CONFLICT` suggesting `types slots <type>`. Not literally re-booked against a live already-taken slot — that half rides the unchecked live row above.)
- [x] 429 fixture renders the booking-specific limits (10/min, 50/hr, 100/day), not the general ones; free-token 403 fixture renders `PLAN_REQUIRED` naming Standard.
- [x] No retry logic exists on this path (code inspection + spy asserting single POST on transient-error fixture).

## Risks / unknowns

- Date-only `--at` rejection vs. natural-language leniency: spec says reject; confirm this doesn't frustrate real agent use before 1.0 (revisit spec if it does).

## Notes

No live Calendly credentials exist on this machine, and booking live would also email a
real invitee — so, per this plan's Constraints, everything was validated with vitest
`fetch` spies against fixtures shaped to `specs/api/booking.md` and
`specs/api/conventions.md` (stubbed `XDG_CONFIG_HOME`, `CALENDLY_AXI_DISABLE_HOOKS=1`).
259 tests across 20 files; `bun run check && bun run build && bun run test` clean. PR #8.

`parseFlags` gained repeatable-flag support (a `multi?: string[]` `FlagSpec` entry,
accumulating into a `string[]` read back via the new `multiStr` helper) since the
existing value-flag path was last-wins and `--answer` repeats per custom question —
declared additive and covered by its own unit tests in `test/flags.test.ts` rather than
folded silently into `book`'s tests.

The custom-question pre-flight fetches `event_types/{uuid}` unconditionally (even with
zero `--answer` flags) since a required-question check needs the full question list
regardless of what was answered — one extra round trip before every booking call, same
tradeoff `types slots` already made for its type-name fetch.

`--answer <position>=<text>` splits on the *first* `=` only, so answer text containing
`=` (e.g. "my email is x=y") passes through intact rather than being truncated.

The 429 rewrap intercepts the client's already-translated `RATE_LIMITED` `AxiError`
(rather than re-parsing the raw `Response`) since `calendlyRequest` doesn't expose the
raw body past its own translation layer — cheaper than threading a booking-specific
error path through `client.ts` for one call site, and keeps the general/booking split
entirely local to `book.ts`.

Confirmation output's `name` field is the event *type's* name (from the pre-flight
`event_types/{uuid}` fetch already in hand), not something `POST /invitees`' response
returns — the booking response per `specs/api/booking.md` only carries
`uri`/`event`/`cancel_url`/`reschedule_url`. A scheduled event's name defaults to its
event type's name unless overridden per-event, which isn't exposed by this endpoint;
untested against a live account where the two might diverge.

## Follow-ups

- Once a live PAT + paid plan exist: the unchecked Validation row (live `types slots` →
  `book` → confirmation, meeting shows in `events`, invitee receives the real
  confirmation email) is the only outstanding item. Tracked here rather than a separate
  issue, following `auth-identity`/`types-read`'s precedent for this class of live-only
  gap.
- If a live booking's confirmation `name` ever diverges from the event type's name
  (see Notes), tighten `renderConfirmation` to prefer a name from the response if one
  ever appears there, and update `specs/api/booking.md`'s documented response shape.
