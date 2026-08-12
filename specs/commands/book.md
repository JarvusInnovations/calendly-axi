# Command: book

Direct booking via the Scheduling API. Contract: [api/booking](../api/booking.md). **Paid plans only** — the Free-tier 403 renders as `PLAN_REQUIRED` naming Standard.

## book

`calendly-axi book --type <event-type> --at <iso-datetime> --name <invitee-name> --email <invitee-email> [--timezone <tz>] [--location <json>] [--answer <position>=<text> ...] [--guests <emails,>] [--org]`

- `--org` widens `--type` **name** resolution organization-wide (ids/URIs are exact and unaffected).
- `--type`, `--at`, `--name`, `--email` are all required — there is no default or inferred invitee, ever. Missing flags → `VALIDATION_ERROR` listing exactly what's missing, exit 2, no API call.
- `--at` must be an exact ISO instant per [time windows](../behaviors/time-windows.md); the value should come from `types slots`.
- `--answer` repeats, keyed by the event type's custom-question `position`. Client-side pre-validation: fetch the type's `custom_questions`; a missing **required** answer or an out-of-range position fails before the API call, listing the questions `{position, name, required}`.
- `--location` takes a kind object (JSON) when the event type offers a choice. The API demands an explicit location choice even when the type has exactly one option (confirmed live: omitting it → 400 `invalid location choice`), so when the type has **exactly one location of a conferencing kind** (e.g. `google_conference`) and no `--location` was passed, the tool defaults `location` to that kind — the only choice the invitee could have made. Kinds needing invitee input (`ask_invitee`, `outbound_call`) or venue text are never defaulted; those still require explicit `--location`.
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
