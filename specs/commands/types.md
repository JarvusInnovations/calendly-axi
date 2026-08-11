# Command: types

Event type management. API contract: [api/event-types](../api/event-types.md). Identifier args accept UUID / URI / name per [identifier resolution](../behaviors/identifier-resolution.md).

## types list (default subcommand)

`calendly-axi types [list] [--org] [--all] [--inactive]`

- Default: the authenticated user's **active** types. `--inactive` shows only inactive; `--all` shows both (with `active` added to the schema). `--org` lists organization-wide (admin required).
- Drains the cursor (no `--limit`).
- Default schema: `types[N]{uuid,name,duration,kind,scheduling_url}`, sorted `name:asc`.
- Suggestions: `types view <uuid>`, `types slots <uuid>`, `link <uuid>`.

## types view

`calendly-axi types view <type>` — full detail: uuid, uri, name, active, kind, duration(+options), scheduling_url, color, locations (kind + display), description (truncated at 500 chars with total size + `--full` hint), custom questions `{position,name,type,required}`, owner. Self-contained — no suggestions.

## types slots

`calendly-axi types slots <type> [--from --to | --until <dur>]`

- Default window: next 7 days; cap 31 days per [time windows](../behaviors/time-windows.md).
- Output: resolved window header, then `slots[N]{start,invitees_remaining}` of available slots (times in profile timezone alongside ISO), `complete: true`.
- Empty: definitive (`slots: no availability for "<name>" in <window>`), suggesting a wider window or `types availability <uuid>`.
- Suggestions: `book --type <uuid> --at <start> ...`, `link <uuid>`.

## types create

`calendly-axi types create --name <n> --duration <min> [--description <text>] [--color <hex>] [--locations <json|@file>] [--inactive]`

- Creates a **solo** type owned by the authenticated user (`owner` from profile cache).
- `--locations` takes the API's structured JSON (array of kind objects) inline or `@file`; `--help` documents the common kinds with examples. Malformed → the API's 400 details restated per-field.
- One-off variant: `types create --one-off --name <n> --duration <min> --date <YYYY-MM-DD>[..<YYYY-MM-DD>] [--timezone <tz>] [--co-hosts <ids,>]` → `POST /one_off_event_types`.
- Output: the created type's detail view (uuid, scheduling_url front and center).

## types update

`calendly-axi types update <type> [--name --duration --description --color --locations --active|--inactive]`

- Partial update — only supplied flags are sent. Solo types only; attempting a group/collective type surfaces the platform boundary.
- `--inactive` is the documented stand-in for delete (`--help` says so); `--active` reactivates. Setting the state it already has is a no-op, exit 0.

## types availability

`calendly-axi types availability <type> [--rules <json|@file>]`

- Without `--rules`: prints the type's availability schedules (rules + timezone), rendered compactly.
- With `--rules`: `PATCH /event_type_availability_schedules` with the given `availability_rule` JSON. The nested rules structure is JSON-only by design — no flag sugar; `--help` carries a worked example.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The API's boundaries are spec'd, not papered over](../principles.md#the-apis-boundaries-are-specd-not-papered-over) — solo-only writes, deactivate-as-delete, both stated in `--help` and errors at the point of need.
- [Accept any identifier form](../principles.md#accept-any-identifier-form-never-make-the-agent-build-a-uri) — `<type>` args take UUID/URI/name everywhere.

**Local:**

- **Nested structures ride JSON, scalars ride flags.** Locations and availability rules are deeply-shaped API objects; inventing flag grammars for them would be lossier than the JSON they already have. Scalar fields (name, duration, color) always get first-class flags. Apply the same split to any future write surface.
