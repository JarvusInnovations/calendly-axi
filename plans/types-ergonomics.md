---
status: done
depends: [types-owner]
specs:
  - specs/commands/types.md
issues: [15]
pr: 20
---

# Plan: Types ergonomics — location preset + update diff echo (issue #15: item 6)

## Scope

**In:** `types create --location-kind <kind> [--location-text <text>]` sugar over `--locations` (mutually exclusive with it), and the `types update` diff echo (each changed field rendered `old → new`, derived from the pre-flight GET the no-op check already performs plus the PATCH response). **Out:** everything else. Depends on `types-owner` because both rework `types create`/`update` in `src/commands/types.ts`.

## Implements

- `specs/commands/types.md` — the `--location-kind` and diff-echo additions.

## Validation

- [x] `--location-kind google_conference` maps to `[{kind}]`; `--location-kind physical --location-text "123 Main St"` maps to `[{kind, location}]`; combined with `--locations` → `VALIDATION_ERROR`, exit 2, zero API calls.
- [x] `types update <t> --name X --duration 30` output shows both fields as `old → new`; unchanged fields absent; no-op path unchanged.
- [x] `docs:check` green.

## Risks / unknowns

- None — pure sugar on tested plumbing.

## Notes

`--location-kind` also feeds `--one-off`'s singular `location` field (a bare
object, not array-wrapped) — a small extension beyond the spec's literal text
but natural given the shared flag/variable, and covered by a test.

The `LocationConfiguration` kind enum used for client-side validation wasn't
actually already in `specs/api/event-types.md` (the read-first brief assumed
it was) — added it there in this plan's first commit, sourced from Calendly's
location-kind API reference rather than a live probe. It hedges on
`zoom`/`zoom_conference`, `gotomeeting`/`gotomeeting_conference`,
`webex`/`webex_conference` the same defensive way `book.ts`'s
`AUTO_DEFAULT_LOCATION_KINDS` already does, since the API's exact naming per
kind isn't independently confirmed.

## Follow-ups

- None.
