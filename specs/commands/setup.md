# Command: setup

Session-hook lifecycle management under the family-standard `setup` group — every released sibling tool (harvest, otter, metabase, remarkable, gws) exposes `setup hooks`, and calendly-axi matches that invocation verbatim while keeping the richer lifecycle subcommands the siblings lack. The hook injects the [home view](home.md) at session start for Claude Code, Codex, and OpenCode via `axi-sdk-js`'s `installSessionStartHooks`.

## setup hooks (default action: install/repair)

`calendly-axi setup hooks` — installs or repairs the SessionStart hook for all supported agents. Idempotent; self-repairing (recomputes the executable path each run); refuses to install for a `.ts` dev entrypoint. Also run implicitly by `auth setup` (the explicit user-invoked opt-in per AXI §7). This bare form is byte-compatible with every sibling tool's hook-install invocation.

## setup hooks status

`calendly-axi setup hooks status` — a table per agent: installed?, resolved command, whether the path matches the current executable. Notes `CALENDLY_AXI_DISABLE_HOOKS=1` when set.

## setup hooks uninstall

`calendly-axi setup hooks uninstall` — surgically removes only this tool's marker-matched hook entries from each agent's config. Idempotent.

## Details

- There is **no top-level `hook` command** — v1.0.0 briefly shipped one (modeled on a shape harvest-axi had already abandoned); it was renamed in v1.1.0 with no alias kept, before any adoption existed.
- `CALENDLY_AXI_DISABLE_HOOKS=1` suppresses every hook write, including the `auth setup` convenience install.
- The complementary static path is the installable skill (`skills/calendly-axi/SKILL.md`, generated per [architecture](../architecture.md)); README documents hook-vs-skill as "pick one."

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — every subcommand re-runs safely.

**Local:**

- **Family invocation compatibility beats internal taxonomy.** When the released sibling tools share a command shape, matching it verbatim outweighs a tidier local grouping — an agent that has learned one `-axi` tool must be able to guess this one.
