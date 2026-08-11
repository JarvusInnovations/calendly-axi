---
status: planned
depends: [types-read]
specs:
  - specs/commands/book.md
  - specs/api/booking.md
issues: []
---

# Plan: Book — direct booking via the Scheduling API

## Scope

**In:** `book` end to end — required-flag validation before any API call, custom-question pre-validation against the type's `custom_questions`, `--answer`/`--guests`/`--location`/`--timezone` handling, confirmation output with cancel/reschedule URLs, and the three failure shapes (409 slot-taken, booking-specific 429 wording, `PLAN_REQUIRED` on Free). **Out:** nothing — this is the whole command.

## Implements

- `specs/commands/book.md` — fully.
- `specs/api/booking.md` — the `POST /invitees` half.

## Validation

- [ ] Missing any required flag → exit 2 listing exactly the missing ones, zero API calls (asserted via fetch spy).
- [ ] Required custom question unanswered → pre-flight `VALIDATION_ERROR` listing `{position,name,required}`, zero booking calls.
- [ ] Live (paid account): `types slots` → `book` that slot → confirmation with event uuid + URLs; the meeting appears in `events` and the invitee got the standard email.
- [ ] Booking the same slot again → `CONFLICT` suggesting `types slots`.
- [ ] 429 fixture renders the booking-specific limits (10/min, 50/hr, 100/day), not the general ones; free-token 403 fixture renders `PLAN_REQUIRED` naming Standard.
- [ ] No retry logic exists on this path (code inspection + spy asserting single POST on transient-error fixture).

## Risks / unknowns

- Date-only `--at` rejection vs. natural-language leniency: spec says reject; confirm this doesn't frustrate real agent use before 1.0 (revisit spec if it does).

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
