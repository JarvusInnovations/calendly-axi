# Command: book

Direct booking via the Scheduling API. Contract: [api/booking](../api/booking.md). **Paid plans only** — the Free-tier 403 renders as `PLAN_REQUIRED` naming Standard.

## book

`calendly-axi book --type <event-type> --at <iso-datetime> --name <invitee-name> --email <invitee-email> [--timezone <tz>] [--location <json>] [--answer <position>=<text> ...] [--guests <emails,>]`

- `--type`, `--at`, `--name`, `--email` are all required — there is no default or inferred invitee, ever. Missing flags → `VALIDATION_ERROR` listing exactly what's missing, exit 2, no API call.
- `--at` must be an exact ISO instant per [time windows](../behaviors/time-windows.md); the value should come from `types slots`.
- `--answer` repeats, keyed by the event type's custom-question `position`. Client-side pre-validation: fetch the type's `custom_questions`; a missing **required** answer or an out-of-range position fails before the API call, listing the questions `{position, name, required}`.
- `--location` takes a kind object (JSON) when the event type offers a choice; omitted otherwise.
- `--timezone` defaults to the profile-cache timezone.

## Output

Confirmation detail: event uuid + name, start (profile tz + ISO), invitee name/email, and the invitee's `cancel_url`/`reschedule_url` — plus a plain statement that Calendly sent the standard confirmation notifications. Suggestions: `events view <event-uuid>`, `events cancel <event-uuid>`.

## Failure shapes

- Slot taken (409) → `CONFLICT`, suggest `types slots <type>` to re-check.
- Scheduling-API rate limit (429) → `RATE_LIMITED` quoting the **booking-specific** limits (10/min, 50/hr, 100/day on paid non-Enterprise), not the general ones.
- **Never auto-retried** — no idempotency keys exist; a blind retry double-books and double-notifies.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Booking and cancelling are outward-facing](../principles.md#booking-and-cancelling-are-outward-facing--be-deliberate-not-chatty) — fully explicit invitee, no retry, notifications stated.
- [Human time in, stamped window out](../principles.md#human-time-in-stamped-window-out) — `--at` rejects ambiguous input rather than guessing a slot.
