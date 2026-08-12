---
status: done
depends: []
specs:
  - specs/architecture.md
  - specs/api/conventions.md
  - specs/behaviors/identifier-resolution.md
  - specs/behaviors/pagination-and-limits.md
  - specs/behaviors/time-windows.md
issues: []
pr: 3
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

- [x] `bun run build` compiles clean; `dist/bin/calendly-axi.js` executes; `--version` prints the package version.
- [x] `bun run check` and `bun run test` pass in CI on develop. (Verified via the PR's `pull_request`-triggered CI run targeting `develop` — green pre-merge; see Notes.)
- [x] Unknown flag on any command → exit 2, valid flags inlined, no API call.
- [x] Client injects both headers; 401 → `TOKEN_INVALID` + `auth setup` suggestion, no raw body on stdout; 403 variants split per conventions table (fixture-driven).
- [x] Paginator drains a 3-page fixture (`complete: true`) and stops at a limit with a loud more-available marker.
- [x] `time/windows` unit tests: `--since 7d`, `--until 30d`, named windows, date-only in profile tz, over-cap rejection naming the cap, junk input listing accepted forms.
- [x] Smoke test: built CLI with no config runs a stub command → structured error, exit 1, no stack trace.

## Risks / unknowns

- The 403 body shapes for plan-gates vs role-gates are only documented loosely; fixtures come from live probing during `auth-identity`. Fallback mapping (`FORBIDDEN` + both suggestions) covers ambiguity.

## Notes

- **Single tsconfig serves both `check` and `build`.** `declaration: true`, `noEmit: false`; `bun run check` overrides with `tsc --noEmit`, `bun run build` uses the config as-is (`tsc` → `dist/`). `test/` is excluded from the compiled set — this mirrors harvest-axi rather than remarkable-axi (whose `test/**/*.ts` inclusion is coupled to its `noEmit: true`-everywhere config, decoupled from an esbuild-based build). Including `test/` here would also emit compiled test files into `dist/`. Tests are still fully validated at runtime by vitest; they're just outside the `tsc --noEmit` pass. A deliberate, contained deviation — not a gap.
- **`formatError` exported as a named function from `src/cli.ts`**, not inlined into the `runAxiCli` call (the remarkable-axi exemplar's shape) — purely so the USAGE-set→2 mapping and `INTERNAL_ERROR` wrapping are directly unit-testable without exercising full CLI dispatch. Same behavior, easier to verify.
- **403 variant disambiguation is a keyword match** against the Calendly error body's `title`/`message` (`scope` → `FORBIDDEN`; `plan`/`upgrade`/`subscription` → `PLAN_REQUIRED`; `admin`/`owner`/`role` → `FORBIDDEN`; otherwise the ambiguous fallback naming both possibilities). This plan's own Risks section flagged the real body shapes as "documented loosely" — real fixtures come from `auth-identity`'s live probing; the fallback covers ambiguity until then.
- **Time-window timezone arithmetic uses Node's built-in `Intl`** (format the instant in a zone, diff against UTC, correct once) rather than pulling in a tz-database dependency — no new dependency needed for `--from`/`--to` date-only resolution or the named windows.
- Dependency versions pinned at authoring time: `axi-sdk-js@0.1.10`, `@toon-format/toon@4.1.1`, `typescript@7.0.2`, `vitest@4.1.10`.

## Follow-ups

None.
