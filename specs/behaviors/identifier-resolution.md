# Behavior: Identifier resolution

## Rule

Every argument or flag that names a Calendly resource accepts any of:

1. **Bare UUID** (`GBGBDCAADAEDCRZ2`) — used verbatim in path segments; expanded to a URI for query params (the resource kind determines the URI prefix).
2. **Full Calendly URI** (`https://api.calendly.com/event_types/GBGB...`) — used verbatim in query params; last path segment extracted for path segments. The URI's resource kind must match what the argument expects; a mismatch is a `VALIDATION_ERROR` naming both kinds.
3. **Human name — event types only** (`"30 Minute Meeting"`): resolved against the user's event types (org-wide when `--org` is in effect) by case-insensitive exact match on `name`; if none, case-insensitive substring match. Exactly one hit resolves; zero hits → `NOT_FOUND` suggesting `types list`; multiple hits → `VALIDATION_ERROR` listing each candidate as `<uuid> (<name>)` so the next call can be exact.

## Applies To

All commands. Event-type name resolution applies to `types view/update/slots/availability`, `link`, and `book --type`. Invitee references (`events no-show`) accept UUID or URI only (invitee emails select via `events list --email`, not as identifiers).

## Details

- UUID extraction from a URI: the last path segment. URI construction from a UUID: `https://api.calendly.com/<collection>/<uuid>` with the collection implied by the argument's expected kind.
- URIs are URL-encoded when placed in query strings.
- Name resolution costs a `GET /event_types` sweep (paginated to completion); resolution results are not cached — event type names are mutable.
- Output always leads with the UUID as the row id column; detail views include the full `uri` and any user-facing URL (`scheduling_url`, `booking_url`) so every identifier an agent might paste back is one it has already seen.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Accept any identifier form; never make the agent build a URI](../principles.md#accept-any-identifier-form-never-make-the-agent-build-a-uri) — this behavior is that principle operationalized.
