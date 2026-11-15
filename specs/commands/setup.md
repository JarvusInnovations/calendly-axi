# Command: setup

Session-hook lifecycle management under the family-standard `setup` group — every released sibling tool exposes `setup hooks`, and calendly-axi matches that invocation verbatim. The hook injects the [home view](home.md) at session start for Claude Code, Codex, and OpenCode via `axi-sdk-js`'s `installSessionStartHooks`.

`calendly-axi setup hooks [status|uninstall] [--scope user|project]`

`setup hooks` is the **only** code path that writes a hook (AXI §7: register only from a user-invoked setup command, never as a side effect of an ordinary command). [`auth setup`](auth.md) reports the hook's state read-only and suggests `setup hooks`; it never installs.

## setup hooks (default action: install/repair)

`calendly-axi setup hooks` — installs or repairs the SessionStart hook for all supported agents. Idempotent; self-repairing (recomputes the executable path each run: the PATH-verified binary name when it resolves to the current executable, the absolute path otherwise). This bare form is byte-compatible with every sibling tool's hook-install invocation.

It fails closed (AXI §6):

- A write the SDK reports as failed (its `onError`, e.g. EACCES on one agent's settings file or an unmanaged OpenCode plugin) is `SETUP_FAILED` (exit 1), carrying every reported message, the agents that *were* installed and the agents left without a current hook — never a warning on a zero exit. The hint names the file problem (permissions, or invalid JSON/TOML) and the exact rerun command.
- After installing, the hook is re-read for every agent. If any is missing or not pointing at the current executable (the SDK silently declines an entrypoint it doesn't recognize as an installed `calendly-axi` binary, e.g. a source checkout), the command fails `SETUP_FAILED` (exit 1) naming those agents, rather than reporting success.
- A repeat install that changes no file reports `already installed and current at <scope> scope (no-op)` and leaves the file bytes unchanged. The no-op check snapshots every file the installer may touch, including Codex's `config.toml`.
- A `.ts` dev entrypoint is refused before anything is written: the status line says `skipped — running from a .ts dev entrypoint (build first)`, exit 0, nothing installed.

## --scope

`--scope user|project` (default `user`) selects where the hook lives, passed through to the SDK's scope support. All three subcommands honor it.

- `user` targets each agent's home-directory config (`~/.claude/settings.json`, `~/.codex/hooks.json`, `~/.config/opencode/plugins/`), so the hook runs in every session.
- `project` targets the current directory's per-project config (`<cwd>/.claude/settings.json`, `<cwd>/.codex/hooks.json`, `<cwd>/.opencode/plugins/`), so the hook travels with a repository. Run it from the repository root.
- Any other value is `VALIDATION_ERROR` (exit 2) naming the two valid values.
- Every `setup hooks` output echoes `scope:` and the `root:` directory it resolved to.

## setup hooks status

`calendly-axi setup hooks status [--scope user|project]` — a table per agent: installed?, resolved command, whether the path matches the current executable.

- A target file that exists but cannot be read or parsed is a `problems[N]{agent,problem}` row naming the file and the error — never "not installed".
- Codex counts as current only when `~/.codex/config.toml` has `[features] hooks = true` (always the user's config, whatever the scope — that is where the SDK writes it); otherwise a `problems[]` row names the flag.
- Notes `CALENDLY_AXI_DISABLE_HOOKS=1` when set.

## setup hooks uninstall

`calendly-axi setup hooks uninstall [--scope user|project]` — surgically removes only this tool's marker-matched hook entries from each agent's config in the given scope. Idempotent: with nothing installed it reports a no-op, exit 0.

A target that exists but cannot be read, parsed or written fails `IO_ERROR` (exit 1) naming each such file and what *was* removed — never a "removed"/no-op claim while a hook may remain.

## Details

- There is **no top-level `hook` command** — v1.0.0 briefly shipped one (modeled on a shape harvest-axi had already abandoned); it was renamed in v1.1.0 with no alias kept, before any adoption existed.
- `CALENDLY_AXI_DISABLE_HOOKS=1` makes every hook install a no-op that says so. It is a test and sandbox guard, not a user feature.
- `setup hooks` takes no positional arguments beyond the action; an extra one is `USAGE` (exit 2).
- [`doctor`](auth.md#doctor)'s hooks row reads user scope. The hook is optional (the installable skill is the alternative), so a missing hook is `skipped`; an installed hook that is stale, unreadable or disabled for Codex is `fail`.
- The complementary static path is the installable skill (`skills/calendly-axi/SKILL.md`, generated per [architecture](../architecture.md)); README documents hook-vs-skill as "pick one."

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — every subcommand re-runs safely.

**Local:**

- **Family invocation compatibility beats internal taxonomy.** When the released sibling tools share a command shape, matching it verbatim outweighs a tidier local grouping — an agent that has learned one `-axi` tool must be able to guess this one.
- **A hook that can't be confirmed is a failed setup.** "Completed with a warning" on exit 0 tells the agent the home view will load next session when it won't. Install verifies by re-reading; status and uninstall report a file they couldn't read rather than guessing it holds nothing.
