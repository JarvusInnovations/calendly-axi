---
name: calendly-axi
description: >-
  See what's scheduled on Calendly, get a scheduling link or book a meeting
  directly, and manage the fallout — cancel events, mark no-shows, adjust
  event types and availability, inspect webhook subscriptions. Use when asked
  about Calendly meetings or bookings: what's coming up, who booked, share a
  way to book, book directly, cancel or "reschedule" (cancel + rebook) an
  event, mark someone a no-show, create/update/deactivate an event type,
  check busy times, or manage a Calendly webhook subscription. Triggers on
  "Calendly", "scheduled events", "booking link", "no-show", "event types",
  "availability", "webhooks", "who booked".
---

# calendly-axi

An [AXI](https://axi.md)-compliant CLI for the [Calendly API](https://developer.calendly.com/api-docs/) — see what's scheduled, share a way to book, and manage the fallout. Token-efficient [TOON](https://toonformat.dev/) output; every identifier takes a UUID, a full Calendly URI, or (for event types) a name.

> This skill is static. For live state at session start (what's coming up next, with no invocation needed), install the SessionStart hook instead (see the project README) — the hook and this skill are two paths to the same tool; you only need one.

Every example below runs via `npx -y calendly-axi` so it works whether or not the package is installed globally. If `calendly-axi` is already on PATH, drop the `npx -y` prefix.

## Setup

```sh
npx -y calendly-axi auth setup --token <personal-access-token>
```

Create a Personal Access Token at <https://calendly.com/integrations/api_webhooks> (Integrations → API & Webhooks → Generate new token) with these scopes: `users:read`, `organizations:read`, `event_types:read/write`, `scheduled_events:read/write`, `availability:read/write`, `scheduling_links:write`, `webhooks:read/write`. Verify with `npx -y calendly-axi doctor`.

### `calendly-axi auth [setup|whoami|logout] [flags]`

Connect, inspect, or remove the stored Calendly Personal Access Token

Flags:

- --token <pat>   Personal Access Token (setup) — https://calendly.com/integrations/api_webhooks
- --refresh       re-fetch identity instead of using the cache (whoami)

```sh
npx -y calendly-axi auth setup --token <pat>
npx -y calendly-axi auth setup   (no token, already configured: revalidate + repair the hook)
npx -y calendly-axi auth whoami
npx -y calendly-axi auth whoami --refresh
npx -y calendly-axi auth logout
```

### `calendly-axi doctor`

Five ordered health checks — credentials, token, organization, rate-limit headroom, hooks — exit 1 on any failure

```sh
npx -y calendly-axi doctor
```

### `calendly-axi hook [install|status|uninstall]`

Manage the SessionStart hook (Claude Code, Codex, OpenCode) that injects the home view at session start

```sh
npx -y calendly-axi hook status
npx -y calendly-axi hook install
npx -y calendly-axi hook uninstall
```

## Booking loop

### `calendly-axi events [list|view|invitees|cancel|no-show] [<args>] [flags]`

List upcoming events, inspect invitees, cancel, and mark no-shows

Flags:

- --status active|canceled     filter by event status (list/invitees)
- --email <invitee-email>      filter/select by invitee email
- --from/--to/--since/--until  time window (list; default: upcoming)
- --org                        organization-wide instead of self-scoped
- --user <who>                 scope to another user
- --limit <n>                  cap the result count (list; default 100)
- --reason <text>               cancellation reason (cancel)
- no reschedule endpoint — cancel and rebook with `book` or `link`; invitees hold their own reschedule_url (cancel)
- --undo                        clear a no-show mark (no-show)
- --event <event>               event context for a bare invitee uuid (no-show)
- no-show's <invitee> is the full invitee URI, or a bare invitee uuid plus --event <event>

```sh
npx -y calendly-axi events
npx -y calendly-axi events view <uuid>
npx -y calendly-axi events invitees <uuid>
npx -y calendly-axi events invitees <uuid> --email "ada@example.com"
npx -y calendly-axi events cancel <uuid> --reason "scheduling conflict"
npx -y calendly-axi events no-show <invitee-uuid> --event <event-uuid>
npx -y calendly-axi events no-show <invitee-uuid> --event <event-uuid> --undo
```

### `calendly-axi link <event-type>`

Mint a single-use scheduling link for an event type — booking_url + resolved type, one booking then it dies

Flags:

- <event-type>   UUID, URI, or name — resolved against self scope

```sh
npx -y calendly-axi link "30 Minute Meeting"
npx -y calendly-axi link <event-type-uuid>
```

### `calendly-axi book --type <event-type> --at <iso-datetime> --name <name> --email <email> [flags]`

Book a meeting directly via the Scheduling API (paid plans only)

Flags:

- --type <event-type>   required — UUID, URI, or name
- --at <iso-datetime>   required — exact slot start (from `types slots`)
- --name <name>         required — invitee name
- --email <email>       required — invitee email
- --timezone <tz>       defaults to the profile timezone
- --location <json>     when the event type offers a location choice
- --answer <pos>=<text> repeatable — custom-question answers
- --guests <e,e,...>    additional invitee emails

```sh
npx -y calendly-axi book --type <uuid> --at 2026-08-18T15:00:00Z --name "Ada Lovelace" --email ada@example.com
```

### `calendly-axi busy [--from --to | --until <dur>] [--user <who>]`

Show busy intervals for the next 7 days (calendly events + connected-calendar blocks)

Flags:

- --from/--to/--until  time window (default: next 7 days; hard cap 7 days — over-cap fails fast)
- --user <who>         scope to another user instead of self

```sh
npx -y calendly-axi busy
npx -y calendly-axi busy --until 3d
```

## Event types

### `calendly-axi types [list|view|slots|create|update|availability] [<type>] [flags]`

List, inspect, and manage event types — bookable slots and availability rules

Flags:

- --org                 organization-wide listing (admin required; list)
- --all / --inactive    include or restrict to inactive types (list)
- --full                show the untruncated description (view)
- --from/--to/--until   slot-lookup window (slots; default 7d, cap 31d)
- --name/--duration/--description/--color   scalar fields (create/update; name+duration required on create)
- --locations <json|@file>   structured location kinds, e.g. physical/custom/conferencing (create/update)
- --active/--inactive   reactivate, or the documented stand-in for delete (update); same-state is a no-op
- --one-off             creates a dated one-off type instead of a standing solo type (create)
- --date <date>[..<date>]   required with --one-off; a single date or an inclusive range
- --timezone / --co-hosts <ids,>   one-off scheduling timezone and CSV of co-host user ids (create --one-off)
- --rules <json|@file>  availability_rule to PATCH — omit to read the current rules (availability)

```sh
npx -y calendly-axi types
npx -y calendly-axi types view <uuid>
npx -y calendly-axi types view <uuid> --full
npx -y calendly-axi types slots <uuid> --until 14d
npx -y calendly-axi types availability <uuid>
npx -y calendly-axi types create --name "Intro Call" --duration 30
npx -y calendly-axi types create --name "Intro Call" --duration 30 --locations '[{"kind":"physical","location":"123 Main St"}]'
npx -y calendly-axi types create --one-off --name "Ad-hoc Sync" --duration 15 --date 2026-08-18..2026-08-20 --timezone America/New_York
npx -y calendly-axi types update <uuid> --locations @locations.json
npx -y calendly-axi types update <uuid> --inactive   (the documented stand-in for delete)
npx -y calendly-axi types availability <uuid> --rules '{"rules":[{"type":"wday","wday":"monday","intervals":[{"from":"09:00","to":"17:00"}]}],"timezone":"America/New_York"}'
```

## Webhooks

### `calendly-axi webhooks [list|view|create|delete|sample] [<args>] [flags]`

Manage webhook subscriptions (reads work on Free; creation needs a paid plan)

Flags:

- --scope organization|user|group   default: organization; user defaults --user to self
- --user <who> / --group <id>       scope target (user/group scope only)
- --url <https-url> --events <e,e>  required for create; --url must be https
- --signing-key <key>               passed through, never stored (create)
- --event <event>                   which sample payload to fetch (sample; no --group)
- no update endpoint — delete + create to change a subscription's url/events

```sh
npx -y calendly-axi webhooks
npx -y calendly-axi webhooks view <uuid>
npx -y calendly-axi webhooks create --url https://example.com/hook --events invitee.created,invitee.canceled
npx -y calendly-axi webhooks delete <uuid>
npx -y calendly-axi webhooks sample --event invitee.created
```

## Getting help

Run `npx -y calendly-axi <command> --help` for any command's full flag reference. Run `npx -y calendly-axi` (no args, needs credentials) for the live home view — or skip the invocation entirely by installing the SessionStart hook (`npx -y calendly-axi hook install`).
