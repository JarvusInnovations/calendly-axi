# API: Calendly v2 conventions

The contract calendly-axi consumes. Source: <https://developer.calendly.com/api-docs/>.

## Base URL

`https://api.calendly.com` — no version segment, no version header. ("v2" only distinguishes this API from the retired v1.)

## Auth (every request)

- `Authorization: Bearer <personal-access-token>`
- `User-Agent: calendly-axi (https://github.com/JarvusInnovations/calendly-axi)`

PATs are created in the Calendly web app under **Integrations → API & Webhooks → Generate new token**, shown once, and never expire (they are auto-revoked if the user changes login email/password/method). PATs work on **every plan including Free**; individual endpoints are plan-gated instead (see per-endpoint specs). Newer PATs carry **scopes** chosen at creation; legacy tokens have full access. `auth setup`'s guidance lists the scopes this tool uses: `users:read`, `organizations:read`, `event_types:read/write`, `scheduled_events:read/write`, `availability:read/write`, `scheduling_links:write`, `webhooks:read/write`.

## Response envelopes

- Single resource: `{ "resource": { ... } }`
- Collection: `{ "collection": [ ... ], "pagination": { "count", "next_page", "previous_page", "next_page_token", "previous_page_token" } }`

## Identifiers

Every cross-resource reference is a **full URI** (`https://api.calendly.com/users/ABC123XYZ`): query params (`user`, `organization`, `event_type`, `owner`, `invitee`, ...) take URIs, and response bodies reference related resources by URI. **Path params take the bare UUID** (the URI's last path segment). URIs in query strings must be URL-encoded. The client owns both conversions — see [identifier resolution](../behaviors/identifier-resolution.md).

The API never infers scope from the caller: list endpoints require explicit `user` and/or `organization` URIs — see [scoping](../behaviors/scoping.md).

## Pagination

Cursor-based: request params `count` (default 20, max 100) and `page_token`; follow `pagination.next_page_token` until null. **No total count is ever reported.** Exceptions: `GET /user_busy_times` and `GET /event_type_available_times` don't paginate (they're bounded by hard date-window caps instead). See [pagination and limits](../behaviors/pagination-and-limits.md).

## Rate limits

- Per user per minute, shared across all callers of the account: **500 (paid plans) / 50 (Free)**.
- Every response carries `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (seconds until reset, typically ≤60). The client captures these; `doctor` surfaces the current headroom.
- `POST /invitees` (booking) has separate, much tighter limits — see [booking](booking.md).
- On 429, the error output states how long to wait (from `X-RateLimit-Reset`).

## Dates & times

UTC ISO-8601 (`2026-08-11T15:00:00Z`) everywhere. Range filters use `min_`/`max_` prefixes (e.g. `min_start_time`).

## Error envelope

```json
{ "title": "...", "message": "...", "details": [{ "parameter": "...", "message": "..." }] }
```

`title` and `message` are always present; `details` appears on validation failures.

## Error mapping

The client translates HTTP errors into `AxiError`s (raw bodies never reach stdout):

| HTTP | AxiError code | Suggestion references |
| ------ | --------------- | ----------------------- |
| 400 | `VALIDATION_ERROR` | the rejected parameter(s) from `details`, restated against our flag names |
| 401 | `TOKEN_INVALID` | `calendly-axi auth setup` + the token-creation URL |
| 403 (`InsufficientScopeError`) | `FORBIDDEN` | the missing token scope by name + "regenerate your PAT with it" |
| 403 (plan gate) | `PLAN_REQUIRED` | the Calendly tier that unlocks the feature |
| 403 (role gate) | `FORBIDDEN` | the org role needed (e.g. admin for org-wide event listing) |
| 404 | `NOT_FOUND` | the relevant list command to find valid ids |
| 409 | `CONFLICT` | restated conflict (e.g. slot no longer available for `book`) |
| 429 | `RATE_LIMITED` | wait time from `X-RateLimit-Reset` |
| ≥500 | `SERVER_ERROR` | retry after a moment |

Distinguishing the 403 variants: match on the error `title`/`message` (`InsufficientScopeError` is named in the body; plan gates mention the plan/upgrade). When the body is ambiguous, fall back to `FORBIDDEN` with both possibilities suggested.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Translate errors; never leak raw API noise](../principles.md#translate-errors-never-leak-raw-api-noise) — the mapping table above, including the plan-gate and scope-gate 403 split.
- [Accept any identifier form](../principles.md#accept-any-identifier-form-never-make-the-agent-build-a-uri) — the URI/UUID duality is owned entirely by the client layer.
