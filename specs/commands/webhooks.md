# Command: webhooks

Webhook-subscription management. Contract: [api/webhooks](../api/webhooks.md). Reads work on Free; **creation needs a paid plan** (`PLAN_REQUIRED` on the 403).

## webhooks list (default subcommand)

`calendly-axi webhooks [list] [--scope organization|user|group] [--user <who>] [--group <id>]`

- Default: `scope=organization` over the cached org (org-level subscriptions are the common integration shape). `--scope user` defaults `--user` to self.
- Drains the cursor. Default schema: `webhooks[N]{uuid,callback_url,state,scope,events}` (`events` joined compactly).
- Suggestions: `webhooks view <uuid>`, `webhooks create --url <url> --events <e,e>`, `webhooks sample --event <e>`.

## webhooks view

`calendly-axi webhooks view <webhook>` — full detail: uuid, uri, callback_url, state, events, scope + scoped user/group, creator, created_at, retry_started_at (present ⇒ deliveries are failing — say so plainly). Self-contained.

## webhooks create

`calendly-axi webhooks create --url <https-url> --events <event,event,...> [--scope organization|user|group] [--user <who>] [--group <id>] [--signing-key <key>]`

- Defaults: `scope=organization`, org from cache. `--events` validated client-side against the known event list ([api/webhooks](../api/webhooks.md#events)) including per-scope constraints (`meeting_recap.*` user-only, `routing_form_submission.created` org-only) — unknown events fail fast listing valid ones.
- Duplicate (409) → fetches and reports the existing subscription as an already-subscribed no-op, exit 0.
- `--signing-key` passes through; never stored. Scope-gate 403s name the missing token read scope.
- Output: the created subscription's detail. Suggestion: `webhooks sample --event <first-event>` to see what deliveries look like.

## webhooks delete

`calendly-axi webhooks delete <webhook>` — idempotent (already-gone → no-op, exit 0). `--help` notes: there is no update — delete and recreate to change url/events.

## webhooks sample

`calendly-axi webhooks sample --event <event> [--scope organization|user|group] [--user <who>]` — fetches a realistic sample payload for the event without waiting for a live booking. Payload rendered as-is (JSON block) since its exact shape is the answer; size-capped with a total-size note if enormous.

## Principles

**Inherited** — see [`../principles.md`](../principles.md):

- [The API's boundaries are spec'd, not papered over](../principles.md#the-apis-boundaries-are-specd-not-papered-over) — no-update stated in delete's help; plan/scope gates named.
- [Idempotent, non-interactive mutations](../principles.md#idempotent-non-interactive-mutations) — duplicate create and repeat delete are no-ops.
- [Never make the agent discover scope](../principles.md#never-make-the-agent-discover-scope) — org-scope defaults from cache.
