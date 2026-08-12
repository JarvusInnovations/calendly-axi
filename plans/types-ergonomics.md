---
status: planned
depends: [types-owner]
specs:
  - specs/commands/types.md
issues: [15]
---

# Plan: Types ergonomics — location preset + update diff echo (issue #15: item 6)

## Scope

**In:** `types create --location-kind <kind> [--location-text <text>]` sugar over `--locations` (mutually exclusive with it), and the `types update` diff echo (each changed field rendered `old → new`, derived from the pre-flight GET the no-op check already performs plus the PATCH response). **Out:** everything else. Depends on `types-owner` because both rework `types create`/`update` in `src/commands/types.ts`.

## Implements

- `specs/commands/types.md` — the `--location-kind` and diff-echo additions.

## Validation

- [ ] `--location-kind google_conference` maps to `[{kind}]`; `--location-kind physical --location-text "123 Main St"` maps to `[{kind, location}]`; combined with `--locations` → `VALIDATION_ERROR`, exit 2, zero API calls.
- [ ] `types update <t> --name X --duration 30` output shows both fields as `old → new`; unchanged fields absent; no-op path unchanged.
- [ ] `docs:check` green.

## Risks / unknowns

- None — pure sugar on tested plumbing.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
