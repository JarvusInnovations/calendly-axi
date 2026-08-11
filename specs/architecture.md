# Architecture

## Stack

- **Runtime:** Node.js ≥ 20 (asdf-pinned: bun 1.3.11, nodejs 22.22.3). Authored in TypeScript (ESM), run via `bun` in dev, compiled with `tsc` to `dist/` for distribution.
- **CLI runtime:** [`axi-sdk-js`](https://www.npmjs.com/package/axi-sdk-js) (`runAxiCli`) — command-first dispatch, bare `--help`/`--version`, home-header injection, TOON serialization, structured errors, session-hook installer.
- **Output:** [TOON](https://toonformat.dev/) via `@toon-format/toon`, at the output boundary only. Internal logic works on plain objects.
- **HTTP:** the platform `fetch`. No Calendly SDK — we wrap the REST API directly.
- **Tests:** vitest, in `test/` mirroring `src/`, with `fetch` spies (no HTTP-mocking library) and `XDG_CONFIG_HOME` stubbed to a temp dir.

## Project structure

Follows harvest-axi's shape with remarkable-axi's newer conventions (declared flag sets, single-source reference, strict error mapping):

```
bin/calendly-axi.ts        # shebang entry → src/cli.ts main()
src/
├── cli.ts                 # runAxiCli wiring, custom formatError (USAGE/UNKNOWN_FLAG/VALIDATION_ERROR → exit 2;
│                          #   unexpected throws wrapped as INTERNAL_ERROR — no stack trace ever reaches stdout)
├── flags.ts               # parseFlags(command, argv, spec): each command declares its flag set;
│                          #   unknown flags rejected by name with the valid set inlined (AXI §6)
├── reference.ts           # COMMAND_GROUPS: the single source that renders top-level help,
│                          #   per-command --help, and the generated SKILL.md
├── version.ts             # leaf module exporting the package version
├── config.ts              # ~/.config/calendly-axi state: token + profile cache
├── calendly/
│   ├── client.ts          # authed fetch wrapper, error translation, rate-limit header capture
│   ├── paginate.ts        # cursor pagination (page_token) to completion / to limit
│   └── ids.ts             # UUID ↔ URI normalization + event-type name resolution
├── output/
│   ├── schema.ts          # FieldDef builders (field, pluck, mapEnum, truncated, computed)
│   ├── render.ts          # renderList / renderListResponse / renderObject / renderHelp
│   └── index.ts
├── time/windows.ts        # human date-range parsing → { from, to, label } (UTC ISO-8601 out)
└── commands/
    ├── home.ts
    ├── auth.ts            # setup / whoami / logout
    ├── doctor.ts
    ├── hook.ts            # install / status / uninstall
    ├── types.ts           # (+ types/ subcommand dir as needed)
    ├── events.ts          # (+ events/ subcommand dir as needed)
    ├── book.ts
    ├── link.ts
    ├── busy.ts
    └── webhooks.ts
```

`output/` and `time/` are ported in spirit from harvest-axi/gws-axi — same `FieldDef`/`renderListResponse` API, so rendering matches the sibling tools.

## Config & state

- Config dir: `$XDG_CONFIG_HOME/calendly-axi` or `~/.config/calendly-axi`; dir mode `0700`, `config.json` mode `0600`.
- `config.json` — `{ version, token, profile_cache }` where `profile_cache` holds the bootstrap identity from `GET /users/me`: `{ user_uri, user_uuid, name, email, scheduling_url, timezone, organization_uri, organization_uuid, cached_at }`. Versioned (`CONFIG_VERSION = 1`); any unparseable config falls back to defaults, never throws.
- Env override (takes precedence over config, for CI/cron): `CALENDLY_ACCESS_TOKEN`. Credential resolution reports its source (`env` | `config`) so `doctor`/`whoami` can surface it.
- `CALENDLY_AXI_DISABLE_HOOKS=1` disables all session-hook writes (tests set this unconditionally).

## Docs & skill generation

`src/reference.ts` is the **single source of truth** for the CLI's own documentation: top-level help, per-command `--help`, and the installable skill at `skills/calendly-axi/SKILL.md` are all rendered from `COMMAND_GROUPS`.

- `bun run docs` regenerates SKILL.md (static content only — no live state, `npx -y calendly-axi ...` command forms per AXI §7).
- `bun run docs:check` fails when the committed SKILL.md is stale; CI runs it on every push. Help text and the published skill cannot drift.

## Build & distribution

- `bun run build` → `tsc` → `dist/`, then `chmod +x dist/bin/calendly-axi.js`. `bun run check` → `tsc --noEmit`.
- Published `bin`: `calendly-axi → dist/bin/calendly-axi.js`; `files: ["dist", "skills/calendly-axi", "LICENSE", "README.md"]`; `publishConfig.access: public`.
- `--version` prints exactly the `package.json` version (the publish workflow rewrites it from the release tag); no git-describe stamping.
- Releases: develop → main Release-PR flow (infra-components actions); npm publish on GitHub release via OIDC trusted publishing. First publish is manual (registry bootstrap).
- CI (`ci.yml`): install → check → build → test, plus a **no-credentials smoke test** — run a built command with no config and assert a structured error on stdout, exit 1, and no stack trace.

## Principles

**Inherited** — see [`principles.md`](principles.md):

- [Token-based auth, unattended-friendly](principles.md#token-based-auth-unattended-friendly) — drives the PAT-in-config + env-override design above.
- [Translate errors; never leak raw API noise](principles.md#translate-errors-never-leak-raw-api-noise) — the `formatError` wrapper and the smoke test exist to enforce this at the process boundary.
