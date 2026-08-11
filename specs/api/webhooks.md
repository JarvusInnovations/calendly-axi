# API: Webhook subscriptions

Everything under `webhooks`. Wrapping, pagination, and errors per [conventions](conventions.md).

## Endpoints

| Op | Endpoint | Notes |
| ---- | ---------- | ------- |
| List | `GET /webhook_subscriptions` | q: `organization`*(URI), `scope`* (`organization` \| `user` \| `group`), `user` (required when scope=user), `group`, `sort`, `count`, `page_token` |
| Create | `POST /webhook_subscriptions` | body required: `url` (HTTPS callback), `events[]`, `organization` (URI), `scope`; optional: `user` (required when scope=user), `group`, `signing_key` |
| Get | `GET /webhook_subscriptions/{uuid}` | |
| Delete | `DELETE /webhook_subscriptions/{uuid}` | |
| Sample payload | `GET /sample_webhook_data` | q: `event`*, `organization`*, `scope`*, `user`, `group` — a realistic payload without waiting for a real booking. **Response is the delivery envelope itself, unwrapped** (`{ event, created_at, created_by, payload }`) — not inside the usual `resource` wrapper (confirmed live) |

Subscription resource fields consumed: `uri`, `callback_url`, `state` (`active` \| `disabled`), `events[]`, `scope`, `organization`, `user`, `creator`, `created_at`, `retry_started_at`.

## Events

`invitee.created`, `invitee.canceled`, `invitee_no_show.created`, `invitee_no_show.deleted`, `event_type.created`, `event_type.updated`, `event_type.deleted`, `meeting_recap.created/.updated/.deleted` (user scope only), `routing_form_submission.created` (organization scope only), `contact.created/.updated/.deleted`.

## Gates & quirks

- **Creating subscriptions requires a paid plan** (Standard+) on the subscribing organization → `PLAN_REQUIRED` on 403. Reads work on Free.
- The token also needs the **read scope matching each subscribed event domain** (e.g. `scheduled_events:read` for `invitee.*`) in addition to `webhooks:write` — a scope-gate 403 names the missing scope.
- **No update endpoint** — changing a subscription is delete + recreate.
- Duplicate create (same url/events/scope) returns 409 → treated as already-subscribed no-op (the existing subscription is fetched and reported, exit 0).
- `signing_key` enables the `Calendly-Webhook-Signature` header (t=timestamp + HMAC-SHA256) on deliveries. The tool passes it through at create time and **never stores it** — it belongs to the receiving service, not this CLI's config.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The API's boundaries are spec'd, not papered over](../principles.md#the-apis-boundaries-are-specd-not-papered-over) — no-update is stated here; `webhooks` help offers delete + recreate.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — duplicate-create no-op above.
