---
status: planned
depends: []
specs:
  - specs/commands/setup.md
  - specs/commands/auth.md
issues: []
---

# Plan: Rename `hook` → `setup hooks` (family consistency)

## Scope

Bring the hook-lifecycle surface in line with the released family convention discovered post-1.0: every shipped sibling exposes `setup hooks`; harvest-axi tried the top-level `hook` triad in its early releases and walked it back by 1.8.0, and calendly-axi v1.0.0 unknowingly shipped the abandoned shape (the survey had read a stale harvest checkout). **In:** `setup hooks [status|uninstall]` command group per `specs/commands/setup.md` (bare `setup hooks` = install/repair, matching siblings verbatim); top-level `hook` removed with no alias (package is hours old — no adoption to protect); doctor's hooks-check remediation text, reference.ts, regenerated SKILL.md, and README updated accordingly. **Out:** project-scoped hook install (`--scope project`) — belongs in `axi-sdk-js` so every tool inherits it; tracked as a possible SDK follow-up, not built here.

## Implements

- `specs/commands/setup.md` — new (replaces `specs/commands/hook.md`).
- `specs/commands/auth.md` — doctor remediation pointer.

## Validation

- [ ] `calendly-axi setup hooks` installs/repairs (identical behavior to the old `hook install`); `setup hooks status` / `setup hooks uninstall` behave as before; all existing hook tests pass re-pointed.
- [ ] `calendly-axi hook <anything>` → unknown-command error (no silent alias), exit per SDK convention.
- [ ] `doctor`'s failing hooks check names `setup hooks` as the remediation.
- [ ] `bun run docs:check` green — SKILL.md and reference regenerated; no `calendly-axi hook` string remains anywhere in help, SKILL.md, or README.
- [ ] Live: `setup hooks status` against the real installed hook reports current.

## Risks / unknowns

- None — mechanical rename on tested plumbing.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
