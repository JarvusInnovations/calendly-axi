# API: Event types

Everything under `types` (and the resolution layer behind `link` and `book`). All paths relative to the base URL; wrapping, pagination, and errors per [conventions](conventions.md).

## Read

| Op | Endpoint | Notes |
| ---- | ---------- | ------- |
| List | `GET /event_types` | q: `user` **or** `organization` (one required, full URI), `active` (bool), `admin_managed`, `sort` (`name:asc` default ours), `count`, `page_token` |
| Get | `GET /event_types/{uuid}` | |
| Hosts | `GET /event_type_memberships` | q: `event_type`* (URI), `count`, `page_token` |

Key resource fields consumed: `uri`, `name`, `active`, `duration`, `duration_options`, `kind` (`solo` \| `group` \| `collective`...), `scheduling_url`, `description_plain`, `color`, `locations[]`, `pooling_type`, `custom_questions[]` (name, type, position, required, answer_choices), `profile.owner` (user URI).

## Write — solo (one-on-one) types only

| Op | Endpoint | Body |
| ---- | ---------- | ------ |
| Create | `POST /event_types` | required: `owner` (user URI — **may be another org member's** when the caller is an org admin, confirmed live 2026-08-12: the type lands on that member's scheduling page with `admin_managed: false` and full owner edit rights); optional: `duration`, `duration_options`, `color`, `description`, `locations[]`, `locale`, `active`. New types arrive `active: false` regardless of the `active` field observed so far |
| Update | `PATCH /event_types/{uuid}` | same fields, partial — unspecified fields untouched. Org admins can PATCH other members' types (confirmed live) |
| Create one-off | `POST /one_off_event_types` | required: `name`, `host` (user URI), `duration`, `date_setting`; optional: `co_hosts[]`, `location`, `timezone` |

**The silent-ignore quirk** (probed live 2026-08-12): POST and PATCH **silently drop** unrecognized or read-only body fields — `slug` and `custom_questions` both return 200 with nothing changed. No error will ever signal an unsupported write, so the client must never infer writability from a 2xx.

**Platform boundaries** (spec'd, not papered over):

- Create/update work for **`kind: solo` only** — group/collective/round-robin types are read-only via API.
- **There is no delete.** `DELETE /event_types/{uuid}` → 404 (probed live). `PATCH` with `active: false` deactivates; that is the strongest removal the API offers.
- **Slugs are UI-only.** `slug`/`scheduling_url` derive from the name at create time and are frozen thereafter — `slug` in a PATCH body is silently ignored. A rename never moves the booking URL.
- **Custom questions are UI-only.** `custom_questions` is readable but silently ignored in both POST and PATCH bodies (probed live both ways). Re-probe periodically — the silent-ignore pattern means writability could ship unannounced.
- `locations[]` entries are structured objects (`kind` + kind-specific fields, e.g. `{ "kind": "physical", "location": "..." }`, `{ "kind": "custom", "location": "..." }`, conferencing kinds); the API rejects malformed kinds with 400 details we restate.

## Availability

| Op | Endpoint | Notes |
| ---- | ---------- | ------- |
| Bookable slots | `GET /event_type_available_times` | q: `event_type`* (URI), `start_time`*, `end_time`* — window ≤ **31 days**, no pagination, and `start_time` must be **strictly in the future** (confirmed live: "start_time must be in the future"). Returns `collection[]` of `{ status, start_time, invitees_remaining, scheduling_url }` |
| List schedules | `GET /event_type_availability_schedules` | q: `event_type`* (URI) — the rules currently governing the type |
| Update schedules | `PATCH /event_type_availability_schedules` | q: `event_type`* (URI); body: `availability_rule` (nested `{ rules[], timezone }` structure) |

User-level schedules are read-only context: `GET /user_availability_schedules?user=<uri>` and `GET /user_availability_schedules/{uuid}` (no write endpoint exists at user level).

## Notes

- `scheduling_url` is the public booking page — surface it in list/detail output; it's the thing agents paste into messages.
- `custom_questions` drive `book`'s `--answer` mapping (position-indexed) — see [booking](booking.md).

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The API's boundaries are spec'd, not papered over](../principles.md#the-apis-boundaries-are-specd-not-papered-over) — solo-only writes and no-delete are stated here once and surfaced by `types` at the point of need.
