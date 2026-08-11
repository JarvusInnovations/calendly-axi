# Command: events

Scheduled-event reads and fallout management. API contract: [api/scheduled-events](../api/scheduled-events.md).

## events list (default subcommand)

`calendly-axi events [list] [--status active|canceled] [--email <invitee-email>] [--from --to | --since <dur> | --until <dur>] [--org] [--user <who>] [--limit <n>]`

- Defaults: self-scoped, `status=active`, upcoming (`min_start_time=now`, `sort=start_time:asc`), limit 100. A past-window request (`--since`, or `--to` in the past) flips the default sort to `start_time:desc`.
- Header: resolved scope + window + status; count per [pagination](../behaviors/pagination-and-limits.md).
- Default schema: `events[N]{uuid,start,name,invitees,status}` (`invitees` = `invitees_counter.active`; `status` column only when the filter allows mixed/canceled).
- Suggestions: `events view <uuid>`, `events invitees <uuid>`, `events cancel <uuid> --reason "..."`.

## events view

`calendly-axi events view <event>` — full detail: uuid, uri, name, status, start/end (profile timezone + ISO), event type (uuid + name), location (type + join_url/address), hosts, invitee counts, guests, and — when canceled — who/why. Self-contained.

## events invitees

`calendly-axi events invitees <event> [--status active|canceled] [--email <e>]`

- Drains the cursor. Default schema: `invitees[N]{uuid,name,email,status,no_show}` (`no_show`: yes/no).
- Q&A answers appear in the single-invitee detail path: `events invitees <event> --email <e>` with exactly one match renders full detail including `questions_and_answers`, `cancel_url`, `reschedule_url`, reschedule chain.
- Suggestions: `events no-show <invitee-uuid> --event <event-uuid>`, `events cancel <event-uuid>`.

## events cancel

`calendly-axi events cancel <event> [--reason <text>]`

- Cancels and reports what went out: `canceled: <name> at <start> — invitees notified`.
- Already-canceled → no-op, exit 0 (`event already canceled (no-op)`).
- `--help` notes the platform boundary: there is no reschedule — cancel and rebook (`book` or `link`), and invitees hold their own `reschedule_url`.

## events no-show

`calendly-axi events no-show <invitee> [--event <event>] [--undo]`

- `<invitee>` accepts the invitee's **full URI** (`https://api.calendly.com/scheduled_events/<event-uuid>/invitees/<invitee-uuid>`, from the `--email` detail view), or a **bare invitee UUID paired with `--event <event>`** (both visible after `events invitees <event>`) — the tool constructs the nested URI itself, per [never make the agent build a URI](../principles.md#accept-any-identifier-form-never-make-the-agent-build-a-uri). Calendly nests every invitee under its event and exposes no flat `GET /invitees/{uuid}`, so a bare UUID **without** `--event` has no context to resolve against — it fails fast with `VALIDATION_ERROR` naming the `--event` fix.
- Marks the invitee as a no-show; `--undo` fetches the invitee record via its event and deletes via its `no_show.uri`.
- Already in the desired state → no-op, exit 0.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The booking loop is the center of gravity](../principles.md#the-booking-loop-is-the-center-of-gravity) — upcoming-first defaults; suggestions chain toward invitees/cancel.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — cancel/no-show no-ops.
- [Booking and cancelling are outward-facing](../principles.md#booking-and-cancelling-are-outward-facing--be-deliberate-not-chatty) — cancel output states that notifications fired.
- [Human time in, stamped window out](../principles.md#human-time-in-stamped-window-out) — window flags + echoed header.
