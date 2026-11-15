# Command: auth + doctor

## auth setup

`calendly-axi auth setup (--token-stdin | --token <pat>)` — agent-guided, non-interactive credential capture.

The token arrives on exactly one channel:

- **`--token-stdin` (the documented default)** — reads the token from stdin, trimming one trailing newline. Stdin is read **only** when this flag is given, so the command can never block on a terminal it wasn't told to read. Empty stdin is `USAGE` (exit 2) with the pipe example. The hint shown everywhere is the portable form: `read -rs T && printf %s "$T" | calendly-axi auth setup --token-stdin`.
- **`--token <pat>`** — kept for convenience (CI secret interpolation). It puts the token in shell history and the process list, so help, hints, README and the skill show the stdin form first and label this one.
- `--token` with `--token-stdin` is `USAGE` (exit 2): contradictory channels are rejected, never settled by precedence.
- **`CALENDLY_ACCESS_TOKEN`** is the headless alternative to storing anything: every command reads it (see [Auth resolution](#auth-resolution-used-by-all-commands)), and it needs no `auth setup` at all.

Behavior:

- Validates the token via `GET /users/me`, writes `{ token, profile_cache }` to config (0600), and confirms with the resolved identity (name, email, scheduling_url) plus a read-only `session_hook:` line.
- With **no token flag but already configured**: re-validates the resolved credentials and refreshes the profile cache (when the token came from config) — the "repair my ambient setup" path.
- With **no token flag and unconfigured**: a structured instruction (not a prompt) — create a PAT under Integrations → API & Webhooks (<https://calendly.com/integrations/api_webhooks>), grant the scopes listed in [api/conventions](../api/conventions.md), then pipe it to `--token-stdin` or set `CALENDLY_ACCESS_TOKEN`. Exit 2.
- Idempotent: re-running with the same token revalidates and reports the existing identity, exit 0.
- **It never installs the session hook.** `session_hook:` reports the user-scope hook as `installed and current: <agents>`, `not installed — run \`calendly-axi setup hooks\` …`, `stale for <agents> …`, `problem — …` or `disabled (CALENDLY_AXI_DISABLE_HOOKS=1)`. [`setup hooks`](setup.md) is the only path that writes one. (Through v1.2.x `auth setup` installed the hook as a side effect; that was removed.)

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
5. **hooks** — reads the user-scope SessionStart hook. The hook is optional, so **not installed is `skipped`** with the `setup hooks` command in `detail`. An installed hook that points at a different executable, a target file that can't be read or parsed, or a Codex hook without `[features] hooks = true` is `fail` (remediation: `setup hooks`). `ok` names the agents.

Exit 0 when no check fails, 1 otherwise (`process.exitCode`, still structured stdout).

## Auth resolution (used by all commands)

`CALENDLY_ACCESS_TOKEN` env → config file. A command needing auth with neither throws `TOKEN_INVALID` suggesting `auth setup`. See [scoping](../behaviors/scoping.md) for the env-only bootstrap path.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Token-based auth, unattended-friendly](../principles.md#token-based-auth-unattended-friendly) — PAT + env override, no browser flow.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — setup/logout re-runs are no-ops; missing token fails fast with instructions.
- [Never make the agent discover scope](../principles.md#never-make-the-agent-discover-scope) — setup is where the scope cache gets written; everything else free-rides.
