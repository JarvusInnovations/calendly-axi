---
status: done
depends: []
specs:
  - specs/commands/types.md
  - specs/api/event-types.md
issues: [15]
pr: 19
---

# Plan: Create-with-owner + boundary honesty (issue #15: items 3, 1, 4)

## Scope

**In:** `types create --owner <who>` (UUID/URI/email via `resolveUserFlag`, default self — the highest-value item from the first field report, live-confirmed feasible via `owner` on POST); the rename warning on `types update --name` (slug/scheduling_url don't follow — the API silently ignores slug writes, so nothing else will ever surface this); reference/SKILL/README boundary documentation for the three confirmed API ceilings (slug UI-only, custom questions UI-only, no delete) including the silent-ignore quirk. **Out:** location preset + diff echo (→ `types-ergonomics`), answers/UTM reads (→ `attribution-reads`).

## Implements

- `specs/commands/types.md` — the `--owner` flag and rename-warning additions.
- `specs/api/event-types.md` — the cross-user owner semantics, silent-ignore quirk, and boundary entries (spec'd from live probes 2026-08-12; see issue #15's triage comment).

## Validation

- [x] `types create --owner <email>` resolves via org membership and creates on the teammate's page (fixture).
- [ ] Live spot-check against a throwaway on a consenting teammate — the probe artifacts from 2026-08-12 already demonstrate the API path.
- [x] `--owner` with a non-admin token's 403 rides the role-gate translation (fixture).
- [x] `types update <t> --name <new>` output includes the slug-unchanged warning; a no-name update doesn't.
- [x] `--help`/SKILL.md/README name all three boundaries + the silent-ignore quirk; `docs:check` green.

## Risks / unknowns

- None significant — API behavior already probed live.

## Notes

Shipped as PR #19. `--owner` resolution rides `resolveUserFlag` unchanged
(no changes to `src/calendly/scope.ts`) — email resolves via an
`organization_memberships` lookup scoped to the caller's own org, UUID/URI
resolve locally with zero network calls. The resolved URI replaces `self.
user_uri` as the POST body's `owner`; the one-off create path (`--one-off`,
`host: self.user_uri`) is untouched — `--owner` isn't documented there and
the spec's owner semantics are scoped to the standing-solo-type create.
The rename warning is keyed on "`--name` was supplied" rather than a
before/after value diff, since per-field diff echo doesn't exist yet
(lands with `types-ergonomics`); it fires on every `--name` update
regardless of whether the new value differs from the current one — matches
the validation checklist's "no-name update doesn't" framing. The
role-gate 403 needed no new handling: the client's existing admin/owner/role
keyword match in `src/calendly/client.ts`'s 403 branch already produces
`FORBIDDEN` with the right suggestion.

## Follow-ups

- Live spot-check (unchecked above) needs a real account run once a
  consenting teammate is available: `types create --owner <teammate-email>
  --name <throwaway> --duration 15`, confirm it lands on their scheduling
  page with `admin_managed: false`, then clean up with `--inactive`.
