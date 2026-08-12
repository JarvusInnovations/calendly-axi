# Behavior: Pagination and limits

## Rule

List commands fetch with the API-maximum page size (`count=100`) and follow `next_page_token` until either the cursor drains or the command's effective limit is reached. The output header always states which happened:

- Cursor drained: `count: <n>` plus `complete: true`.
- Limit hit with more available: `count: <n> shown, more available` plus a `help` hint to raise `--limit` or narrow the window. Never a bare number that reads as "this is everything."

## Applies To

`events list`, `events invitees`, `types list`, `webhooks list`, and the internal fetches behind name/email resolution (which always drain the cursor).

## Details

- Calendly reports **no total count** anywhere; "more available" is inferred from a non-null `next_page_token` at stop time. We never claim a total we can't know.
- Default limits: `events list` 100; `events invitees` unlimited (drain — one event's invitees are naturally bounded); `types list` unlimited (drain); `webhooks list` unlimited (drain). `--limit <n>` overrides where offered; `--limit 0` means drain explicitly.
- Empty results are definitive per AXI §5: state the zero with the resolved scope and window (`events: 0 active events for Chris Alfano, 2026-08-11 → 2026-08-18`).
- `user_busy_times` and `event_type_available_times` don't paginate (window-capped instead — see [time windows](time-windows.md)); their outputs still carry `complete: true`.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Paginate to completion; never silently cap](../principles.md#paginate-to-completion-never-silently-cap) — this behavior is that principle operationalized against an API with no total counts.
