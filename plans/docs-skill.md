---
status: planned
depends: [events-write, types-write, book, webhooks]
specs:
  - specs/architecture.md
issues: []
---

# Plan: Docs & skill — generated SKILL.md, README

## Scope

**In:** the `reference.ts → skills/calendly-axi/SKILL.md` generator (`bun run docs`), the `docs:check` CI staleness gate, and the README in the family shape (rendered home-view sample, install, auth setup with token URL + scopes, commands table, hook-vs-skill "pick one" section, honest platform-boundaries section, development). **Out:** publishing (→ `release-v1`).

## Implements

- `specs/architecture.md` — the docs-generation section (the rest landed with `foundation`).

## Approach

SKILL.md renders from the same `COMMAND_GROUPS` data as `--help`: trigger-shaped frontmatter, static content only, `npx -y calendly-axi ...` command forms. `docs:check` regenerates to a temp path and diffs. This closes the gap every sibling tool left open — remarkable-axi's reference.ts promised generation but never wired it.

## Validation

- [ ] `bun run docs` writes SKILL.md; editing help text without regenerating fails `docs:check` in CI.
- [ ] SKILL.md contains no live state and no bare `calendly-axi` invocations (all `npx -y` forms); frontmatter description reads as a trigger.
- [ ] `skills/calendly-axi` ships in the npm `files` allowlist (pack dry-run shows it).
- [ ] README renders the real no-args output of the finished tool, links both ambient paths, and its platform-boundaries section matches the specs (no delete, no reschedule, no webhook update, solo-only writes, plan gates).

## Risks / unknowns

- None significant — pure derivation work.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
