# API: Scheduled events, invitees, no-shows, busy times

Everything under `events` and `busy`. Wrapping, pagination, and errors per [conventions](conventions.md).

## Scheduled events

| Op | Endpoint | Notes |
| ---- | ---------- | ------- |
| List | `GET /scheduled_events` | q: `user` and/or `organization` (URIs — at least one required), `invitee_email`, `status` (`active` \| `canceled`), `min_start_time`, `max_start_time`, `sort` (`start_time:asc`/`desc`), `count`, `page_token`. Org-wide listing requires an admin/owner role — a role-gate 403 otherwise |
| Get | `GET /scheduled_events/{uuid}` | |
| Cancel | `POST /scheduled_events/{uuid}/cancellation` | body: `reason` (optional). Triggers cancellation notifications to invitees. Cancelling an already-canceled event returns an error — the client detects this case and treats it as a no-op (see [events](../commands/events.md)) |

Key resource fields consumed: `uri`, `name`, `status`, `start_time`, `end_time`, `event_type` (URI), `location` (`{ type, location?, join_url? }`), `invitees_counter` (`{ total, active, limit }`), `event_memberships[]` (hosts), `event_guests[]`, `cancellation` (`{ canceled_by, reason, canceler_type }` when canceled).

## Invitees

| Op | Endpoint | Notes |
|----|----------|-------|
| List | `GET /scheduled_events/{uuid}/invitees` | q: `status`, `email`, `sort`, `count`, `page_token` |
| Get | `GET /scheduled_events/{event_uuid}/invitees/{invitee_uuid}` | |

Key fields: `uri`, `name`, `email`, `status` (`active` \| `canceled`), `timezone`, `questions_and_answers[]` (`{ question, answer, position }`), `tracking`, `no_show` (`{ uri }` or null), `cancel_url`, `reschedule_url`, `rescheduled`, `new_invitee`/`old_invitee` (URIs linking a reschedule chain).

## Invitee no-shows

| Op | Endpoint | Notes |
| ---- | ---------- | ------- |
| Mark | `POST /invitee_no_shows` | body: `invitee` (invitee URI). Marking an already-marked invitee errors — treated as a no-op by the client |
| Get | `GET /invitee_no_shows/{uuid}` | |
| Unmark | `DELETE /invitee_no_shows/{uuid}` | The no-show UUID comes from the invitee record's `no_show.uri` — the client resolves it; the agent only ever names the invitee |

## Busy times

| Op | Endpoint | Notes |
|----|----------|-------|
| List | `GET /user_busy_times` | q: `user`* (URI), `start_time`*, `end_time`* — window ≤ **7 days**, no pagination. Rows: `{ type: calendly \| external, start_time, end_time, event? }` (`event` present on calendly-type entries; external entries come from connected calendars only when "check for conflicts" is enabled) |

## Platform boundaries

- **No reschedule endpoint.** Cancel + rebook is the API's reschedule; invitee records carry `reschedule_url` for the invitee-driven path.
- Event and invitee records are immutable via API apart from cancellation and no-show marking.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — the already-canceled / already-marked no-op translations above.
- [The API's boundaries are spec'd, not papered over](../principles.md#the-apis-boundaries-are-specd-not-papered-over) — no-reschedule is stated here and surfaced by `events cancel`'s help.
