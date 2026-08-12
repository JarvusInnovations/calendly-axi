# calendly-axi

Agent-ergonomic CLI for the Calendly API. Follows the [AXI standards](https://axi.md) — invoke the **axi** skill when building or reviewing any command surface.

## Spec-driven development (specops)

This project uses spec-driven development. `specs/` is the source of truth for what
*should be true*; `plans/` is the work-in-flight DAG that bridges specs to merged code.
The **specops** skill carries the full methodology — invoke it (the skill triggers on
"spec", "plan", starting a feature, etc.) before writing specs, planning, or building.

- **Specs lead.** Before changing behavior, change the spec; bring code into conformance
  after. Spec↔code drift is a bug, not debt. Specs merge implemented-or-planned; a spec
  still being designed rides a draft planning PR, not the main branch.
- **`plans/` is the planning system — not your built-in plan mode.** Every chunk of work
  lands as a file in `plans/` that freezes to `done` as the durable record of what got
  built. Don't let an ephemeral plan substitute for it, and don't skip it for "small"
  changes. (Classic trap: an ad-hoc plan of "write spec X, then build it" that ends with
  neither a reviewed spec nor a plan file — split those into the two real artifacts.)
- **When to author a plan depends on intent:** mapping out a batch of specs → finish the
  batch first, then propose a *set* of plans; speccing one bounded feature in a mature
  project → draft the spec change and its plan in tandem; intent unclear → ask. The skill
  details each mode.
- **A spec change ripples to its plans.** After editing a spec, review the plans that
  implement it (`grep -l '<spec-path>' plans/*.md`) and offer to update them.

Query the DAG: `.agents/skills/specops/scripts/specops next` (what to work on next) and
`.agents/skills/specops/scripts/specops dag` (graph). Run `/audit-spec-drift` to compare
specs against the implementation.

## Development

- `bun install` / `bun run dev` (run from source) / `bun run build` (`tsc` → `dist/`) / `bun run test` (vitest) / `bun run check` (`tsc --noEmit`).
- Tests must set `CALENDLY_AXI_DISABLE_HOOKS=1` and stub `XDG_CONFIG_HOME` — never touch the real `~/.claude` or `~/.config`.
- Releases ride the develop→main Release-PR flow (**release-flow** skill); repo shell conventions are the **repo-setup** skill's.
