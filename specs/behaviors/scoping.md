# Behavior: Scoping

## Rule

Every command that hits a scope-requiring endpoint resolves its `user`/`organization` URIs from the **profile cache** written at `auth setup` — never from a discovery call at command time. Defaults:

- Default scope is **the authenticated user** (`user=<cached user_uri>`).
- `--org` switches to organization scope (`organization=<cached organization_uri>`, no `user` param unless combined).
- `--user <id|uri|email>` targets another user. An email is resolved via `GET /organization_memberships?organization=<org>&email=<email>`; zero/multiple hits behave like name resolution (`NOT_FOUND` / candidate list).

## Applies To

`events` (list), `types` (list, create's `owner`), `busy`, `webhooks` (org + scope params), `home`.

## Details

- The profile cache (`config.json → profile_cache`) holds `user_uri`, `user_uuid`, `organization_uri`, `organization_uuid`, `name`, `email`, `scheduling_url`, `timezone`, `cached_at` from `GET /users/me` at setup. `auth whoami --refresh` and re-running `auth setup` refresh it.
- A command needing scope with no cache (env-token-only usage, e.g. CI) performs the `users/me` bootstrap **once per invocation**, transparently, without writing config.
- Org-scoped listing needs an org admin/owner role; the role-gate 403 is translated per [conventions](../api/conventions.md), and **the command that passed `--org` appends the "drop `--org`" suggestion itself** — the shared client stays command-agnostic and only names the role requirement, since it cannot know which flag produced the scope.
- `--org` and `--user` are validated per command against what the endpoint actually supports; combinations the API rejects (e.g. neither param) are prevented client-side.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [Never make the agent discover scope](../principles.md#never-make-the-agent-discover-scope) — cached-self defaults, explicit widening flags.
