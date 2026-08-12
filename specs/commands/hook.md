# Command: hook

Session-hook lifecycle management, mirroring harvest-axi's triad. `calendly-axi hook` with no subcommand is `hook status`. The hook injects the [home view](home.md) at session start for Claude Code, Codex, and OpenCode via `axi-sdk-js`'s `installSessionStartHooks`.

## hook install

`calendly-axi hook install` — installs or repairs the SessionStart hook for all supported agents. Idempotent; self-repairing (recomputes the executable path each run); refuses to install for a `.ts` dev entrypoint. Also run implicitly by `auth setup` (the explicit user-invoked opt-in per AXI §7).

## hook status

`calendly-axi hook status` — a table per agent: installed?, resolved command, whether the path matches the current executable. Notes `CALENDLY_AXI_DISABLE_HOOKS=1` when set.

## hook uninstall

`calendly-axi hook uninstall` — surgically removes only this tool's marker-matched hook entries from each agent's config. Idempotent.

## Details

- `CALENDLY_AXI_DISABLE_HOOKS=1` suppresses every hook write, including the `auth setup` convenience install.
- The complementary static path is the installable skill (`skills/calendly-axi/SKILL.md`, generated per [architecture](../architecture.md)); README documents hook-vs-skill as "pick one."

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — every subcommand re-runs safely.
