---
status: planned
depends: [events-read, types-read]
specs:
  - specs/commands/events.md
  - specs/commands/link.md
  - specs/api/scheduled-events.md
  - specs/api/booking.md
issues: []
---

# Plan: Events writes + link

## Scope

**In:** `events cancel` (reason, notification statement, already-canceled no-op), `events no-show` (mark + `--undo` via the invitee's `no_show.uri`, both idempotent), and `link <event-type>` (single-use scheduling link, name resolution via types-read's resolver). **Out:** `book` (own plan), shares.

## Implements

- `specs/commands/events.md` — cancel + no-show sections.
- `specs/commands/link.md` — fully.
- `specs/api/scheduled-events.md` — cancellation + no-show endpoints.
- `specs/api/booking.md` — the `scheduling_links` half.

## Validation

- [ ] Live round-trip: book a slot (web UI or `book` if landed), `events cancel <e> --reason test` → confirmation naming invitees notified; repeat → `already canceled (no-op)`, exit 0.
- [ ] No-show mark → invitee row shows `no_show: yes`; `--undo` clears it; both repeated → no-ops, exit 0.
- [ ] `link "30 min"` resolves by name, prints booking_url + resolved type identity + single-use note; booking through the URL then reusing it confirms single-use.
- [ ] Cancel help text names the no-reschedule boundary and the rebook path.

## Risks / unknowns

- The exact error Calendly returns for double-cancel (needed for the no-op translation) is undocumented — capture live, encode as fixture.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
