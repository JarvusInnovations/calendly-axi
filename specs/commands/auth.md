# Command: auth + doctor

## auth setup

`calendly-axi auth setup --token <pat>` — agent-guided, non-interactive credential capture.

- Validates the token via `GET /users/me`, writes `{ token, profile_cache }` to config (0600), **installs/repairs the SessionStart hook**, and confirms with the resolved identity (name, email, scheduling_url) + hook status.
- With **no `--token` but already configured**: re-validates stored credentials, refreshes the profile cache, (re)installs the hook — the "repair my ambient setup" path.
- With **no `--token` and unconfigured**: a structured instruction (not a prompt) — create a PAT under Integrations → API & Webhooks (<https://calendly.com/integrations/api_webhooks>), grant the scopes listed in [api/conventions](../api/conventions.md), then re-run with `--token`. Exit 2.
- Idempotent: re-running with the same token revalidates and reports the existing identity, exit 0.

## auth whoami

`calendly-axi auth whoami [--refresh]` — prints identity from cache (`--refresh` re-fetches `users/me` and rewrites the cache), plus the credential source (`env` | `config`). Definitive "not configured" message when neither exists.

## auth logout

`calendly-axi auth logout` — removes stored credentials and cache (idempotent: no-op + exit 0 if already absent). Notes when `CALENDLY_ACCESS_TOKEN` is still set in the environment, since commands would keep working.

## doctor

`calendly-axi doctor` — ordered checks, each `{check, status: ok|fail|skipped, detail}` with the specific remediation in `detail`, preceded by a `healthy:` boolean:

1. **credentials** — present? source (`env`/`config`)?
2. **token** — `users/me` succeeds? (latency reported)
3. **organization** — org URI cached and fetchable?
4. **rate-limit headroom** — `X-RateLimit-Remaining`/`Limit` from the check calls; flags the 50/min Free-tier ceiling when detected.
5. **hooks** — SessionStart hook installed and pointing at the current executable? (remediation: `setup hooks`)

Exit 0 when all pass, 1 otherwise (`process.exitCode`, still structured stdout).

## Auth resolution (used by all commands)

`CALENDLY_ACCESS_TOKEN` env → config file. A command needing auth with neither throws `TOKEN_INVALID` suggesting `auth setup`. See [scoping](../behaviors/scoping.md) for the env-only bootstrap path.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Token-based auth, unattended-friendly](../principles.md#token-based-auth-unattended-friendly) — PAT + env override, no browser flow.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — setup/logout re-runs are no-ops; missing token fails fast with instructions.
- [Never make the agent discover scope](../principles.md#never-make-the-agent-discover-scope) — setup is where the scope cache gets written; everything else free-rides.
