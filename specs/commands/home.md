# Command: home (no-args view)

## Route

`calendly-axi` with no arguments — also the payload the SessionStart hook injects, so every line is paid on every session start.

## Data Requirements

Profile cache (identity — zero API calls) + one live call: `GET /scheduled_events?user=<self>&status=active&min_start_time=<now>&sort=start_time:asc&count=5`.

## Display Rules

The SDK prepends `bin:` + `description:`. Then:

- **Configured:** `account:` line (name + email from cache), then `upcoming[N]{uuid,start,name,invitees}:` — up to 5 rows, start times rendered in the profile timezone. When zero upcoming: `upcoming: no active events scheduled` (definitive, not an error).
- **Unconfigured:** no API call; a `status: not configured` line plus `help` pointing at `auth setup` and the PAT-creation URL.
- **API unreachable / token invalid:** identity from cache, a one-line `status:` naming the problem, and a `doctor` hint — never a raw error, never nonzero exit; a broken home view must not break session start.

## Actions

`help[3..4]` suggestions, booking-loop first: `events` (what's scheduled), `link <event-type>` (get a link out), `types` (what's bookable), `doctor` when anything degraded.

## Navigation

Entry point to everything; every suggestion is a complete runnable command.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The booking loop is the center of gravity](../principles.md#the-booking-loop-is-the-center-of-gravity) — upcoming events are the content; loop commands are the suggestions.
- [Never make the agent discover scope](../principles.md#never-make-the-agent-discover-scope) — one API call, scoped from cache.
