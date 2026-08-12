# Command: link

Mint a single-use booking link — the "send them a way to book" move, worth its own top-level verb. Contract: [api/booking](../api/booking.md). Works on all plans.

## link

`calendly-axi link <event-type> [--org]`

- `<event-type>` accepts UUID / URI / name per [identifier resolution](../behaviors/identifier-resolution.md); `--org` widens name resolution organization-wide (e.g. minting a link for a teammate's type).
- Creates a `max_event_count: 1` scheduling link owned by the type.
- Output: `booking_url` front and center, plus the resolved type (uuid + name + duration) so the agent can confirm it grabbed the right one before pasting the URL into a message. States the link's single-use nature.
- Suggestions: `events --email <invitee>` (see when they book), `link <other-type>`.

## Failure shapes

Unresolvable type → per identifier resolution (`NOT_FOUND` with `types list` hint, or the multi-candidate `VALIDATION_ERROR`).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The booking loop is the center of gravity](../principles.md#the-booking-loop-is-the-center-of-gravity) — this is the loop's sharpest tool; keep it one argument long.
