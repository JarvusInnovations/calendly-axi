# Behavior: Time windows

## Rule

Commands taking a time window accept human forms and convert to the UTC ISO-8601 instants the API wants. Accepted forms:

- `--from <date|datetime>` / `--to <date|datetime>` — `YYYY-MM-DD` (interpreted in the cached profile timezone, from start/end of day) or full ISO datetimes.
- `--since <dur>` — a lookback (`7d`, `24h`, `2w`) ending now.
- `--until <dur>` — a lookahead (`7d`, `30d`) starting now.
- Named windows: `today`, `tomorrow`, `week` (current Mon–Sun in profile timezone).

The **resolved window is echoed in the output header** as a year-stamped label (`window: 2026-08-11 → 2026-08-18 (America/New_York)`), so a wrong window is visible, not silent.

## Applies To

`events list` (default: upcoming — from now, no upper bound, `sort start_time:asc`), `busy` (default: `--until 7d`), `types slots` (default: `--until 7d`), `book --at` (a single instant, not a window — same datetime parsing).

## Details

- API hard caps are enforced client-side with the cap named in the error: `busy` ≤ 7 days, `types slots` ≤ 31 days. Over-cap → `VALIDATION_ERROR` (`the Calendly API caps busy-time windows at 7 days; narrow --from/--to`). We do not silently clamp.
- Unparseable input → `VALIDATION_ERROR` listing the accepted forms.
- Date-only values use the profile-cache timezone (fallback UTC when no cache); full datetimes pass through as given.
- `book --at` requires an unambiguous instant: date-only input is rejected (`VALIDATION_ERROR` — the API books exact slot start times; run `types slots` to pick one).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Human time in, stamped window out](../principles.md#human-time-in-stamped-window-out) — including the fail-fast-on-cap rule.
