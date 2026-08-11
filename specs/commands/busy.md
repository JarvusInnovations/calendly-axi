# Command: busy

The authenticated user's busy intervals — Calendly events plus connected-calendar blocks. Contract: [api/scheduled-events § busy times](../api/scheduled-events.md#busy-times).

## busy

`calendly-axi busy [--from --to | --until <dur>] [--user <who>]`

- Default window: next 7 days; hard cap 7 days per [time windows](../behaviors/time-windows.md) (over-cap fails fast naming the cap).
- Header: resolved window; `complete: true` (endpoint is unpaginated).
- Default schema: `busy[N]{start,end,type,name}` sorted by start — `type` is `calendly` \| `external`; `name` is the event name for calendly rows, blank for external (the API shares no external detail).
- Empty: definitive (`busy: no busy intervals for <who> in <window>`).
- Output notes when external-calendar rows can't appear (no connected calendar / conflict-check off) — an all-calendly result is only "fully free otherwise" if a calendar is actually connected.
- Suggestions: `types slots <type>` (offer bookable times instead of raw gaps), `events`.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Human time in, stamped window out](../principles.md#human-time-in-stamped-window-out) — the 7-day cap is named, never silently clamped.

**Local:**

- **Busy is evidence, not availability.** Gaps in busy times are not bookable slots — only `types slots` answers "when can they book me." Output and suggestions must never imply otherwise.
