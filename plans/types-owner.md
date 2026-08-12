---
status: planned
depends: []
specs:
  - specs/commands/types.md
  - specs/api/event-types.md
issues: [15]
---

# Plan: Create-with-owner + boundary honesty (issue #15: items 3, 1, 4)

## Scope

**In:** `types create --owner <who>` (UUID/URI/email via `resolveUserFlag`, default self — the highest-value item from the first field report, live-confirmed feasible via `owner` on POST); the rename warning on `types update --name` (slug/scheduling_url don't follow — the API silently ignores slug writes, so nothing else will ever surface this); reference/SKILL/README boundary documentation for the three confirmed API ceilings (slug UI-only, custom questions UI-only, no delete) including the silent-ignore quirk. **Out:** location preset + diff echo (→ `types-ergonomics`), answers/UTM reads (→ `attribution-reads`).

## Implements

- `specs/commands/types.md` — the `--owner` flag and rename-warning additions.
- `specs/api/event-types.md` — the cross-user owner semantics, silent-ignore quirk, and boundary entries (spec'd from live probes 2026-08-12; see issue #15's triage comment).

## Validation

- [ ] `types create --owner <email>` resolves via org membership and creates on the teammate's page (fixture; live spot-check against a throwaway on a consenting teammate — the probe artifacts from 2026-08-12 already demonstrate the API path).
- [ ] `--owner` with a non-admin token's 403 rides the role-gate translation (fixture).
- [ ] `types update <t> --name <new>` output includes the slug-unchanged warning; a no-name update doesn't.
- [ ] `--help`/SKILL.md/README name all three boundaries + the silent-ignore quirk; `docs:check` green.

## Risks / unknowns

- None significant — API behavior already probed live.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
