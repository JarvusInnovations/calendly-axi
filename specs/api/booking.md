# API: Booking — Scheduling API + single-use links

The two ways calendly-axi gets a meeting onto a calendar: booking it directly (`book`) or minting a single-use link for the invitee to book themselves (`link`).

## Direct booking (Scheduling API)

`POST /invitees`

- Body, required: `event_type` (URI), `start_time` (UTC ISO-8601 — must be a currently-available slot), `invitee` (`{ name, email, timezone? }`).
- Body, optional: `location` (kind-specific object, needed when the event type offers multiple location options), `questions_and_answers[]` — each item requires the **question text itself** alongside the answer: `{ question, answer, position }` (confirmed live: omitting `question` is rejected with `questions_and_answers[0].question: is missing`); items map to the event type's `custom_questions` by position and required questions must be answered. `event_guests[]` (emails), `tracking` (UTM fields).
- Response: the created invitee resource (`uri`, `event` URI, `cancel_url`, `reschedule_url`, ...). Booking triggers the event type's normal confirmations, notifications, and workflows.

**Gates & limits:**

- **Paid plans only (Standard+).** A Free-plan token gets 403 → `PLAN_REQUIRED` naming Standard.
- Separate platform rate limits, independent of the general per-minute cap: Trial 5/day; paid non-Enterprise **10/min, 50/hr, 100/day**; Enterprise 500/min. A 429 here reports these limits, not the general ones.
- A `start_time` that is no longer available returns 409 → `CONFLICT`, suggesting `types slots <event-type>` to re-check availability.

## Single-use scheduling links

`POST /scheduling_links`

- Body: `max_event_count: 1` (the only supported value), `owner` (event type URI), `owner_type: "EventType"`.
- Response: `{ booking_url, owner, owner_type }`. The link admits exactly one booking, then dies.
- Works on all plans.

## Platform boundaries

- `POST /shares` ("customize once and share" — per-share overrides of duration/availability) exists but is **out of scope for v1**; `link` creates plain single-use links only.
- No idempotency keys — a retried `book` double-books. The client never auto-retries `POST /invitees`.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Booking and cancelling are outward-facing](../principles.md#booking-and-cancelling-are-outward-facing--be-deliberate-not-chatty) — no auto-retry, explicit invitee args, notification effects stated in output.
