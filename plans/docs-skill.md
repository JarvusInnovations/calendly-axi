---
status: done
depends: [events-write, types-write, book, webhooks]
specs:
  - specs/architecture.md
issues: []
pr: 11
---

# Plan: Docs & skill — generated SKILL.md, README

## Scope

**In:** the `reference.ts → skills/calendly-axi/SKILL.md` generator (`bun run docs`), the `docs:check` CI staleness gate, and the README in the family shape (rendered home-view sample, install, auth setup with token URL + scopes, commands table, hook-vs-skill "pick one" section, honest platform-boundaries section, development). **Out:** publishing (→ `release-v1`).

## Implements

- `specs/architecture.md` — the docs-generation section (the rest landed with `foundation`).

## Approach

SKILL.md renders from the same `COMMAND_GROUPS` data as `--help`: trigger-shaped frontmatter, static content only, `npx -y calendly-axi ...` command forms. `docs:check` regenerates to a temp path and diffs. This closes the gap every sibling tool left open — remarkable-axi's reference.ts promised generation but never wired it.

## Validation

- [x] `bun run docs` writes SKILL.md; editing help text without regenerating fails `docs:check` in CI.
- [x] SKILL.md contains no live state and no bare `calendly-axi` invocations (all `npx -y` forms); frontmatter description reads as a trigger.
- [x] `skills/calendly-axi` ships in the npm `files` allowlist (pack dry-run shows it — see Notes).
- [x] README renders a realistic static no-args home-view sample, links both ambient paths, and its platform-boundaries section matches the specs (no delete, no reschedule, no webhook update, solo-only writes, plan gates).

## Risks / unknowns

- None significant — pure derivation work.

## Notes

`scripts/generate-skill.ts` renders `skills/calendly-axi/SKILL.md` from `src/reference.ts`'s
`COMMAND_GROUPS` — the same source top-level `--help` and every per-command `--help` uses.
`renderSkillMarkdown()` is a pure function (no I/O), so `test/scripts/generate-skill.test.ts`
exercises it directly: trigger-shaped frontmatter present, every `COMMAND_GROUPS` command
rendered, every runnable example in the `npx -y calendly-axi ...` form (no bare invocations
anywhere), no live-state markers, byte-identical output across two calls. `bun run docs`
writes the file; `bun run docs:check` regenerates to a fresh temp path and diffs against the
committed copy, printing the temp path and a `diff` command before exiting nonzero — wired
into `.github/workflows/ci.yml` right after the `test` step.

`TOKEN_CREATION_URL` and `REQUIRED_SCOPES` were promoted from module-private to exported in
`src/commands/auth.ts` so the generator (and the README) source the PAT URL and scope list
from the same place `auth setup`'s own guidance does, rather than a third hardcoded copy.
(`src/calendly/client.ts` and `src/commands/home.ts` each still carry their own small local
copy of the URL for their own error/guidance strings — left alone as out of this plan's
scope; only the generator's input needed a single source.)

README.md is new, in the harvest-axi/remarkable-axi family shape. Per the task brief, the
no-args home-view sample is realistic but static — hand-built with the project's own `encode()`
(from `@toon-format/toon`) against fabricated sample data, not a live CLI invocation (no
credentials were used or available). The platform-boundaries section was cross-checked
against `specs/principles.md` ("The API's boundaries are spec'd, not papered over") and the
per-endpoint specs (`event-types.md`, `scheduled-events.md`, `webhooks.md`, `booking.md`).

npm-pack verification: `npm pack --dry-run` lists `skills/calendly-axi/SKILL.md` (9.1kB),
`README.md`, and `LICENSE` in the tarball (56 files, 57.3kB packed / 198.1kB unpacked) —
`package.json`'s existing `files` allowlist needed no changes.

`bun run check && bun run build && bun run test && bun run docs:check` all pass clean
(305 tests across 22 files, including the 7 new generator-invariant tests).

PR #11 opened against `develop`, not merged (per task brief — review-only).

## Follow-ups

- None. If a future plan needs the PAT-URL/scopes constant deduplicated further (currently
  three small local copies exist: `commands/auth.ts` (canonical, exported), `commands/home.ts`,
  `calendly/client.ts`), that's a trivial standalone cleanup — not blocking anything here.
