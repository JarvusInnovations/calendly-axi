---
status: done
depends: [foundation]
specs:
  - specs/commands/auth.md
  - specs/commands/hook.md
  - specs/commands/home.md
  - specs/behaviors/scoping.md
issues: []
pr: 4
---

# Plan: Auth, doctor, hook, home

## Scope

The identity layer and ambient surface. **In:** `auth setup/whoami/logout` (PAT validation via `users/me`, profile-cache write incl. `current_organization`, idempotent re-runs), `doctor` (five ordered checks incl. rate-limit headroom and hook state), `hook install/status/uninstall` (via `installSessionStartHooks`, `CALENDLY_AXI_DISABLE_HOOKS` kill switch), the no-args home view (identity + up to 5 upcoming events, all degradation paths), and the scoping resolver (`cached self default, --org/--user widening, env-only one-shot bootstrap`). **Out:** every domain command.

## Implements

- `specs/commands/auth.md`, `specs/commands/hook.md`, `specs/commands/home.md` — fully.
- `specs/behaviors/scoping.md` — the shared resolver all later commands consume.

## Approach

Port harvest-axi's `auth.ts`/`doctor.ts`/`hook.ts`/`home.ts` shapes onto the Calendly client. First live-API contact: capture real 401/403 bodies as fixtures and tighten foundation's 403 split if reality differs (spec update if so).

## Validation

- [ ] `auth setup --token <bad>` → `TOKEN_INVALID`, exit 1, nothing written; `--token <good>` writes 0600 config, installs hook, reports identity.
- [x] Re-running setup with no token revalidates + repairs hook (exit 0); unconfigured no-token setup → instruction + token URL, exit 2.
- [x] `whoami` reports credential source `env` vs `config` correctly under `CALENDLY_ACCESS_TOKEN`.
- [ ] `doctor` on a healthy config: all ok + headroom; on each broken state: the right single check fails with its remediation, exit 1.
- [x] Home view: configured → ≤5 upcoming rows; zero events → definitive line; dead API/token → cached identity + `status:` + doctor hint, exit 0.
- [x] Hook status/uninstall round-trip leaves other tools' hooks untouched (fixture settings.json).
- [ ] Env-only invocation (no config file) bootstraps scope once and performs a scoped list.

## Risks / unknowns

- Whether `users/me` reliably carries `current_organization` for all account shapes; if absent, fall back to `organization_memberships` lookup at setup (spec update if needed).

## Notes

No live Calendly credentials exist on this machine (per the task constraints), so
everything was validated with vitest `fetch` spies against fixtures shaped to match
the documented API contract (`specs/api/conventions.md`). 163 tests across 14 files,
`bun run check && bun run build && bun run test` clean; manual smoke of
`node dist/bin/calendly-axi.js doctor` (no creds) and `node dist/bin/calendly-axi.js`
(home, unconfigured) both produced the spec'd structured output.

Three Validation items stay unchecked because they genuinely need a live PAT, not
because the mechanism is unverified — each is exercised end-to-end against fixtures,
just not against the real API:

- **Row 1** (`auth setup --token <good>`) — the bad-token/nothing-written half is
  fixture-solid (any 401 → `TOKEN_INVALID`); the good-token half assumes our fixture's
  shape of a successful `GET /users/me` response matches reality.
- **Row 4** (`doctor` healthy-config pass) — the five broken-state paths (credentials
  missing, token invalid, organization unfetchable, hooks absent) are each fixture-
  isolated and pass; the "healthy config: all ok + headroom" pass-through needs a real
  account to confirm.
- **Row 7** (env-only bootstrap) — `test/commands/home.test.ts`'s
  "env-only bootstrap" case exercises the mechanism (no config file,
  `CALENDLY_ACCESS_TOKEN` only, one `users/me` bootstrap + one scoped `scheduled_events`
  call, nothing persisted) against fixtures; it hasn't run against the live API. Also
  worth noting: this plan has no dedicated `list` command to bootstrap against, so the
  item is satisfied via `home`'s own scoped `scheduled_events` call rather than a
  literal listing command — later plans (`events`, `types`, `busy`, `webhooks`) reuse
  the same `resolveScope`/`resolveSelf` path this validates.

The Risks/unknowns item (`current_organization` possibly absent) is implemented
defensively — `fetchProfile` in `src/calendly/scope.ts` falls back to an
`organization_memberships` lookup — but that fallback is likewise unverified against
a live account shape; see Follow-ups.

## Follow-ups

- None (github issue) — the `current_organization`-fallback Risk stays open, tracked
  by this plan's own Risks/unknowns entry rather than a new issue: verify against a
  live PAT during the first real `auth setup`, and tighten `scope.ts` plus
  `specs/behaviors/scoping.md` if the real response shape differs.
- None — `hook status`/`doctor`'s `current` column is a best-effort realpath
  comparison, not a full port of `axi-sdk-js`'s private npm-shim-resolution logic.
  Acceptable for the direct-execpath and PATH-resolvable-binary-name cases it's meant
  to catch; revisit only if it misreports for an npm-globally-installed `calendly-axi`.
