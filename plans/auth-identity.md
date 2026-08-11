---
status: planned
depends: [foundation]
specs:
  - specs/commands/auth.md
  - specs/commands/hook.md
  - specs/commands/home.md
  - specs/behaviors/scoping.md
issues: []
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
- [ ] Re-running setup with no token revalidates + repairs hook (exit 0); unconfigured no-token setup → instruction + token URL, exit 2.
- [ ] `whoami` reports credential source `env` vs `config` correctly under `CALENDLY_ACCESS_TOKEN`.
- [ ] `doctor` on a healthy config: all ok + headroom; on each broken state: the right single check fails with its remediation, exit 1.
- [ ] Home view: configured → ≤5 upcoming rows; zero events → definitive line; dead API/token → cached identity + `status:` + doctor hint, exit 0.
- [ ] Hook status/uninstall round-trip leaves other tools' hooks untouched (fixture settings.json).
- [ ] Env-only invocation (no config file) bootstraps scope once and performs a scoped list.

## Risks / unknowns

- Whether `users/me` reliably carries `current_organization` for all account shapes; if absent, fall back to `organization_memberships` lookup at setup (spec update if needed).

## Notes

_(closeout)_

## Follow-ups

_(closeout)_
