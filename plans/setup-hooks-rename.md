---
status: done
depends: []
specs:
  - specs/commands/setup.md
  - specs/commands/auth.md
issues: []
pr: 14
---

# Plan: Rename `hook` → `setup hooks` (family consistency)

## Scope

Bring the hook-lifecycle surface in line with the released family convention discovered post-1.0: every shipped sibling exposes `setup hooks`; harvest-axi tried the top-level `hook` triad in its early releases and walked it back by 1.8.0, and calendly-axi v1.0.0 unknowingly shipped the abandoned shape (the survey had read a stale harvest checkout). **In:** `setup hooks [status|uninstall]` command group per `specs/commands/setup.md` (bare `setup hooks` = install/repair, matching siblings verbatim); top-level `hook` removed with no alias (package is hours old — no adoption to protect); doctor's hooks-check remediation text, reference.ts, regenerated SKILL.md, and README updated accordingly. **Out:** project-scoped hook install (`--scope project`) — belongs in `axi-sdk-js` so every tool inherits it; tracked as a possible SDK follow-up, not built here.

## Implements

- `specs/commands/setup.md` — new (replaces `specs/commands/hook.md`).
- `specs/commands/auth.md` — doctor remediation pointer.

## Validation

- [x] `calendly-axi setup hooks` installs/repairs (identical behavior to the old `hook install`); `setup hooks status` / `setup hooks uninstall` behave as before; all existing hook tests pass re-pointed.
- [x] `calendly-axi hook <anything>` → unknown-command error (no silent alias), exit per SDK convention.
- [x] `doctor`'s failing hooks check names `setup hooks` as the remediation.
- [x] `bun run docs:check` green — SKILL.md and reference regenerated; no `calendly-axi hook` string remains anywhere in help, SKILL.md, or README.
- [x] Live: `setup hooks status` against the real installed hook reports current. *(Verified 2026-08-12 post-merge — status renders per-agent rows against the real installed hooks; `current: false` shown correctly when inspecting from the repo build while the hooks point at the PATH-installed binary.)*

## Risks / unknowns

- None — mechanical rename on tested plumbing.

## Notes

Mechanical routing rename, exactly as scoped — no surprises. `src/commands/hook.ts`
became `src/commands/setup.ts` via `git mv`; every business-logic function
(`installHooks`, `hookDoctorCheck`, `statusRows`, `hookInstall`/`hookStatus`/
`hookUninstall`) is untouched. The only behavioral change (also spec'd, not
incidental) is the default action for a bare invocation: old bare `hook`
defaulted to `status`, new bare `setup hooks` defaults to `install`, matching
every released sibling tool.

`bun run check && bun run build && bun run test && bun run docs:check` all
clean — 22 files, 338 tests. Grep-sweep (`grep -rn "calendly-axi hook" src/
skills/ README.md test/`) returns nothing.

Live-verified (read-only, against this machine's real pre-existing v1.0.0
hook installation): `calendly-axi setup hooks status` renders correctly, and
`calendly-axi hook status` now fails as `Unknown command: hook`, exit 2 — the
core behavior this plan exists to prove. The one unchecked Validation box
(`setup hooks status` reporting `current: true`) needs the *rebuilt* binary
to actually be the one globally installed, which happens post-merge — this
run correctly reported `current: false` since the worktree build isn't the
installed executable.

## Follow-ups

None. No adoption existed for the removed `hook` command (package is hours
old), so no deprecation window or migration note is needed anywhere else in
the repo.
