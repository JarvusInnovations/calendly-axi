---
status: planned
depends: []
specs:
  - specs/architecture.md
  - specs/api/conventions.md
  - specs/behaviors/identifier-resolution.md
  - specs/behaviors/pagination-and-limits.md
  - specs/behaviors/time-windows.md
issues: []
---

# Plan: Foundation — scaffold, client, output, flags, time

## Scope

The substrate every command sits on. **In:** package scaffold (`package.json` via `npm pkg set`/`bun add`, tsconfig, `bin/`, `ci.yml`), `src/cli.ts` (`runAxiCli` wiring + `formatError` with the USAGE-set→2 mapping and `INTERNAL_ERROR` wrapping), `src/flags.ts` (declared per-command flag sets, unknown-flag rejection), `src/reference.ts` (`COMMAND_GROUPS` skeleton rendering top-level and per-command help), `src/version.ts`, `src/config.ts` (config dir, 0600 writes, env-override `resolveCredentials` with `source`), `src/calendly/client.ts` (bearer + User-Agent headers, error translation per the conventions table incl. the three-way 403 split, rate-limit header capture), `src/calendly/paginate.ts` (drain/limit cursor walker), `src/calendly/ids.ts` (UUID↔URI, kind checking; name resolution lands with types-read), `src/output/` (ported FieldDef/render helpers), `src/time/windows.ts`. **Out:** all command logic — commands register as stubs throwing `NOT_IMPLEMENTED` naming their plan.

## Implements

- `specs/architecture.md` — full structure, build, config, error mapping, CI (including the no-credentials smoke test).
- `specs/api/conventions.md` — client + error translation + pagination plumbing.
- `specs/behaviors/identifier-resolution.md` — the UUID/URI layer (name resolution deferred to `types-read`).
- `specs/behaviors/pagination-and-limits.md` — the walker + header/complete-marker rendering helpers.
- `specs/behaviors/time-windows.md` — parsing, profile-timezone handling, cap enforcement hooks.

## Approach

Copy-adapt the family exemplars rather than reinvent: cli/flags/reference/error-mapping from remarkable-axi; config/client/paginate/output from harvest-axi (adjusted: single bearer header, cursor pagination, no total counts). `tsc` build; vitest with fetch spies and stubbed `XDG_CONFIG_HOME`.

## Validation

- [ ] `bun run build` compiles clean; `dist/bin/calendly-axi.js` executes; `--version` prints the package version.
- [ ] `bun run check` and `bun run test` pass in CI on develop.
- [ ] Unknown flag on any command → exit 2, valid flags inlined, no API call.
- [ ] Client injects both headers; 401 → `TOKEN_INVALID` + `auth setup` suggestion, no raw body on stdout; 403 variants split per conventions table (fixture-driven).
- [ ] Paginator drains a 3-page fixture (`complete: true`) and stops at a limit with a loud more-available marker.
- [ ] `time/windows` unit tests: `--since 7d`, `--until 30d`, named windows, date-only in profile tz, over-cap rejection naming the cap, junk input listing accepted forms.
- [ ] Smoke test: built CLI with no config runs a stub command → structured error, exit 1, no stack trace.

## Risks / unknowns

- The 403 body shapes for plan-gates vs role-gates are only documented loosely; fixtures come from live probing during `auth-identity`. Fallback mapping (`FORBIDDEN` + both suggestions) covers ambiguity.

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
