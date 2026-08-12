---
status: done
pr: 12
depends: []
specs:
  - specs/behaviors/time-windows.md
  - specs/behaviors/identifier-resolution.md
  - specs/behaviors/scoping.md
  - specs/commands/types.md
  - specs/commands/events.md
  - specs/commands/busy.md
  - specs/commands/link.md
  - specs/commands/book.md
  - specs/commands/hook.md
  - specs/api/webhooks.md
issues: []
---

# Plan: Audit remediation — post-drain spec-drift findings

## Scope

Close every actionable finding from the post-drain spec-drift audit. **In:**

1. **`--window <today|tomorrow|week>`** wired into `events list`, `busy`, and `types slots` (the engine in `time/windows.ts` already implements + tests named windows; this exposes them). Mutually exclusive with `--from/--to/--since/--until`.
2. **`--org`** wired into all six name-accepting surfaces (`types view/update/slots/availability`, `link`, `book --type`) — threads the org scope into `resolveEventTypeIdentifier`'s sweep. Ids/URIs unaffected.
3. **Role-gate hint ownership**: `--org`-passing commands (`events list`, `types list`, and the six above) catch `FORBIDDEN` from an org-scoped call and append the "drop `--org`" suggestion; the shared client stays generic.
4. **Webhook duplicate-create match** tightened to url + events set-equality (+ scope, already implicit in the scoped list), per `specs/api/webhooks.md`'s stated key.
5. **Dead code**: delete `src/commands/not-implemented.ts` (zero call sites).
6. Regenerate SKILL.md (`bun run docs`) for the new flags; reference.ts entries updated.

Spec amendments land first in this same branch (already committed): named-window flag form, `--org` reach, role-gate hint ownership, invitee-email cross-reference fix, hook default subcommand, `--co-hosts` accepted forms, canonical-UUID example. **Out:** unused output builders and doctor's beyond-spec org check (audit accepted as-is); `event_type_memberships`/`user_availability_schedules` (deferred — see Follow-ups).

## Implements

The spec deltas in this branch's `docs(specs)` commit across the ten files listed in frontmatter.

## Validation

- [x] `events --window today`, `busy --window week`, `types slots <t> --window tomorrow` resolve calendar-aligned windows in the profile timezone (unit + live spot-check); combining `--window` with `--since`/`--from` → `VALIDATION_ERROR` naming the conflict. *(Live spot-check 2026-08-12: `today` and Mon–Sun `week` both calendar-aligned in America/New_York; conflict guard fires.)*
- [x] `link "<teammate-type-name>" --org` resolves a type the caller doesn't own (unit-tested with fixtures; live spot-check if an org-mate type exists). *(Live spot-check 2026-08-12: a teammate-owned type resolved by name and minted a link; a six-way ambiguous org-wide name produced the full `<uuid> (<name>)` candidate list, exit 2.)*
- [x] All six surfaces reject `--org` no longer as unknown flag; ids/URIs bypass the sweep unchanged.
- [x] Org-scoped `FORBIDDEN` on `events --org` / `types list --org` output includes the drop-`--org` suggestion (fixture).
- [x] Duplicate-webhook no-op only matches subscriptions with identical url AND events set (fixture: same url, different events → not treated as duplicate).
- [x] `not-implemented.ts` gone; `bun run check && bun run test && bun run docs:check` clean.

## Risks / unknowns

- None significant — all changes sit on tested plumbing.

## Notes

Implemented in PR #12 (branch `audit-remediation`, off `develop`). All six scope
items landed; `bun run check && bun run build && bun run test && bun run docs:check`
clean (332/332 tests). The two unchecked Validation boxes above are unit/fixture-clean
already — `resolveWindow`'s named-window math and the `--window` conflict check are
covered in `test/time/windows.test.ts`, and each command's `--window`/`--org` wiring
has fixture tests in `test/commands/{events,busy,types,link,book}.test.ts` — but they
name a **live spot-check** half (calendar-aligned windows against a real profile
timezone; `link --org` against an actual teammate-owned type) that this session
can't perform. Left unchecked for the orchestrator to verify against a live account
post-merge.

## Follow-ups

- Deferred: surfacing hosts (`GET /event_type_memberships`) on `types view` for non-solo kinds, and a `user_availability_schedules` read — trimmed from `specs/api/event-types.md` only if still unwanted at the next audit.
