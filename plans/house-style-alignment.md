---
status: in-progress
depends: []
specs:
  - specs/commands/setup.md
  - specs/commands/auth.md
  - specs/commands/home.md
  - specs/architecture.md
issues: [23]
---

# Plan: Align with the jarvus-axi house style (fail-closed hooks, token off argv)

## Scope

Issue #23 lists where this tool predates the `jarvus-axi` house style. nexudus-axi was derived from calendly-axi and has since hardened the shared modules, so most of this is a port back from the canonical sources named in `.agents/skills/jarvus-axi/references/canonical-sources.md`.

**In — "Should fix":**

1. `setup hooks` fails closed: any SDK `onError` is `SETUP_FAILED` (exit 1), status is re-read after installing, status/uninstall report unreadable targets.
2. `auth setup` stops installing the hook; it reports hook state read-only. `doctor` treats a missing hook as `skipped`, since the hook is now strictly opt-in.
3. `auth setup --token-stdin`; `--token <value>` keeps working; stdin and `CALENDLY_ACCESS_TOKEN` become the documented default in help, hints, README and the skill.
4. The flag parser counts positionals; every command declares its count and extras are `USAGE`.

**In — "Smaller":**

5. `setup hooks --scope user|project` (needs `axi-sdk-js` ≥ 0.1.14).
6. `--version` fast path in the bin entry.
7. Home renders an unread invitee counter as `unknown`, never `?` or `0`.
8. `CALENDLY_AXI_CONFIG_DIR` override.

**Out:**

- `--dir <path>` / git-root resolution for project scope. The house style wants it, but the canonical `setup.ts` resolves project scope to the current directory; this port matches the canonical source and the spec says to run from the repository root. Follow the canonical repo when it changes.
- An unparseable `config.json` still falls back to defaults (`specs/architecture.md`). The house style wants `CONFIG_INVALID`; that is a separate behavior change the issue doesn't list.
- Rejecting a repeated non-`multi` flag, and a global flag-sweep test over the whole spec table.
- `events list`'s `invitees` column (the issue names the home view only).

## Implements

- `specs/commands/setup.md` — the whole file: fail-closed install, `--scope`, status `problems[]`, uninstall `IO_ERROR`.
- `specs/commands/auth.md` § auth setup (token channels, read-only `session_hook:`), § doctor (hooks row).
- `specs/commands/home.md` § Display Rules (`unknown` invitees, the `--token-stdin` hint).
- `specs/architecture.md` — positional counts in `flags.ts`, config dir resolution, the closed environment set, the `--version` fast path.

## Approach

- `src/flags.ts`: port `positionals` / `usage` from nexudus-axi's parser (not its global `--space` selector — this tool is single-account). Declare a count on every entry of the spec table, taking each usage line from the command's existing `requirePositional` call.
- `bun add axi-sdk-js@^0.1.14` for `scope` / `projectDir` and `SessionStartHookScope`.
- `src/commands/setup.ts`: port nexudus-axi's file wholesale, renaming the marker and env var. `installHooks` is no longer exported; `hookSummary()` is the read-only export for auth.
- `src/commands/auth.ts`: resolve the token from one channel (`--token` xor `--token-stdin`), reading fd 0 only when the flag asks; swap `installHooks()` for `hookSummary()`.
- `src/config.ts`: `CALENDLY_AXI_CONFIG_DIR` first in `configDir()`.
- `bin/calendly-axi.ts`: `tryFastPath` before a dynamic import of the CLI.
- `src/commands/home.ts`: `inviteeSummary` returns `unknown` for anything it didn't read.
- `src/reference.ts`, `scripts/generate-skill.ts`, README: stdin form first; regenerate `skills/calendly-axi/SKILL.md`.

## Validation

- [ ] A read-only `.claude/` makes `setup hooks --scope project` throw `SETUP_FAILED` naming the file and Claude Code (fails against the old `setup.ts`, which returned `completed with a warning`).
- [ ] Running `setup hooks` from an entrypoint the SDK declines throws `SETUP_FAILED` rather than reporting `installed/repaired`.
- [ ] A repeat install reports `already installed and current at <scope> scope (no-op)` with unchanged file bytes.
- [ ] An unparseable target is a `problems[]` row in `status` and `IO_ERROR` from `uninstall`.
- [ ] `auth setup` with a good token and hooks enabled writes no file under a temp `HOME` and prints `session_hook: not installed`.
- [ ] `--token-stdin` stores the piped token (spawned binary, temp `HOME`); empty stdin is `USAGE`; `--token` with `--token-stdin` is `USAGE`; without the flag stdin is never read.
- [ ] An extra positional is `USAGE` (exit 2) on a zero-positional and on a one-positional command; `--help` is never blocked.
- [ ] `doctor` reports a missing hook as `skipped` and stays healthy.
- [ ] `CALENDLY_AXI_CONFIG_DIR` wins over `XDG_CONFIG_HOME`.
- [ ] The built `dist/bin/calendly-axi.js --version` prints the package version.
- [ ] Home renders a missing `invitees_counter` as `unknown`.
- [ ] `bun run check && bun run build && bun run test && bun run docs:check` all pass.

## Risks / unknowns

- Positional counts are declared per subcommand by hand. A wrong count would reject a valid call, so each is taken from the command's own `requirePositional` usage and the existing suites must stay green.
- The newer SDK writes Codex's `[features] hooks = true` into `~/.codex/config.toml` at any scope, so every test that can install must point `HOME` at a temp dir.
